// Right-click menu of an album (tree, cards and the album header share it).
import { albumMedia } from '../../../shared/library'
import { descendants, newId, type Album } from '../../../shared/model'
import { api } from '../api'
import type { MenuItem } from '../components/ContextMenu'
import { useApp } from '../context'
import { useLibrary } from './context'

export function useAlbumActions(onSelect: (id: string | null) => void) {
  const { t, confirm, notify } = useApp()
  const library = useLibrary()
  const { data, media } = library

  const remove = async (album: Album): Promise<void> => {
    const below = descendants(data.albums, album.id).size - 1
    const ok = await confirm({
      title: t('album.delete_title'),
      text: t(below ? 'album.delete_confirm_sub' : 'album.delete_confirm', { name: album.name, count: below }),
      confirmText: t('album.delete'),
      danger: true
    })
    if (!ok) return
    await api.mutate({ type: 'album.delete', id: album.id })
    onSelect(album.parent)
    notify(t('album.deleted', { name: album.name }))
  }

  const move = async (album: Album): Promise<void> => {
    const target = await library.pickAlbum({
      title: t('album.move_title', { name: album.name }),
      confirmText: t('album.move_button'),
      exclude: descendants(data.albums, album.id),
      allowTop: true
    })
    if (target === undefined || target === album.parent) return
    await api.mutate({ type: 'album.move', id: album.id, parent: target })
  }

  const duplicate = async (album: Album): Promise<void> => {
    const id = newId()
    await api.mutate({ type: 'album.duplicate', id: album.id, newId: id, name: t('album.copy_name', { name: album.name }) })
    onSelect(id)
  }

  const subalbum = async (album: Album | null): Promise<void> => {
    const id = await library.editAlbum({ parent: album?.id ?? null })
    if (id) onSelect(id)
  }

  const menu = (album: Album): MenuItem[] => {
    const items = albumMedia(album.items, media)
    return [
      { label: t('album.open'), icon: 'external', onSelect: () => onSelect(album.id) },
      { label: t('menu.slideshow'), icon: 'slideshow', disabled: !items.length, onSelect: () => void api.openViewer(items.map((m) => m.id), 0, true) },
      { label: t('album.new_sub'), icon: 'plus', separatorBefore: true, onSelect: () => void subalbum(album) },
      { label: t('album.edit'), icon: 'edit', onSelect: () => void library.editAlbum({ album }) },
      { label: t('album.move'), icon: 'move', onSelect: () => void move(album) },
      { label: t('album.duplicate'), icon: 'copy', onSelect: () => void duplicate(album) },
      { label: t('album.zip'), icon: 'zip', disabled: !items.length, onSelect: () => void api.downloadZip(items.map((m) => m.id), album.name) },
      { label: t('album.delete'), icon: 'trash', danger: true, separatorBefore: true, onSelect: () => void remove(album) }
    ]
  }

  return { menu, remove, move, duplicate, subalbum }
}
