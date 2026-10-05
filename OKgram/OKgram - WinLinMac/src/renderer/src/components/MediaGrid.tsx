// Media grid or list. Only the rows in view are rendered, so libraries with thousands of
// files scroll smoothly. Click opens; Ctrl/⌘+click, Shift+click and the corner tick select.
import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from 'react'
import type { MediaItem } from '../../../shared/ipc'
import { FRAME_HEX, metaOf, type LibraryData } from '../../../shared/model'
import { dateOf } from '../../../shared/library'
import { modKey } from '../api'
import { useApp } from '../context'
import { formatDate, formatDuration, formatSize } from '../i18n'
import { Icon } from './Icon'
import { Thumb } from './Thumb'

export const MEDIA_DRAG = 'application/x-okgram-media'
const GAP = 10
const PAD = 12
const NAME_HEIGHT = 24
const LIST_ROW = 54
const OVERSCAN = 3

interface Props {
  items: MediaItem[]
  data: LibraryData
  view: 'grid' | 'list'
  size: number
  selection: Set<string>
  onSelection: (next: Set<string>) => void
  onOpen: (index: number) => void
  onMenu: (event: MouseEvent, item: MediaItem) => void
  empty: ReactNode
}

export function MediaGrid({ items, data, view, size, selection, onSelection, onOpen, onMenu, empty }: Props) {
  const { t, settings } = useApp()
  const box = useRef<HTMLDivElement>(null)
  const anchor = useRef<string | null>(null)
  const [width, setWidth] = useState(800)
  const [height, setHeight] = useState(600)
  const [scroll, setScroll] = useState(0)

  const hasItems = items.length > 0
  // The empty state and the grid are different elements: observe whichever is shown.
  useLayoutEffect(() => {
    const element = box.current
    if (!element) return
    setWidth(element.clientWidth)
    setHeight(element.clientHeight)
    const observer = new ResizeObserver(() => {
      setWidth(element.clientWidth)
      setHeight(element.clientHeight)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [hasItems])

  // A different list (other album, filter) starts at the top.
  const first = items[0]?.id
  useEffect(() => {
    box.current?.scrollTo({ top: 0 })
  }, [first, view])

  const columns = view === 'list' ? 1 : Math.max(1, Math.floor((width - PAD * 2 + GAP) / (size + GAP)))
  const cell = view === 'list' ? width - PAD * 2 : (width - PAD * 2 - GAP * (columns - 1)) / columns
  const rowHeight = view === 'list' ? LIST_ROW : cell + NAME_HEIGHT + GAP
  const rows = Math.ceil(items.length / columns)
  const firstRow = Math.max(0, Math.floor((scroll - PAD) / rowHeight) - OVERSCAN)
  const lastRow = Math.min(rows - 1, Math.ceil((scroll + height) / rowHeight) + OVERSCAN)

  const click = (event: MouseEvent, item: MediaItem, index: number, fromTick = false): void => {
    if (event.shiftKey && anchor.current) {
      const from = items.findIndex((m) => m.id === anchor.current)
      if (from >= 0) {
        const [a, b] = from < index ? [from, index] : [index, from]
        const next = new Set(modKey(event) ? selection : [])
        for (const m of items.slice(a, b + 1)) next.add(m.id)
        return onSelection(next)
      }
    }
    if (fromTick || modKey(event) || selection.size > 0) {
      const next = new Set(selection)
      if (next.has(item.id)) next.delete(item.id)
      else next.add(item.id)
      anchor.current = item.id
      return onSelection(next)
    }
    anchor.current = item.id
    onOpen(index)
  }

  const dragStart = (event: DragEvent, item: MediaItem): void => {
    const ids = selection.has(item.id) ? items.filter((m) => selection.has(m.id)).map((m) => m.id) : [item.id]
    event.dataTransfer.setData(MEDIA_DRAG, JSON.stringify(ids))
    event.dataTransfer.effectAllowed = 'copyMove'
  }

  if (!hasItems)
    return (
      <div ref={box} className="media-scroll empty-wrap">
        {empty}
      </div>
    )

  const cells: ReactNode[] = []
  for (let row = firstRow; row <= lastRow; row++) {
    for (let col = 0; col < columns; col++) {
      const index = row * columns + col
      const item = items[index]
      if (!item) break
      const meta = metaOf(data, item.id)
      const selected = selection.has(item.id)
      const common = {
        key: item.id,
        draggable: true,
        onDragStart: (e: DragEvent) => dragStart(e, item),
        onClick: (e: MouseEvent) => click(e, item, index),
        onContextMenu: (e: MouseEvent) => {
          e.preventDefault()
          onMenu(e, item)
        },
        title: item.name,
        'aria-selected': selected,
        role: 'option'
      }
      const tick = (
        <span
          className={`tick ${selected ? 'on' : ''}`}
          role="checkbox"
          aria-checked={selected}
          aria-label={t('media.select')}
          onClick={(e) => {
            e.stopPropagation()
            click(e, item, index, true)
          }}
        >
          <Icon name="check" size={13} />
        </span>
      )
      if (view === 'list') {
        cells.push(
          <div {...common} className={`list-row ${selected ? 'selected' : ''}`} style={{ top: PAD + row * rowHeight, left: PAD, width: cell, height: LIST_ROW - 4 }}>
            {tick}
            <div className="list-thumb">
              <Thumb item={item} meta={meta} compact />
            </div>
            <span className="list-name">
              {meta.star && <Icon name="star" size={13} filled />}
              {meta.color && <span className="swatch-dot" style={{ background: FRAME_HEX[meta.color] }} title={t(`color.${meta.color}`)} />}
              <span className="ellipsis">{item.name}</span>
            </span>
            <span className="list-col muted">{formatDate(dateOf(item), settings.language)}</span>
            <span className="list-col muted narrow">{item.ext.toUpperCase()}</span>
            <span className="list-col muted narrow">
              {item.width && item.height ? `${item.width}×${item.height}` : ''}
              {item.duration ? ` · ${formatDuration(item.duration)}` : ''}
            </span>
            <span className="list-col muted narrow right">{formatSize(item.size, settings.language)}</span>
          </div>
        )
      } else {
        cells.push(
          <div
            {...common}
            className={`grid-cell ${selected ? 'selected' : ''}`}
            style={{ top: PAD + row * rowHeight, left: PAD + col * (cell + GAP), width: cell, height: cell + NAME_HEIGHT }}
          >
            <div className="grid-thumb" style={{ height: cell }}>
              <Thumb item={item} meta={meta} />
              {tick}
            </div>
            <div className="grid-name ellipsis">{item.name}</div>
          </div>
        )
      }
    }
  }

  return (
    <div
      ref={box}
      className={`media-scroll ${selection.size ? 'selecting' : ''}`}
      role="listbox"
      aria-multiselectable="true"
      onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
      onMouseDown={(e) => {
        const background = e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('media-canvas')
        if (background && e.button === 0 && selection.size && !modKey(e)) onSelection(new Set())
      }}
    >
      <div className="media-canvas" style={{ height: PAD * 2 + rows * rowHeight }}>
        {cells}
      </div>
    </div>
  )
}
