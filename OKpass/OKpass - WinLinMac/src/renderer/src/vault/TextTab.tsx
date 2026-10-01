import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { newDocument, nowSeconds, type TextDocument } from '../../../shared/model'
import { api } from '../api'
import { Icon, IconButton } from '../components/Icon'
import { useApp } from '../context'
import { useBackHandler, useNarrow } from '../hooks/backStack'
import { RichEditor } from './RichEditor'

const MOD = api.platform === 'macos' ? '⌘' : 'Ctrl+'

export const formatTime = (seconds: number): string => {
  const d = new Date(seconds * 1000)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${two(d.getDate())}.${two(d.getMonth() + 1)}.${d.getFullYear()} ${two(d.getHours())}:${two(d.getMinutes())}`
}

const plainText = (html: string): string => new DOMParser().parseFromString(html, 'text/html').body.textContent ?? ''

interface Props {
  documents: TextDocument[]
  onChange: (documents: TextDocument[]) => void
  actions: MutableRefObject<{ add: () => void; search: () => void }>
  /** The tab is visible (only then it answers the Android back button). */
  active: boolean
}

export function TextTab({ documents, onChange, actions, active }: Props) {
  const { t, confirm } = useApp()
  const sorted = useMemo(() => [...documents].sort((a, b) => b.created - a.created), [documents])
  const [selectedId, setSelectedId] = useState<string | null>(sorted[0]?.id ?? null)
  const [search, setSearch] = useState('')
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [focusTitle, setFocusTitle] = useState(false)
  // Phone: the list and the open document are shown one at a time.
  const narrow = useNarrow()
  const [detail, setDetail] = useState(false)
  useBackHandler(active && narrow && detail, () => setDetail(false))
  const titleInput = useRef<HTMLInputElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)

  const current = documents.find((d) => d.id === selectedId) ?? null
  const needle = search.trim().toLocaleLowerCase()
  const visible = needle
    ? sorted.filter((d) => d.title.toLocaleLowerCase().includes(needle) || plainText(d.html).toLocaleLowerCase().includes(needle))
    : sorted
  const display = (d: TextDocument): string => d.title.trim() || t('text.untitled')

  useEffect(() => {
    if (focusTitle && titleInput.current) {
      titleInput.current.focus()
      titleInput.current.select()
      setFocusTitle(false)
    }
  }, [focusTitle, selectedId])

  const update = (patch: Partial<TextDocument>): void => {
    if (!current) return
    onChange(documents.map((d) => (d.id === current.id ? { ...d, ...patch, modified: nowSeconds() } : d)))
  }

  const add = (): void => {
    const doc = newDocument(t('text.new_title'))
    onChange([...documents, doc])
    setSearch('')
    setSelectedId(doc.id)
    setDetail(true)
    setFocusTitle(true)
  }

  const remove = async (): Promise<void> => {
    if (!current) return
    const ok = await confirm({
      title: t('text.delete'),
      text: t('text.delete_confirm', { name: display(current) }),
      confirmText: t('common.delete'),
      danger: true
    })
    if (!ok) return
    const index = sorted.findIndex((d) => d.id === current.id)
    const rest = sorted.filter((d) => d.id !== current.id)
    onChange(documents.filter((d) => d.id !== current.id))
    setSelectedId(rest[Math.min(index, rest.length - 1)]?.id ?? null)
    setDetail(false)
  }

  actions.current = {
    add,
    search: () => {
      searchInput.current?.focus()
      searchInput.current?.select()
    }
  }

  const showList = !narrow || !detail || !current
  const showDetail = !narrow || (detail && current !== null)

  return (
    <div className="split" onClick={() => setMenu(null)}>
      {showList && (
      <aside className="side">
        <button type="button" className="primary" title={`${t('text.add')} (${MOD}N)`} onClick={add}>
          <Icon name="plus" size={16} /> {t('text.add')}
        </button>
        <div className="search">
          <Icon name="search" size={16} />
          <input ref={searchInput} type="search" value={search} placeholder={t('text.search')} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <ul className="list" role="listbox">
          {visible.map((d) => (
            <li
              key={d.id}
              role="option"
              aria-selected={d.id === selectedId}
              className={d.id === selectedId ? 'selected' : ''}
              onClick={() => {
                setSelectedId(d.id)
                setDetail(true)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                setSelectedId(d.id)
                setMenu({ x: e.clientX, y: e.clientY })
              }}
            >
              {display(d)}
            </li>
          ))}
        </ul>
        {narrow && !documents.length && <p className="muted center empty-hint">{t('text.empty')}</p>}
      </aside>
      )}
      {showDetail && (
      <section className="main-panel">
        {current ? (
          <div className="editor-page">
            <div className="title-row">
              {narrow && <IconButton icon="back" label={t('common.back')} className="back-button" onClick={() => setDetail(false)} />}
              <input
                ref={titleInput}
                className="title-edit"
                value={current.title}
                placeholder={t('text.title_placeholder')}
                onChange={(e) => update({ title: e.target.value })}
              />
              <IconButton icon="trash" label={t('text.delete')} tone="danger" onClick={remove} />
            </div>
            <div className="muted meta">
              {t('common.created_modified', { created: formatTime(current.created), modified: formatTime(current.modified) })}
            </div>
            <RichEditor key={current.id} html={current.html} onChange={(html) => update({ html })} />
          </div>
        ) : (
          <div className="empty muted">{t('text.empty')}</div>
        )}
      </section>
      )}
      {menu && (
        <div className="context-menu" style={{ left: menu.x, top: menu.y }}>
          <button type="button" onClick={() => setFocusTitle(true)}>
            {t('text.rename')}
          </button>
          <button type="button" onClick={remove}>
            {t('text.delete')}
          </button>
        </div>
      )}
    </div>
  )
}
