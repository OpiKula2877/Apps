// Album tree in the sidebar. Drop photos on an album to add them; drag an album onto another
// to put it inside, or onto its upper/lower edge to change the order.
import { useState, type DragEvent, type MouseEvent } from 'react'
import { childAlbums, FRAME_HEX, sortAlbums, type Album } from '../../../shared/model'
import { api } from '../api'
import { Icon } from '../components/Icon'
import { MEDIA_DRAG } from '../components/MediaGrid'
import { useApp } from '../context'
import { useLibrary } from './context'

export const ALBUM_DRAG = 'application/x-okgram-album'
type DropPlace = 'before' | 'inside' | 'after'

/** Drop photos (media drag) or an album onto `target`. */
export function useAlbumDrop() {
  const { t, settings, updateSettings, notify } = useApp()
  const { data } = useLibrary()

  const accepts = (event: DragEvent): boolean => event.dataTransfer.types.includes(MEDIA_DRAG) || event.dataTransfer.types.includes(ALBUM_DRAG)

  const drop = async (event: DragEvent, target: Album, place: DropPlace): Promise<void> => {
    const media = event.dataTransfer.getData(MEDIA_DRAG)
    if (media) {
      const ids = JSON.parse(media) as string[]
      await api.mutate({ type: 'album.add', id: target.id, items: ids })
      return notify(t('album.added', { count: ids.length, name: target.name }))
    }
    const albumId = event.dataTransfer.getData(ALBUM_DRAG)
    if (!albumId || albumId === target.id) return
    if (place === 'inside') return void api.mutate({ type: 'album.move', id: albumId, parent: target.id })
    // Reorder among the target's siblings (moving to its level first when needed).
    const dragged = data.albums.find((a) => a.id === albumId)
    if (!dragged) return
    if (dragged.parent !== target.parent) await api.mutate({ type: 'album.move', id: albumId, parent: target.parent })
    const siblings = sortAlbums(
      data.albums.filter((a) => a.parent === target.parent && a.id !== albumId),
      settings.album_sort
    ).map((a) => a.id)
    siblings.splice(siblings.indexOf(target.id) + (place === 'after' ? 1 : 0), 0, albumId)
    await api.mutate({ type: 'album.reorder', ids: siblings })
    if (settings.album_sort !== 'manual') {
      await updateSettings({ album_sort: 'manual' })
      notify(t('album.sort_manual_now'))
    }
  }

  return { accepts, drop }
}

interface NodeProps {
  album: Album
  depth: number
  current: string | null
  expanded: Set<string>
  onToggle: (id: string) => void
  onSelect: (id: string) => void
  onMenu: (event: MouseEvent, album: Album) => void
}

function AlbumNode({ album, depth, current, expanded, onToggle, onSelect, onMenu }: NodeProps) {
  const { t, settings } = useApp()
  const { data } = useLibrary()
  const { accepts, drop } = useAlbumDrop()
  const [place, setPlace] = useState<DropPlace | null>(null)
  const children = childAlbums(data.albums, album.id, settings.album_sort)
  const open = expanded.has(album.id)

  const where = (event: DragEvent): DropPlace => {
    if (!event.dataTransfer.types.includes(ALBUM_DRAG)) return 'inside'
    const rect = event.currentTarget.getBoundingClientRect()
    const y = (event.clientY - rect.top) / rect.height
    return y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'inside'
  }

  return (
    <li role="treeitem" aria-expanded={children.length ? open : undefined} aria-selected={current === album.id}>
      <div
        className={`tree-row ${current === album.id ? 'selected' : ''} ${place ? `drop-${place}` : ''}`}
        style={{ paddingLeft: 4 + depth * 16 }}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(ALBUM_DRAG, album.id)
          e.dataTransfer.effectAllowed = 'move'
        }}
        onDragOver={(e) => {
          if (!accepts(e)) return
          e.preventDefault()
          setPlace(where(e))
        }}
        onDragLeave={() => setPlace(null)}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          const at = where(e)
          setPlace(null)
          void drop(e, album, at)
        }}
        onClick={() => onSelect(album.id)}
        onContextMenu={(e) => {
          e.preventDefault()
          onMenu(e, album)
        }}
      >
        <button
          type="button"
          className={`tree-caret ${children.length ? '' : 'invisible'}`}
          aria-label={t(open ? 'album.collapse' : 'album.expand')}
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation()
            onToggle(album.id)
          }}
        >
          <Icon name={open ? 'down' : 'forward'} size={14} />
        </button>
        <span className="tree-icon" style={album.color ? { color: FRAME_HEX[album.color] } : undefined}>
          <Icon name={album.icon} size={16} />
        </span>
        <span className="tree-name ellipsis">{album.name}</span>
        <span className="tree-count">{album.items.length}</span>
      </div>
      {open && children.length > 0 && (
        <ul role="group">
          {children.map((child) => (
            <AlbumNode key={child.id} album={child} depth={depth + 1} current={current} expanded={expanded} onToggle={onToggle} onSelect={onSelect} onMenu={onMenu} />
          ))}
        </ul>
      )}
    </li>
  )
}

export function AlbumTree({ current, expanded, onToggle, onSelect, onMenu }: Omit<NodeProps, 'album' | 'depth'>) {
  const { settings } = useApp()
  const { data } = useLibrary()
  return (
    <ul className="tree" role="tree">
      {childAlbums(data.albums, null, settings.album_sort).map((album) => (
        <AlbumNode key={album.id} album={album} depth={0} current={current} expanded={expanded} onToggle={onToggle} onSelect={onSelect} onMenu={onMenu} />
      ))}
    </ul>
  )
}
