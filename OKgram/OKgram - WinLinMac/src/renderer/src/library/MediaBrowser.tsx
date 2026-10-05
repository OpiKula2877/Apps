// Toolbar, selection bar, grid and right-click menu for one list of media (all media,
// an album or a smart album).
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import type { MediaItem, SortBy } from '../../../shared/ipc'
import { NO_FILTER, filterMedia, sortMedia, type MediaFilter } from '../../../shared/library'
import type { Album } from '../../../shared/model'
import { modKey } from '../api'
import { ContextMenu, type MenuState } from '../components/ContextMenu'
import { MediaGrid } from '../components/MediaGrid'
import { anyModalOpen } from '../components/Modal'
import { useApp } from '../context'
import { useMediaActions } from './actions'
import { useLibrary } from './context'
import { MediaToolbar } from './MediaToolbar'
import { SelectionBar } from './SelectionBar'

const SORTS: SortBy[] = ['date', 'name', 'format', 'size']

interface Props {
  source: MediaItem[]
  /** The album shown; enables album order and "remove from album". */
  album?: Album | null
  /** Smart album "recently added" keeps its own order. */
  ownOrder?: boolean
  active: boolean
  empty: ReactNode
  header?: ReactNode
}

export function MediaBrowser({ source, album = null, ownOrder = false, active, empty, header }: Props) {
  const { t, settings, updateSettings } = useApp()
  const { data } = useLibrary()
  const actions = useMediaActions()
  const [filter, setFilter] = useState<MediaFilter>(NO_FILTER)
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [localSort, setLocalSort] = useState<{ by: string; desc: boolean }>({ by: 'album', desc: false })
  const searchRef = useRef<HTMLInputElement>(null)
  const keepOrder = Boolean(album) || ownOrder
  const sort = keepOrder ? localSort : { by: settings.sort_by, desc: settings.sort_desc }

  const items = useMemo(() => {
    const filtered = filterMedia(source, data, filter)
    if (keepOrder && sort.by === 'album') return sort.desc ? [...filtered].reverse() : filtered
    return sortMedia(filtered, sort.by as SortBy, sort.desc)
  }, [source, data, filter, keepOrder, sort.by, sort.desc])

  // Forget selected files that are gone (deleted, filtered out).
  useEffect(() => {
    setSelection((current) => {
      if (!current.size) return current
      const visible = new Set(items.map((m) => m.id))
      const next = new Set([...current].filter((id) => visible.has(id)))
      return next.size === current.size ? current : next
    })
  }, [items])

  const selected = useMemo(() => items.filter((m) => selection.has(m.id)), [items, selection])
  const context = { album, list: items }

  useEffect(() => {
    if (!active) return
    const onKey = (event: KeyboardEvent): void => {
      if (anyModalOpen() || document.querySelector('.context-menu')) return
      const typing = (event.target as HTMLElement)?.matches?.('input, select, textarea')
      const key = event.key.toLowerCase()
      if (modKey(event) && key === 'f') {
        event.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      } else if (typing) {
        return
      } else if (modKey(event) && key === 'a') {
        event.preventDefault()
        setSelection(new Set(items.map((m) => m.id)))
      } else if (event.key === 'Escape' && selection.size) {
        setSelection(new Set())
      } else if (event.key === 'Delete' && selected.length) {
        void actions.trash(selected).then((ok) => ok && setSelection(new Set()))
      } else if (event.key === 'Enter' && selected.length) {
        actions.open(items, items.indexOf(selected[0]))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, items, selection, selected, actions])

  const openMenu = (event: MouseEvent, item: MediaItem): void => {
    const targets = selection.has(item.id) ? selected : [item]
    if (!selection.has(item.id) && selection.size) setSelection(new Set())
    setMenu({ x: event.clientX, y: event.clientY, items: actions.menu(targets, context) })
  }

  return (
    <div className="media-browser">
      {header}
      {selection.size ? (
        <SelectionBar items={selected} context={context} onClear={() => setSelection(new Set())} onSelectAll={() => setSelection(new Set(items.map((m) => m.id)))} />
      ) : (
        <MediaToolbar
          filter={filter}
          onFilter={setFilter}
          sort={sort.by}
          sortOptions={keepOrder ? ['album', ...SORTS] : SORTS}
          onSort={(by) => (keepOrder ? setLocalSort({ ...localSort, by }) : void updateSettings({ sort_by: by as SortBy }))}
          desc={sort.desc}
          onDesc={(desc) => (keepOrder ? setLocalSort({ ...localSort, desc }) : void updateSettings({ sort_desc: desc }))}
          count={items.length}
          total={source.length}
          searchRef={searchRef}
        />
      )}
      <MediaGrid
        items={items}
        data={data}
        view={settings.view}
        size={settings.thumb_size}
        selection={selection}
        onSelection={setSelection}
        onOpen={(index) => actions.open(items, index)}
        onMenu={openMenu}
        empty={source.length ? <p className="empty">{t('media.nothing_found')}</p> : empty}
      />
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </div>
  )
}
