// First screen: choose where the library lives (Google Drive or this computer), then sign in
// or pick the folder.
import type { Screen } from '../../../shared/ipc'
import { api } from '../api'
import { Icon, Logo } from '../components/Icon'
import { useApp } from '../context'

type WelcomeScreen = Extract<Screen, { name: 'welcome' }>

export function WelcomePage({ screen }: { screen: WelcomeScreen }) {
  const { t } = useApp()
  const message = screen.message && <p className={`center ${screen.message.error ? 'error-text' : 'muted'}`}>{t(screen.message.key, screen.message.params)}</p>
  const back = !screen.busy && (
    <button type="button" className="link" onClick={() => void api.chooseMode(null)}>
      ← {t('welcome.back')}
    </button>
  )

  if (screen.mode === null) {
    return (
      <div className="page center-page">
        <div className="card welcome-card">
          <Logo />
          <p className="muted center">{t('welcome.subtitle')}</p>
          <h2 className="subheading center">{t('welcome.choose')}</h2>
          <div className="mode-choices">
            <button type="button" className="mode-choice" onClick={() => void api.chooseMode('drive')}>
              <Icon name="cloud" size={30} />
              <span className="mode-title">{t('welcome.drive')}</span>
              <span className="muted">{t('welcome.drive_info')}</span>
            </button>
            <button type="button" className="mode-choice" onClick={() => void api.chooseMode('local')}>
              <Icon name="monitor" size={30} />
              <span className="mode-title">{t('welcome.local')}</span>
              <span className="muted">{t('welcome.local_info')}</span>
            </button>
          </div>
          <p className="muted center small">{t('welcome.change_later')}</p>
          {message}
        </div>
      </div>
    )
  }

  if (screen.mode === 'local') {
    return (
      <div className="page center-page">
        <div className="card login-card">
          <Logo />
          <h2 className="subheading center">{t('welcome.local')}</h2>
          <p className="muted">{t('local.info')}</p>
          {!screen.busy && (
            <>
              <p className="mono-path" title={screen.defaultFolder}>
                {screen.defaultFolder}
              </p>
              {screen.connectError ? (
                <button type="button" onClick={() => void api.retry()}>
                  {t('login.retry')}
                </button>
              ) : (
                <button type="button" className="primary big" onClick={() => void api.openLocal(null)}>
                  <Icon name="folder" size={18} /> {t('local.use_default')}
                </button>
              )}
              <button type="button" onClick={() => void api.openLocal(true)}>
                <Icon name="folder" size={16} /> {t('local.choose')}
              </button>
            </>
          )}
          {message}
          {back}
        </div>
      </div>
    )
  }

  return (
    <div className="page center-page">
      <div className="card login-card">
        <Logo />
        <h2 className="subheading center">{t('welcome.drive')}</h2>
        <p className="muted center">{t('login.subtitle')}</p>
        {screen.needSecret && !screen.busy && (
          <div className="stack">
            <p>{t('login.need_secret')}</p>
            <button type="button" onClick={() => void api.chooseClientSecret()}>
              <Icon name="file" size={16} /> {t('login.choose_secret')}
            </button>
            <p className="muted">{t('login.help_hint')}</p>
          </div>
        )}
        {screen.connectError ? (
          <button type="button" onClick={() => void api.retry()}>
            {t('login.retry')}
          </button>
        ) : (
          <button type="button" className="primary big" disabled={screen.needSecret || screen.busy} onClick={() => void api.login(t('login.browser_success'))}>
            <Icon name="google" size={18} /> {t('login.button')}
          </button>
        )}
        {message}
        {!screen.needSecret && !screen.busy && !screen.connectError && (
          <button type="button" className="link" onClick={() => void api.chooseClientSecret()}>
            {t('login.change_secret')}
          </button>
        )}
        {back}
      </div>
    </div>
  )
}
