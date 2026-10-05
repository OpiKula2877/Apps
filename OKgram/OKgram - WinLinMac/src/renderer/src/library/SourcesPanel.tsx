// Sources panel (right side): local folders and Google Drive accounts. A tick shows or hides
// a source's files everywhere in the library.
import { useState, type MouseEvent } from 'react'
import type { SourceState } from '../../../shared/ipc'
import { FRAME_HEX } from '../../../shared/model'
import { api } from '../api'
import { ContextMenu, type MenuItem, type MenuState } from '../components/ContextMenu'
import { Icon, IconButton } from '../components/Icon'
import { useApp } from '../context'

interface Props {
  sources: SourceState[]
  onAdd: () => void
  onEdit: (source: SourceState) => void
  onHide: () => void
}

export function SourcesPanel({ sources, onAdd, onEdit, onHide }: Props) {
  const { t, confirm, notify } = useApp()
  const [menu, setMenu] = useState<MenuState | null>(null)

  const reconnect = async (source: SourceState): Promise<void> => {
    const result = await api.reconnectSource(source.id, t('login.browser_success'))
    if (!result.ok && result.error) notify(t(result.error.key, result.error.params), true)
  }

  const remove = async (source: SourceState): Promise<void> => {
    const ok = await confirm({
      title: t('source.remove_title'),
      text: t(source.kind === 'drive' ? 'source.remove_confirm_drive' : 'source.remove_confirm_local', { name: source.name }),
      confirmText: t('source.remove'),
      danger: true
    })
    if (!ok) return
    if ((await api.removeSource(source.id)) === 'pending') {
      const force = await confirm({ title: t('source.remove_title'), text: t('logout.pending_confirm'), confirmText: t('source.remove'), danger: true })
      if (force) await api.removeSource(source.id, true)
    }
  }

  const items = (source: SourceState): MenuItem[] => [
    { label: t('source.edit'), icon: 'edit', onSelect: () => onEdit(source) },
    { label: t('source.only_this'), icon: 'check', onSelect: () => void showOnly(source.id) },
    ...(source.status === 'login' ? [{ label: t('source.reconnect'), icon: 'google' as const, onSelect: () => void reconnect(source) }] : []),
    { label: t('media.refresh'), icon: 'refresh', onSelect: () => void api.refresh() },
    { label: t('source.remove'), icon: 'trash', danger: true, separatorBefore: true, onSelect: () => void remove(source) }
  ]

  const showOnly = async (id: string): Promise<void> => {
    for (const s of sources) if (s.enabled !== (s.id === id)) await api.updateSource(s.id, { enabled: s.id === id })
  }

  const openMenu = (event: MouseEvent, source: SourceState): void => {
    event.preventDefault()
    setMenu({ x: event.clientX, y: event.clientY, items: items(source) })
  }

  const hidden = sources.filter((s) => !s.enabled).length

  return (
    <aside className="sources-panel" aria-label={t('source.title')}>
      <div className="sources-head">
        <span className="side-heading grow">{t('source.title')}</span>
        {sources.length > 0 && <IconButton icon="close" size={15} label={t('source.hide_panel')} onClick={onHide} />}
      </div>
      {sources.length > 0 && (
        <ul className="source-list">
          {sources.map((source) => (
            <li key={source.id} className={`source-row status-${source.status} ${source.enabled ? '' : 'off'}`} onContextMenu={(e) => openMenu(e, source)}>
              <input
                type="checkbox"
                checked={source.enabled}
                aria-label={t('source.show', { name: source.name })}
                title={t('source.show', { name: source.name })}
                onChange={(e) => void api.updateSource(source.id, { enabled: e.target.checked })}
              />
              <span className="source-icon" style={source.color ? { color: FRAME_HEX[source.color] } : undefined}>
                <Icon name={source.icon} size={18} />
              </span>
              <span className="source-text min0" onDoubleClick={() => onEdit(source)}>
                <span className="source-name ellipsis" title={source.name}>
                  {source.name}
                </span>
                <span className="source-sub ellipsis" title={source.kind === 'drive' ? source.account?.email : (source.path ?? '')}>
                  {source.kind === 'drive' ? (source.account?.email ?? t('source.drive')) : source.path}
                </span>
                {source.status === 'login' ? (
                  <button type="button" className="link source-action" onClick={() => void reconnect(source)}>
                    {t('source.reconnect')}
                  </button>
                ) : source.message ? (
                  <span className={`source-sub ${source.message.error ? 'error-text' : ''}`}>{t(source.message.key, source.message.params)}</span>
                ) : null}
              </span>
              <span className="source-count">
                {source.loading || source.status === 'connecting' ? <span className="spinning"><Icon name="refresh" size={13} /></span> : source.count}
              </span>
              <IconButton icon="more" size={15} label={t('source.actions')} className="source-more" onClick={(e) => openMenu(e, source)} />
            </li>
          ))}
        </ul>
      )}
      {hidden > 0 && (
        <button type="button" className="link" onClick={() => sources.forEach((s) => !s.enabled && void api.updateSource(s.id, { enabled: true }))}>
          {t('source.show_all')}
        </button>
      )}
      <button type="button" className={sources.length ? '' : 'primary'} onClick={onAdd}>
        <Icon name="plus" size={16} /> {t('source.add_button')}
      </button>
      {sources.length > 1 && <p className="muted small">{t('source.filter_hint')}</p>}
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </aside>
  )
}
