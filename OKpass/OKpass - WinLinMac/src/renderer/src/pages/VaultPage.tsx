import { useCallback, useEffect, useRef, useState } from 'react'
import type { SaveState, Screen } from '../../../shared/ipc'
import type { VaultData } from '../../../shared/model'
import { api, isMobile } from '../api'
import { IconButton } from '../components/Icon'
import { useApp } from '../context'
import { SettingsDialog } from '../dialogs/SettingsDialog'
import { useAutolock } from '../hooks/useAutolock'
import { onAppHidden } from '../mobile/shell'
import { PasswordsTab } from '../vault/PasswordsTab'
import { TextTab } from '../vault/TextTab'

type VaultScreen = Extract<Screen, { name: 'vault' }>
const SAVE_DELAY_MS = 1500
const MOD = api.platform === 'macos' ? '⌘' : 'Ctrl+'

interface Props {
  screen: VaultScreen
  registerFlush: (flush: (() => Promise<void>) | null) => void
}

export function VaultPage({ screen, registerFlush }: Props) {
  const { t, settings, notify } = useApp()
  const [vault, setVault] = useState<VaultData>(screen.vault)
  const [status, setStatus] = useState<SaveState>(screen.status)
  const [tab, setTab] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const vaultRef = useRef(vault)
  const dirty = useRef(false)
  const timer = useRef<number | undefined>(undefined)
  const textActions = useRef({ add: () => {}, search: () => {} })
  const passwordActions = useRef({ add: () => {}, search: () => {} })

  useEffect(
    () =>
      api.onStatus((next) => {
        if (!dirty.current) setStatus(next)
      }),
    []
  )

  const save = useCallback(async (): Promise<void> => {
    window.clearTimeout(timer.current)
    if (!dirty.current) return
    dirty.current = false
    setStatus('saving')
    const result = await api.saveVault(vaultRef.current)
    if (!dirty.current) setStatus(result)
  }, [])

  const change = (next: VaultData): void => {
    vaultRef.current = next
    setVault(next)
    dirty.current = true
    setStatus('dirty')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void save(), SAVE_DELAY_MS)
  }

  /** Hand unsaved edits to the main process exactly once (for lock and sign-out). */
  const takePending = (): VaultData | undefined => {
    window.clearTimeout(timer.current)
    const pending = dirty.current ? vaultRef.current : undefined
    dirty.current = false
    return pending
  }

  const lock = useCallback(async (): Promise<void> => {
    window.clearTimeout(timer.current)
    const pending = dirty.current ? vaultRef.current : undefined
    dirty.current = false
    await api.lock(pending)
  }, [])

  useEffect(() => {
    registerFlush(save)
    return () => registerFlush(null)
  }, [registerFlush, save])

  useAutolock(settings.autolock_minutes, lock)

  // Phone: leaving the app saves the edits and locks the vault.
  useEffect(() => {
    if (!isMobile) return
    let off = (): void => undefined
    let alive = true
    void onAppHidden(() => void lock()).then((remove) => (alive ? (off = remove) : remove()))
    return () => {
      alive = false
      off()
    }
  }, [lock])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const mod = api.platform === 'macos' ? event.metaKey : event.ctrlKey
      if (!mod || event.altKey || document.querySelector('.modal')) return
      const actions = tab === 0 ? textActions.current : passwordActions.current
      const key = event.key.toLowerCase()
      if (key === 's') void save()
      else if (key === 'l') void lock()
      else if (key === 'n') actions.add()
      else if (key === 'f') actions.search()
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tab, save, lock])

  return (
    <div className="page vault-page">
      <div className="vault-header">
        {['tabs.text', 'tabs.passwords'].map((key, index) => (
          <button key={key} type="button" className={`seg ${tab === index ? 'checked' : ''}`} onClick={() => setTab(index)}>
            {t(key)}
          </button>
        ))}
        <div className="grow" />
        <span className="muted user-name">{vault.username || screen.email}</span>
        <span className={`status-pill state-${status}`}>{t(`status.${status}`)}</span>
        <IconButton icon="settings" label={t('vault.settings')} onClick={() => setSettingsOpen(true)} />
        <IconButton icon="lock" label={`${t('vault.lock')} (${MOD}L)`} onClick={() => void lock()} />
      </div>
      <div className="vault-body">
        <div className={`tab-pane ${tab === 0 ? '' : 'hidden'}`}>
          <TextTab documents={vault.documents} onChange={(documents) => change({ ...vaultRef.current, documents })} actions={textActions} active={tab === 0} />
        </div>
        <div className={`tab-pane ${tab === 1 ? '' : 'hidden'}`}>
          <PasswordsTab passwords={vault.passwords} onChange={(passwords) => change({ ...vaultRef.current, passwords })} actions={passwordActions} active={tab === 1} />
        </div>
      </div>
      {settingsOpen && (
        <SettingsDialog
          email={screen.email}
          username={vault.username}
          decoySet={vault.decoySet}
          onUsername={(username) => {
            change({ ...vaultRef.current, username })
            notify(t('settings.username_saved'))
          }}
          onDecoyChange={(decoySet) => {
            vaultRef.current = { ...vaultRef.current, decoySet }
            setVault(vaultRef.current)
          }}
          flush={save}
          pendingVault={takePending}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  )
}
