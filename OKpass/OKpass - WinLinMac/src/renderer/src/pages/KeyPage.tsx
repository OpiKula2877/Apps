import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Screen } from '../../../shared/ipc'
import { MAX_KEY_LENGTH, keyLength, normalizeKey, validateKey } from '../../../shared/keys'
import { api } from '../api'
import { Icon, Logo } from '../components/Icon'
import { SecretInput } from '../components/SecretInput'
import { useApp } from '../context'
import type { Translate } from '../i18n'

type KeyScreen = Extract<Screen, { name: 'key' }>

export function keyErrorText(t: Translate, raw: string): string | null {
  const code = validateKey(raw)
  return code ? t(`key.error.${code}`, { max: MAX_KEY_LENGTH }) : null
}

/** Sign out, asking again when some changes were not uploaded yet. */
export async function signOut(confirm: ReturnType<typeof useApp>['confirm'], t: Translate, pending?: Parameters<typeof api.logout>[0]) {
  if ((await api.logout(pending)) === 'pending') {
    const ok = await confirm({ title: t('settings.logout'), text: t('logout.pending_confirm'), confirmText: t('settings.logout'), danger: true })
    if (ok) await api.logout(undefined, true)
  }
}

export function KeyPage({ screen }: { screen: KeyScreen }) {
  const { t, confirm } = useApp()
  const [key, setKey] = useState('')
  const [again, setAgain] = useState('')
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const asked = useRef(false)
  useEffect(() => {
    if (!screen.biometric) input.current?.focus()
  }, [screen.busy, screen.biometric])

  // Fingerprint: ask once as soon as the screen appears.
  useEffect(() => {
    if (screen.biometric && !screen.busy && !asked.current) {
      asked.current = true
      void api.unlockBiometric()
    }
  }, [screen.biometric, screen.busy])

  const count = keyLength(key)
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    const problem = keyErrorText(t, key)
    if (problem) return setError(problem)
    if (screen.create && normalizeKey(key) !== normalizeKey(again)) return setError(t('key.error.mismatch'))
    void api.submitKey(key)
  }

  return (
    <div className="page center-page">
      <form className="card key-card" onSubmit={submit}>
        <Logo />
        <p className="muted center">{t('key.signed_in_as', { email: screen.email })}</p>
        {screen.offline && <div className="banner">{t('key.offline')}</div>}
        {screen.create && (
          <>
            <h2 className="subheading">{t('key.create_title')}</h2>
            <p className="muted">{t('key.create_info', { max: MAX_KEY_LENGTH })}</p>
          </>
        )}
        <label className="field-label" htmlFor="key">
          {t('key.label')}
        </label>
        <SecretInput
          id="key"
          ref={input}
          value={key}
          disabled={screen.busy}
          placeholder={t('key.placeholder', { max: MAX_KEY_LENGTH })}
          onChange={(e) => {
            setKey(e.target.value)
            setError('')
          }}
        />
        <div className={`counter ${count > MAX_KEY_LENGTH ? 'error-text' : 'muted'}`}>
          {count} / {MAX_KEY_LENGTH}
        </div>
        {screen.create && (
          <>
            <label className="field-label" htmlFor="key-again">
              {t('key.confirm_label')}
            </label>
            <SecretInput
              id="key-again"
              value={again}
              disabled={screen.busy}
              onChange={(e) => {
                setAgain(e.target.value)
                setError('')
              }}
            />
          </>
        )}
        {error && <p className="error-text">{error}</p>}
        {screen.biometric && (
          <button type="button" className="big" disabled={screen.busy} onClick={() => api.unlockBiometric()}>
            <Icon name="fingerprint" size={20} /> {t('bio.unlock')}
          </button>
        )}
        <button type="submit" className="primary big" disabled={screen.busy}>
          <Icon name={screen.create ? 'key' : 'lock'} size={18} />{' '}
          {screen.busy ? t('key.working') : t(screen.create ? 'key.create_button' : 'key.unlock_button')}
        </button>
        <button type="button" className="link" disabled={screen.busy} onClick={() => signOut(confirm, t)}>
          {t('key.logout')}
        </button>
      </form>
    </div>
  )
}
