import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppStatus, Settings } from '../../shared/ipc'
import { resolveFlags } from '../../shared/theme'
import { api } from './api'
import { ConfirmDialog } from './components/Modal'
import { TitleBar } from './components/TitleBar'
import { AppContext, type AppServices, type ConfirmOptions } from './context'
import { DataProvider } from './data'
import { HelpDialog } from './dialogs/HelpDialog'
import { translator } from './i18n'
import { handleBack, installBackButton, isAndroid, usePhone } from './mobile/phone'
import { Okfetch, isNative } from './mobile/native'
import { KeysPage } from './pages/KeysPage'
import { MainPage } from './pages/MainPage'
import { StoragePathPage } from './pages/StoragePathPage'
import { applyTheme } from './theme'

interface PendingConfirm {
  options: ConfirmOptions
  resolve: (ok: boolean) => void
}

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [status, setStatus] = useState<AppStatus>({ phase: 'starting' })
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null)
  const [help, setHelp] = useState(false)
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null)
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

  useEffect(() => {
    void api.getSettings().then(setSettings)
    void api.getStatus().then(setStatus)
    return api.onEvent((event) => {
      if (event.type === 'app') setStatus(event.status)
    })
  }, [])

  useEffect(() => {
    if (!settings) return
    applyTheme(settings)
    if (settings.theme !== 'system') return
    // "Follow the system": repaint when the phone switches between light and dark.
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const repaint = (): void => applyTheme(settings)
    media.addEventListener('change', repaint)
    return () => media.removeEventListener('change', repaint)
  }, [settings])

  const phone = usePhone()
  const android = isAndroid()
  useEffect(() => {
    if (!android) return
    void installBackButton()
    // Browser UI tests press "Back" through this.
    if (!isNative) Object.assign(window, { __okfetchBack: handleBack })
    // Android 13+ asks once whether OKfetch may show notifications.
    if (isNative && settings?.notifications && !localStorage.getItem('okfetch.notifications_asked')) {
      localStorage.setItem('okfetch.notifications_asked', '1')
      void Okfetch.requestNotifications().catch(() => undefined)
    }
  }, [android, settings?.notifications])

  if (!settings) return null
  // The phone has no window frame of its own: no custom title bar there.
  const native = android || resolveFlags(settings).native_titlebar
  const services: AppServices = { t, settings, updateSettings, notify, confirm, openHelp: () => setHelp(true) }

  return (
    <AppContext.Provider value={services}>
      <div className={`window ${native ? 'native' : 'frameless'} ${android ? 'android' : ''} ${phone ? 'phone' : ''}`}>
        {!native && <TitleBar />}
        <main className="pages">
          {status.phase === 'storage' && <StoragePathPage path={status.path} error={status.error} />}
          {status.phase === 'keys' && <KeysPage />}
          {status.phase === 'ready' && (
            <DataProvider onIncoming={(event) => event.type === 'request' && notify(t('toast.new_request', { name: event.title }))}>
              <MainPage />
            </DataProvider>
          )}
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
