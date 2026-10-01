import type { Screen } from '../../../shared/ipc'
import { api, isMobile } from '../api'
import { Icon, Logo } from '../components/Icon'
import { useApp } from '../context'

type LoginScreen = Extract<Screen, { name: 'login' }>

export function LoginPage({ screen }: { screen: LoginScreen }) {
  const { t } = useApp()
  const message = screen.message
  return (
    <div className={`page center-page ${isMobile ? 'phone-login' : ''}`}>
      <div className="card login-card">
        <Logo />
        <p className="muted center">{t('login.subtitle')}</p>
        {isMobile && !screen.busy && !screen.connectError && <p className="muted center">{t('login.android_hint')}</p>}
        {screen.needSecret && !screen.busy && (
          <div className="stack">
            <p>{t('login.need_secret')}</p>
            <button type="button" onClick={() => api.chooseClientSecret()}>
              <Icon name="file" size={16} /> {t('login.choose_secret')}
            </button>
            <p className="muted">{t('login.help_hint')}</p>
          </div>
        )}
        {screen.connectError ? (
          <button type="button" onClick={() => api.retry()}>
            {t('login.retry')}
          </button>
        ) : (
          <button
            type="button"
            className="primary big"
            disabled={screen.needSecret || screen.busy}
            onClick={() => api.login(t('login.browser_success'))}
          >
            <Icon name="google" size={18} /> {t('login.button')}
          </button>
        )}
        {message && <p className={`center ${message.error ? 'error-text' : 'muted'}`}>{t(message.key, message.params)}</p>}
        {!isMobile && !screen.needSecret && !screen.busy && !screen.connectError && (
          <button type="button" className="link" onClick={() => api.chooseClientSecret()}>
            {t('login.change_secret')}
          </button>
        )}
      </div>
    </div>
  )
}
