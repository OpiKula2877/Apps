// What can be done with media: the right-click menu, the selection bar and shortcuts share these.
import type { MediaItem } from '../../../shared/ipc'
import { validFileName } from '../../../shared/formats'
import { FRAME_COLORS, FRAME_HEX, childAlbums, metaOf, type Album, type FrameColor } from '../../../shared/model'
import { api } from '../api'
import type { MenuItem } from '../components/ContextMenu'
import { useApp } from '../context'
import { useLibrary } from './context'

export interface MenuContext {
  /** The album being shown (adds "remove from album" and "set as cover"). */
  album?: Album | null
  /** The list the items come from, so the viewer can move to the neighbours. */
  list: MediaItem[]
}

/** Albums in tree order with their depth, for flat menus and pickers. */
export function albumOutline(albums: Album[], mode: 'manual' | 'name' | 'date'): { album: Album; depth: number }[] {
  const result: { album: Album; depth: number }[] = []
  const visit = (parent: string | null, depth: number): void => {
    for (const album of childAlbums(albums, parent, mode)) {
      result.push({ album, depth })
      if (depth < 12) visit(album.id, depth + 1)
    }
  }
  visit(null, 0)
  return result
}

export function useMediaActions() {
  const { t, settings, confirm, prompt, notify } = useApp()
  const library = useLibrary()
  const { data } = library
  const kindOf = (item: MediaItem): 'drive' | 'local' => library.sourceOf(item)?.kind ?? 'local'

  const open = (list: MediaItem[], index: number, slideshow = false): void => {
    void api.openViewer(
      list.map((m) => m.id),
      index,
      slideshow
    )
  }

  const setStar = (ids: string[], star: boolean): void => void api.mutate({ type: 'meta', ids, patch: { star } })
  const setColor = (ids: string[], color: FrameColor | null): void => void api.mutate({ type: 'meta', ids, patch: { color } })
  const rotate = (ids: string[], by: 90 | -90): void => void api.mutate({ type: 'rotate', ids, by })

  const trash = async (items: MediaItem[]): Promise<boolean> => {
    if (!items.length) return false
    const kinds = new Set(items.map(kindOf))
    const where = kinds.size > 1 ? 'mixed' : [...kinds][0]
    const text = items.length === 1 ? t(`trash.confirm_one_${where}`, { name: items[0].name }) : t(`trash.confirm_many_${where}`, { count: items.length })
    const ok = await confirm({ title: t('trash.title'), text, confirmText: t('trash.button'), danger: true })
    if (!ok) return false
    const count = await api.trash(items.map((m) => m.id))
    if (count) notify(t('trash.done', { count }))
    return count > 0
  }

  const rename = async (item: MediaItem): Promise<void> => {
    const stem = item.name.slice(0, item.name.length - item.ext.length - 1)
    const value = await prompt({
      title: t('rename.title'),
      label: t('rename.label'),
      value: stem,
      suffix: `.${item.ext}`,
      confirmText: t('rename.button'),
      validate: (v) => (validFileName(`${v.trim()}.${item.ext}`) ? null : t('rename.invalid'))
    })
    if (value === null || value === stem) return
    const result = await api.rename(item.id, value)
    if (result !== 'ok') notify(t(`rename.${result}`), true)
  }

  const share = async (item: MediaItem): Promise<void> => {
    if (kindOf(item) === 'local') {
      if (await api.share(item.id)) notify(t('share.path_copied'))
      return
    }
    if (!item.shared) {
      const ok = await confirm({ title: t('share.title'), text: t('share.confirm', { name: item.name }), confirmText: t('share.button') })
      if (!ok) return
    }
    if (await api.share(item.id)) notify(t('share.copied'))
  }

  const addToAlbum = async (ids: string[]): Promise<void> => {
    const id = await library.pickAlbum({ title: t('album.pick_title'), confirmText: t('album.add_button') })
    if (!id) return
    await api.mutate({ type: 'album.add', id, items: ids })
    notify(t('album.added', { count: ids.length, name: data.albums.find((a) => a.id === id)?.name ?? '' }))
  }

  const newAlbumWith = async (ids: string[]): Promise<void> => {
    const id = await library.editAlbum({ parent: null, items: ids })
    if (id) notify(t('album.created_with', { count: ids.length }))
  }

  const zipName = (items: MediaItem[]): string => (items.length === 1 ? items[0].name.replace(/\.[^.]+$/, '') : `OKgram-${items.length}`)

  /** The right-click menu for one or more files. */
  const menu = (items: MediaItem[], context: MenuContext): MenuItem[] => {
    const ids = items.map((m) => m.id)
    const single = items.length === 1 ? items[0] : null
    const metas = items.map((m) => metaOf(data, m.id))
    const allStarred = metas.every((m) => m.star)
    const color = metas.every((m) => m.color === metas[0].color) ? metas[0].color : undefined
    const outline = albumOutline(data.albums, settings.album_sort)
    const albumItems: MenuItem[] = [
      ...outline.slice(0, 20).map(({ album, depth }) => ({
        label: `${'  '.repeat(depth)}${album.name}`,
        checked: ids.every((id) => album.items.includes(id)),
        onSelect: () => {
          void api.mutate({ type: 'album.add', id: album.id, items: ids })
          notify(t('album.added', { count: ids.length, name: album.name }))
        }
      })),
      ...(outline.length > 20 ? [{ label: t('album.more'), separatorBefore: true, onSelect: () => void addToAlbum(ids) }] : []),
      { label: t('album.new_with'), icon: 'plus' as const, separatorBefore: outline.length > 0, onSelect: () => void newAlbumWith(ids) }
    ]
    const result: MenuItem[] = []
    if (single) {
      const index = Math.max(0, context.list.findIndex((m) => m.id === single.id))
      result.push({ label: t('menu.open'), icon: 'external', onSelect: () => open(context.list, index) })
      result.push({ label: t('menu.slideshow'), icon: 'slideshow', onSelect: () => open(context.list, index, true) })
    } else {
      result.push({ label: t('menu.open_selection', { count: items.length }), icon: 'external', onSelect: () => open(items, 0) })
      result.push({ label: t('menu.slideshow'), icon: 'slideshow', onSelect: () => open(items, 0, true) })
    }
    result.push({ label: t('menu.download'), icon: 'download', separatorBefore: true, onSelect: () => void api.download(ids) })
    if (!single) result.push({ label: t('menu.zip'), icon: 'zip', onSelect: () => void api.downloadZip(ids, zipName(items)) })
    result.push({ label: t(allStarred ? 'menu.unstar' : 'menu.star'), icon: 'star', onSelect: () => setStar(ids, !allStarred) })
    result.push({
      label: t('menu.frame'),
      icon: 'frame',
      submenu: [
        { label: t('color.none'), swatch: null, checked: color === null, onSelect: () => setColor(ids, null) },
        ...FRAME_COLORS.map((c) => ({ label: t(`color.${c}`), swatch: FRAME_HEX[c], checked: color === c, onSelect: () => setColor(ids, c) }))
      ]
    })
    result.push({ label: t('menu.add_album'), icon: 'album_add', submenu: albumItems })
    if (context.album) {
      const album = context.album
      result.push({
        label: t('menu.remove_album'),
        icon: 'album_remove',
        onSelect: () => void api.mutate({ type: 'album.remove', id: album.id, items: ids })
      })
      if (single) result.push({ label: t('menu.set_cover'), icon: 'image', onSelect: () => void api.mutate({ type: 'album.update', id: album.id, patch: { cover: single.id } }) })
    }
    if (items.some((m) => m.kind === 'image')) {
      const images = items.filter((m) => m.kind === 'image').map((m) => m.id)
      result.push({ label: t('menu.rotate_right'), icon: 'rotate_right', separatorBefore: true, onSelect: () => rotate(images, 90) })
      result.push({ label: t('menu.rotate_left'), icon: 'rotate_left', onSelect: () => rotate(images, -90) })
    }
    if (single) {
      result.push({ label: t('menu.rename'), icon: 'edit', separatorBefore: !items.some((m) => m.kind === 'image'), onSelect: () => void rename(single) })
      result.push({ label: t('menu.details'), icon: 'info', onSelect: () => library.showDetails(single) })
      result.push({ label: t(kindOf(single) === 'drive' ? 'menu.share' : 'menu.copy_path'), icon: 'link', onSelect: () => void share(single) })
      if (kindOf(single) === 'drive' && single.shared) result.push({ label: t('menu.unshare'), onSelect: () => void api.unshare(single.id).then((ok) => ok && notify(t('share.removed'))) })
      result.push({ label: t('menu.system'), icon: 'external', onSelect: () => void api.openInSystem(single.id) })
    }
    result.push({ label: t('menu.trash'), icon: 'trash', danger: true, separatorBefore: true, onSelect: () => void trash(items) })
    return result
  }

  return { open, setStar, setColor, rotate, trash, rename, share, addToAlbum, newAlbumWith, menu, zipName }
}
