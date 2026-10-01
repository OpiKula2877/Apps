import { useMemo, useRef, useState, type MutableRefObject } from 'react'
import { entrySearchText, entryTitle, entryUsername, newEntry, type PasswordEntry } from '../../../shared/model'
import { api } from '../api'
import { Icon } from '../components/Icon'
import { useApp } from '../context'
import { useBackHandler, useNarrow } from '../hooks/backStack'
import { EntryEditor } from './EntryEditor'

const MOD = api.platform === 'macos' ? '⌘' : 'Ctrl+'

interface Props {
  passwords: PasswordEntry[]
  onChange: (passwords: PasswordEntry[]) => void
  actions: MutableRefObject<{ add: () => void; search: () => void }>
  /** The tab is visible (only then it answers the Android back button). */
  active: boolean
}

const UNTITLED_LAST = String.fromCharCode(0xffff)
const sortKey = (e: PasswordEntry): string => entryTitle(e).toLocaleLowerCase() || UNTITLED_LAST

export function PasswordsTab({ passwords, onChange, actions, active }: Props) {
  const { t, confirm } = useApp()
  const sorted = useMemo(
    () => [...passwords].sort((a, b) => sortKey(a).localeCompare(sortKey(b)) || a.created - b.created),
    // Re-sort only when entries are added or removed, so the list does not jump while typing.
    [passwords.length]
  )
  const order = sorted.map((e) => e.id)
  const byId = new Map(passwords.map((e) => [e.id, e]))
  const [selectedId, setSelectedId] = useState<string | null>(order[0] ?? null)
  const [search, setSearch] = useState('')
  const [fresh, setFresh] = useState<string | null>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  // Phone: the list and the open entry are shown one at a time.
  const narrow = useNarrow()
  const [detail, setDetail] = useState(false)
  useBackHandler(active && narrow && detail, () => setDetail(false))

  const needle = search.trim().toLocaleLowerCase()
  const visible = order.map((id) => byId.get(id)).filter((e): e is PasswordEntry => Boolean(e) && (!needle || entrySearchText(e!).includes(needle)))
  const current = selectedId ? byId.get(selectedId) ?? null : null
  const display = (e: PasswordEntry): string => entryTitle(e).trim() || t('entry.untitled')

  const add = (): void => {
    const entry = newEntry()
    onChange([...passwords, entry])
    setSearch('')
    setSelectedId(entry.id)
    setFresh(entry.id)
    setDetail(true)
  }

  const remove = async (): Promise<void> => {
    if (!current) return
    const ok = await confirm({
      title: t('entry.delete'),
      text: t('entry.delete_confirm', { name: display(current) }),
      confirmText: t('common.delete'),
      danger: true
    })
    if (!ok) return
    const index = order.indexOf(current.id)
    const rest = order.filter((id) => id !== current.id)
    onChange(passwords.filter((e) => e.id !== current.id))
    setSelectedId(rest[Math.min(index, rest.length - 1)] ?? null)
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
    <div className="split">
      {showList && (
      <aside className="side">
        <button type="button" className="primary" title={`${t('passwords.add')} (${MOD}N)`} onClick={add}>
          <Icon name="plus" size={16} /> {t('passwords.add')}
        </button>
        <div className="search">
          <Icon name="search" size={16} />
          <input ref={searchInput} type="search" value={search} placeholder={t('passwords.search')} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <ul className="list two-line" role="listbox">
          {visible.map((e) => (
            <li key={e.id} role="option" aria-selected={e.id === selectedId} className={e.id === selectedId ? 'selected' : ''} onClick={() => {
              setSelectedId(e.id)
              setFresh(null)
              setDetail(true)
            }}>
              <span className="item-title">{display(e)}</span>
              <span className="item-sub">{entryUsername(e)}</span>
            </li>
          ))}
        </ul>
        {narrow && !passwords.length && <p className="muted center empty-hint">{t('passwords.empty')}</p>}
      </aside>
      )}
      {showDetail && (
      <section className="main-panel scroll">
        {current ? (
          <EntryEditor
            key={current.id}
            entry={current}
            focusTitle={fresh === current.id}
            onChange={(entry) => onChange(passwords.map((e) => (e.id === entry.id ? entry : e)))}
            onDelete={remove}
            onBack={narrow ? () => setDetail(false) : undefined}
          />
        ) : (
          <div className="empty muted">{t('passwords.empty')}</div>
        )}
      </section>
      )}
    </div>
  )
}
