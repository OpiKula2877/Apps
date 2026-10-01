import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Screen, Settings } from '../../shared/ipc'
import { resolveFlags } from '../../shared/theme'
import { api, isMobile } from './api'
import { ConfirmDialog } from './components/Modal'
import { TitleBar } from './components/TitleBar'
import { AppContext, type AppServices, type ConfirmOptions } from './context'
import { handleBack } from './hooks/backStack'
import { HelpDialog } from './dialogs/HelpDialog'
import { translator } from './i18n'
import { KeyPage } from './pages/KeyPage'
import { LoginPage } from './pages/LoginPage'
import { VaultPage } from './pages/VaultPage'
import { minimizeApp, onBackButton } from './mobile/shell'
import { applyTheme } from './theme'

interface PendingConfirm {
  options: ConfirmOptions
  resolve: (ok: boolean) => void
}

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [screen, setScreen] = useState<Screen>({ name: 'loading' })
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null)
  const [help, setHelp] = useState(false)
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null)
  const flushRef = useRef<(() => Promise<void>) | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)

  const t = useMemo(() => translator(settings?.language ?? 'cs'), [settings?.language])
  const tRef = useRef(t)
  tRef.current = t

  const notify = useCallback((text: string, error = false) => {
    setToast({ text, error })
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 4000)
  }, [])

  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => setPendingConfirm({ options, resolve })), [])

  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    setSettings(await api.updateSettings(patch))
  }, [])

  const registerFlush = useCallback((flush: (() => Promise<void>) | null) => {
    flushRef.current = flush
  }, [])

  useEffect(() => {
    void api.getSettings().then(setSettings)
    void api.getScreen().then(setScreen)
    const offs = [
      api.onScreen(setScreen),
      api.onMessage((m) => notify(tRef.current(m.key, m.params), Boolean(m.error))),
      api.onFlushRequest(async () => {
        try {
          await flushRef.current?.()
        } finally {
          api.flushDone()
        }
      })
    ]
    return () => offs.forEach((off) => off())
  }, [notify])

  useEffect(() => {
    if (settings) applyTheme(settings)
  }, [settings])

  // Android back button: close the topmost dialog or detail, otherwise send the app to the background.
  useEffect(() => {
    if (!isMobile) return
    const back = (): boolean => {
      if (handleBack()) return true
      void minimizeApp()
      return false
    }
    window.__okpassBack = back
    let off = (): void => undefined
    void onBackButton(() => void back()).then((remove) => (off = remove))
    return () => off()
  }, [])

  // A question that belongs to a screen that is gone (e.g. after auto-lock) is answered "no".
  useEffect(() => {
    setPendingConfirm((current) => {
      current?.resolve(false)
      return null
    })
  }, [screen.name])

  if (!settings) return null
  const native = isMobile || resolveFlags(settings).native_titlebar
  const services: AppServices = { t, settings, updateSettings, notify, confirm, openHelp: () => setHelp(true) }

  return (
    <AppContext.Provider value={services}>
      <div className={`window ${native ? 'native' : 'frameless'} ${isMobile ? 'mobile' : ''}`}>
        {!native && <TitleBar />}
        <main className="pages">
          {screen.name === 'login' && <LoginPage screen={screen} />}
          {screen.name === 'key' && <KeyPage screen={screen} />}
          {screen.name === 'vault' && <VaultPage key={screen.session} screen={screen} registerFlush={registerFlush} />}
        </main>
        <footer className="footer">
          <span className={`toast ${toast?.error ? 'error-text' : 'muted'}`} role="status">
            {toast?.text}
          </span>
          <button type="button" className="help-button" title={t('help.tooltip')} aria-label={t('help.tooltip')} onClick={() => setHelp(true)}>
            ?
          </button>
        </footer>
        {help && <HelpDialog onClose={() => setHelp(false)} />}
        {pendingConfirm && (
          <ConfirmDialog
            options={pendingConfirm.options}
            onDone={(ok) => {
              pendingConfirm.resolve(ok)
              setPendingConfirm(null)
            }}
          />
        )}
      </div>
    </AppContext.Provider>
  )
}
