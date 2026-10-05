// Albums tab: smart albums and the album tree on the left, the chosen album on the right.
import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import type { MediaItem } from '../../../shared/ipc'
import { SMART_ALBUMS, albumMedia, isSmart, smartAlbumMedia, type SmartAlbum } from '../../../shared/library'
import { FRAME_HEX, albumPath, childAlbums, metaOf, type Album } from '../../../shared/model'
import { api } from '../api'
import { ContextMenu, type MenuState } from '../components/ContextMenu'
import { Icon, IconButton, type IconName } from '../components/Icon'
import { Thumb } from '../components/Thumb'
import { useApp } from '../context'
import { useAlbumActions } from './albumMenu'
import { AlbumTree, useAlbumDrop } from './AlbumTree'
import { useLibrary } from './context'
import { MediaBrowser } from './MediaBrowser'

export const SMART_ICONS: Record<SmartAlbum, IconName> = {
  'smart:favorites': 'star',
  'smart:photos': 'image',
  'smart:videos': 'film',
  'smart:recent': 'clock'
}

interface Props {
  active: boolean
  current: string | null
  onSelect: (id: string | null) => void
}

function coverOf(album: Album, byId: Map<string, MediaItem>): MediaItem | null {
  if (album.cover && byId.has(album.cover)) return byId.get(album.cover)!
  for (const id of album.items) if (byId.has(id)) return byId.get(id)!
  return null
}

function AlbumCard({ album, onSelect, onMenu }: { album: Album; onSelect: (id: string) => void; onMenu: (event: MouseEvent, album: Album) => void }) {
  const { t, settings } = useApp()
  const { byId, data } = useLibrary()
  const { accepts, drop } = useAlbumDrop()
  const [over, setOver] = useState(false)
  const cover = coverOf(album, byId)
  const subs = childAlbums(data.albums, album.id, settings.album_sort).length
  return (
    <button
      type="button"
      className={`album-card ${over ? 'drop-inside' : ''}`}
      onClick={() => onSelect(album.id)}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu(e, album)
      }}
      onDragOver={(e) => {
        if (!accepts(e)) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        void drop(e, album, 'inside')
      }}
    >
      <div className="album-cover">
        {cover ? (
          <Thumb item={cover} meta={{ ...metaOf(data, cover.id), color: null, star: false }} compact />
        ) : (
          <div className="thumb-placeholder" style={album.color ? { color: FRAME_HEX[album.color] } : undefined}>
            <Icon name={album.icon} size={36} />
          </div>
        )}
      </div>
      <div className="album-card-name">
        <span style={album.color ? { color: FRAME_HEX[album.color] } : undefined}>
          <Icon name={album.icon} size={15} />
        </span>
        <span className="ellipsis">{album.name}</span>
      </div>
      <div className="album-card-meta muted">
        {t('album.items', { count: album.items.length })}
        {subs ? ` · ${t('album.subalbums', { count: subs })}` : ''}
      </div>
    </button>
  )
}

