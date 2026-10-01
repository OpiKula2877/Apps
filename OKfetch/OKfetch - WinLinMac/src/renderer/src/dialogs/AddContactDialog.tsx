import { useState } from 'react'
import { validatePassword } from '../../../shared/keys'
import { api } from '../api'
import { Modal } from '../components/Modal'
import { SecretInput } from '../components/SecretInput'
import { useApp } from '../context'

export function AddContactDialog({ onClose }: { onClose: () => void }) {
  const { t, notify } = useApp()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    const passwordError = validatePassword(password)
    if (passwordError) return setError(t(`password.error.${passwordError}`, { max: 32 }))
    setBusy(true)
    setError(null)
    const result = await api.addContact(identifier, password, name)
    setBusy(false)
    if (result.ok) {
      notify(t('add.sent'))
      onClose()
    } else {
      setError(t(`add.error.${result.reason}`))
    }
  }

  return (
    <Modal
      title={t('add.title')}
      onClose={onClose}
      width={520}
      footer={
        <>
          <button type="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="primary" disabled={busy || !identifier.trim() || !password.trim()} onClick={() => void submit()}>
            {busy ? t('common.working') : t('add.send')}
          </button>
        </>
      }
    >
      <p className="muted">{t('add.info')}</p>
      <label className="field-label">{t('add.identifier')}</label>
      <input className="mono" value={identifier} placeholder="xxxx xxxx xxxx …" spellCheck={false} onChange={(e) => setIdentifier(e.target.value)} data-autofocus />
      <label className="field-label">{t('add.password')}</label>
      <SecretInput value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void submit()} />
      <label className="field-label">{t('add.name')}</label>
      <input value={name} maxLength={64} placeholder={t('add.name_placeholder')} onChange={(e) => setName(e.target.value)} />
      {error && <div className="banner">{error}</div>}
    </Modal>
  )
}
