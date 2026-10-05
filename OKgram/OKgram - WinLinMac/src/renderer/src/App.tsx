import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Screen, Settings } from '../../shared/ipc'
import { resolveFlags } from '../../shared/theme'
import { api } from './api'
import { ConfirmDialog, PromptDialog } from './components/Modal'
import { TitleBar } from './components/TitleBar'
import { AppContext, type AppServices, type ConfirmOptions, type PromptOptions } from './context'
import { HelpDialog } from './dialogs/HelpDialog'
import { translator } from './i18n'
import { LibraryPage } from './pages/LibraryPage'
import { WelcomePage } from './pages/WelcomePage'
import { applyTheme } from './theme'
import { ViewerApp } from './viewer/ViewerApp'

interface Pending<O, R> {
  options: O
  resolve: (result: R) => void
}

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [screen, setScreen] = useState<Screen>({ name: 'loading' })
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null)
  const [help, setHelp] = useState(false)
  const [pendingConfirm, setPendingConfirm] = useState<Pending<ConfirmOptions, boolean> | null>(null)
  const [pendingPrompt, setPendingPrompt] = useState<Pending<PromptOptions, string | null> | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)

  const t = useMemo(() => translator(settings?.language ?? 'cs'), [settings?.language])
  const tRef = useRef(t)
  tRef.current = t

  const notify = useCallback((text: string, error = false) => {
    setToast({ text, error })
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), error ? 7000 : 4000)
  }, [])

  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => setPendingConfirm({ options, resolve })), [])
  const prompt = useCallback((options: PromptOptions) => new Promise<string | null>((resolve) => setPendingPrompt({ options, resolve })), [])

  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    setSettings(await api.updateSettings(patch))
  }, [])

  useEffect(() => {
    void api.getSettings().then(setSettings)
    void api.getScreen().then(setScreen)
    const offs = [api.onSettings(setSettings), api.onScreen(setScreen), api.onMessage((m) => notify(tRef.current(m.key, m.params), Boolean(m.error)))]
    return () => offs.forEach((off) => off())
  }, [notify])

  useEffect(() => {
    if (settings) applyTheme(settings)
  }, [settings])

  // A question that belongs to a screen that is gone (e.g. after sign-out) is answered "no".
  useEffect(() => {
    setPendingConfirm((current) => {
      current?.resolve(false)
      return null
    })
    setPendingPrompt((current) => {
      current?.resolve(null)
      return null
    })
  }, [screen.name])

  if (!settings) return null
  const native = resolveFlags(settings).native_titlebar
  const services: AppServices = { t, settings, updateSettings, notify, confirm, prompt, openHelp: () => setHelp(true) }

  return (
    <AppContext.Provider value={services}>
      <div className={`window ${native ? 'native' : 'frameless'} ${api.isViewer ? 'viewer-window' : ''}`}>
        {api.isViewer ? (
          <ViewerApp native={native} />
        ) : (
          <>
            {!native && <TitleBar />}
            <main className="pages">
              {screen.name === 'welcome' && <WelcomePage screen={screen} />}
              {screen.name === 'library' && <LibraryPage key={screen.session} screen={screen} />}
            </main>
          </>
        )}
        {!api.isViewer && (
          <footer className="footer">
            <span className={`toast ${toast?.error ? 'error-text' : 'muted'}`} role="status">
              {toast?.text}
            </span>
            <button type="button" className="help-button" title={t('help.tooltip')} aria-label={t('help.tooltip')} onClick={() => setHelp(true)}>
              ?
            </button>
          </footer>
        )}
        {api.isViewer && toast && (
          <div className={`viewer-toast ${toast.error ? 'error-text' : ''}`} role="status">
            {toast.text}
          </div>
        )}
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
        {pendingPrompt && (
          <PromptDialog
            options={pendingPrompt.options}
            onDone={(value) => {
              pendingPrompt.resolve(value)
              setPendingPrompt(null)
            }}
          />
        )}
      </div>
    </AppContext.Provider>
  )
}