export function AlbumsTab({ active, current, onSelect }: Props) {
  const { t, settings, updateSettings } = useApp()
  const library = useLibrary()
  const { data, media } = library
  const albumActions = useAlbumActions(onSelect)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const album = current && !isSmart(current) ? (data.albums.find((a) => a.id === current) ?? null) : null
  // The chosen album was deleted (here or on another computer).
  useEffect(() => {
    if (current && !isSmart(current) && !album) onSelect(null)
  }, [current, album, onSelect])
  // Open the parents of a newly chosen album, so it is visible in the tree.
  const albumId = album?.id
  useEffect(() => {
    if (!albumId) return
    const parents = albumPath(data.albums, albumId).slice(0, -1).map((a) => a.id)
    if (parents.length) setExpanded((e) => (parents.every((id) => e.has(id)) ? e : new Set([...e, ...parents])))
  }, [albumId])

  const openMenu = (event: MouseEvent, target: Album): void => setMenu({ x: event.clientX, y: event.clientY, items: albumActions.menu(target) })
  const toggle = (id: string): void =>
    setExpanded((e) => {
      const next = new Set(e)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const smartCounts = useMemo(() => Object.fromEntries(SMART_ALBUMS.map((id) => [id, smartAlbumMedia(id, media, data).length])), [media, data])
  const source = useMemo(() => {
    if (current && isSmart(current)) return smartAlbumMedia(current, media, data)
    if (album) return albumMedia(album.items, media)
    return []
  }, [current, album, media, data])

  const children = childAlbums(data.albums, album?.id ?? null, settings.album_sort)

  const sidebar = (
    <aside className="side album-side">
      <button type="button" className="primary" onClick={() => void albumActions.subalbum(null)}>
        <Icon name="plus" size={16} /> {t('album.new')}
      </button>
      <div className="side-scroll">
        <div className="side-heading">{t('album.smart')}</div>
        <ul className="tree">
          {SMART_ALBUMS.map((id) => (
            <li key={id}>
              <div className={`tree-row ${current === id ? 'selected' : ''}`} onClick={() => onSelect(id)}>
                <span className="tree-caret invisible" />
                <span className="tree-icon">
                  <Icon name={SMART_ICONS[id]} size={16} />
                </span>
                <span className="tree-name ellipsis">{t(`smart.${id.slice(6)}`)}</span>
                <span className="tree-count">{smartCounts[id]}</span>
              </div>
            </li>
          ))}
        </ul>
        <div className="side-heading row">
          <span className="grow">{t('album.mine')}</span>
          <select className="mini-select" value={settings.album_sort} aria-label={t('album.sort')} onChange={(e) => void updateSettings({ album_sort: e.target.value as typeof settings.album_sort })}>
            <option value="manual">{t('album.sort_manual')}</option>
            <option value="name">{t('album.sort_name')}</option>
            <option value="date">{t('album.sort_date')}</option>
          </select>
        </div>
        {data.albums.length ? (
          <AlbumTree current={current} expanded={expanded} onToggle={toggle} onSelect={onSelect} onMenu={openMenu} />
        ) : (
          <p className="muted empty-hint">{t('album.empty_tree')}</p>
        )}
      </div>
    </aside>
  )

  const cards = (list: Album[]) =>
    list.length > 0 && (
      <div className="album-cards">
        {list.map((a) => (
          <AlbumCard key={a.id} album={a} onSelect={onSelect} onMenu={openMenu} />
        ))}
      </div>
    )

  let main
  if (current && isSmart(current)) {
    main = (
      <MediaBrowser
        key={current}
        source={source}
        ownOrder={current === 'smart:recent'}
        active={active}
        header={
          <div className="album-header">
            <span className="album-header-icon">
              <Icon name={SMART_ICONS[current]} size={26} />
            </span>
            <div className="grow">
              <h1 className="heading">{t(`smart.${current.slice(6)}`)}</h1>
              <p className="muted">{t(`smart.${current.slice(6)}_info`)}</p>
            </div>
            <IconButton icon="slideshow" label={t('menu.slideshow')} disabled={!source.length} onClick={() => void api.openViewer(source.map((m) => m.id), 0, true)} />
          </div>
        }
        empty={<p className="empty">{t(`smart.${current.slice(6)}_empty`)}</p>}
      />
    )
  } else if (album) {
    const path = albumPath(data.albums, album.id)
    main = (
      <MediaBrowser
        key={album.id}
        source={source}
        album={album}
        active={active}
        header={
          <>
            <div className="album-header">
              <span className="album-header-icon" style={album.color ? { color: FRAME_HEX[album.color] } : undefined}>
                <Icon name={album.icon} size={26} />
              </span>
              <div className="grow min0">
                <nav className="breadcrumb" aria-label={t('album.path')}>
                  <button type="button" className="link" onClick={() => onSelect(null)}>
                    {t('tabs.albums')}
                  </button>
                  {path.slice(0, -1).map((p) => (
                    <span key={p.id}>
                      {' › '}
                      <button type="button" className="link" onClick={() => onSelect(p.id)}>
                        {p.name}
                      </button>
                    </span>
                  ))}
                </nav>
                <h1 className="heading ellipsis">{album.name}</h1>
                <p className="muted">
                  {t('album.items', { count: source.length })}
                  {children.length ? ` · ${t('album.subalbums', { count: children.length })}` : ''}
                </p>
              </div>
              <button type="button" onClick={() => void albumActions.subalbum(album)}>
                <Icon name="plus" size={16} /> {t('album.new_sub')}
              </button>
              <IconButton icon="edit" label={t('album.edit')} onClick={() => void library.editAlbum({ album })} />
              <IconButton icon="slideshow" label={t('menu.slideshow')} disabled={!source.length} onClick={() => void api.openViewer(source.map((m) => m.id), 0, true)} />
              <IconButton icon="more" label={t('album.more_actions')} onClick={(e) => setMenu({ x: e.clientX, y: e.clientY, items: albumActions.menu(album) })} />
            </div>
            {cards(children)}
          </>
        }
        empty={<p className="empty">{t('album.empty')}</p>}
      />
    )
  } else {
    const top = childAlbums(data.albums, null, settings.album_sort)
    main = (
      <div className="album-overview">
        <h1 className="heading">{t('tabs.albums')}</h1>
        <div className="smart-cards">
          {SMART_ALBUMS.map((id) => (
            <button key={id} type="button" className="smart-card" onClick={() => onSelect(id)}>
              <Icon name={SMART_ICONS[id]} size={22} />
              <span className="grow ellipsis">{t(`smart.${id.slice(6)}`)}</span>
              <span className="muted">{smartCounts[id]}</span>
            </button>
          ))}
        </div>
        <h2 className="subheading">{t('album.mine')}</h2>
        {top.length ? (
          cards(top)
        ) : (
          <div className="empty-card">
            <Icon name="folder" size={36} />
            <p>{t('album.first_info')}</p>
            <button type="button" className="primary" onClick={() => void albumActions.subalbum(null)}>
              <Icon name="plus" size={16} /> {t('album.first')}
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="split">
      {sidebar}
      <div className="main-panel">{main}</div>
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </div>
  )
}

