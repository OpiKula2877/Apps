import { useState } from 'react'
import { validatePassword } from '../../../shared/keys'
import { parseQr } from '../../../shared/qr'
import { api } from '../api'
import { Icon } from '../components/Icon'
import { Modal } from '../components/Modal'
import { SecretInput } from '../components/SecretInput'
import { useApp } from '../context'
import { Okfetch } from '../mobile/native'

interface Props {
  onClose: () => void
  /** Filled in from an okfetch: QR code or link. */
  initialId?: string
  initialName?: string
  /** The phone can read the identifier from a QR code with the camera. */
  canScan?: boolean
}

export function AddContactDialog({ onClose, initialId = '', initialName = '', canScan = false }: Props) {
  const { t, notify } = useApp()
  const [identifier, setIdentifier] = useState(initialId)
  const [password, setPassword] = useState('')
  const [name, setName] = useState(initialName)
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

  const scan = async (): Promise<void> => {
    const { text } = await Okfetch.scanQr().catch(() => ({ text: undefined }))
    if (!text) return
    const qr = parseQr(text)
    if (!qr) return setError(t('qr.invalid'))
    setError(null)
    setIdentifier(qr.id)
    if (qr.name && !name.trim()) setName(qr.name)
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
      {canScan && (
        <button type="button" className="scan-button" onClick={() => void scan()}>
          <Icon name="qr" size={18} /> {t('qr.scan')}
        </button>
      )}
      <label className="field-label">{t('add.identifier')}</label>
      <input className="mono" value={identifier} placeholder="xxxx xxxx xxxx …" spellCheck={false} onChange={(e) => setIdentifier(e.target.value)} data-autofocus={canScan ? undefined : true} />
      <label className="field-label">{t('add.password')}</label>
      <SecretInput value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void submit()} />
      <label className="field-label">{t('add.name')}</label>
      <input value={name} maxLength={64} placeholder={t('add.name_placeholder')} onChange={(e) => setName(e.target.value)} />
      {error && <div className="banner">{error}</div>}
    </Modal>
  )
}
