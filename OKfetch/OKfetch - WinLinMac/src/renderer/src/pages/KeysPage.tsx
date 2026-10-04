import { useState } from 'react'
import { api } from '../api'
import { Icon } from '../components/Icon'
import { SecretInput } from '../components/SecretInput'
import { useApp } from '../context'

/** Android: the key in Keystore is gone, so the stored identity cannot be opened. Restore a backup or start again. */
export function KeysPage() {
  const { t, confirm, notify } = useApp()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const restore = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const result = await api.restoreBackup(password)
    setBusy(false)
    if (result.ok) notify(t('backup.restored'))
    else if (result.error !== 'cancelled') setError(t(`backup.error.${result.error === 'wrong_password' ? 'wrong_password' : 'damaged'}`))
  }

  const startAgain = async (): Promise<void> => {
    const ok = await confirm({ title: t('keys.reset'), text: t('keys.reset_text'), confirmText: t('keys.reset'), danger: true })
    if (ok) await api.resetData()
  }

  return (
    <div className="page storage-page keys-page">
      <fieldset className="group">
        <legend>
          <Icon name="key" size={16} /> {t('keys.title')}
        </legend>
        <p>{t('keys.info')}</p>
        <label className="field-label">{t('backup.password')}</label>
        <SecretInput value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <div className="banner">{error}</div>}
        <div className="row">
          <button type="button" className="primary" disabled={busy || !password} onClick={() => void restore()}>
            <Icon name="upload" size={16} /> {busy ? t('common.working') : t('backup.restore')}
          </button>
          <button type="button" className="danger-outline" disabled={busy} onClick={() => void startAgain()}>
            {t('keys.reset')}
          </button>
        </div>
      </fieldset>
    </div>
  )
}
