import { useEffect, useState } from 'react'
import type { ContactView } from '../../../shared/model'
import { api } from '../api'
import { Modal } from '../components/Modal'
import { useApp } from '../context'

/** Both sides see the same 30 digits. If they match when read aloud, nobody sits between them. */
export function VerifyContactDialog({ contact, onClose }: { contact: ContactView; onClose: () => void }) {
  const { t } = useApp()
  const [code, setCode] = useState('')
  const [verified, setVerified] = useState(contact.verified)
  useEffect(() => void api.getFingerprint(contact.pub).then(setCode), [contact.pub])

  const toggle = async (): Promise<void> => {
    await api.verifyContact(contact.pub, !verified)
    setVerified(!verified)
  }

  return (
    <Modal
      title={t('verify.title', { name: contact.name })}
      onClose={onClose}
      width={500}
      footer={
        <>
          <button type="button" className={verified ? 'danger-outline' : 'primary'} onClick={() => void toggle()}>
            {t(verified ? 'verify.unmark' : 'verify.mark')}
          </button>
          <button type="button" onClick={onClose}>
            {t('common.close')}
          </button>
        </>
      }
    >
      <p className="muted">{t('verify.info')}</p>
      <div className="fingerprint" aria-label={t('verify.code')}>
        {code.split(' ').map((group, index) => (
          <span key={index}>{group}</span>
        ))}
      </div>
      <p className={verified ? '' : 'muted'}>{t(verified ? 'verify.is_verified' : 'verify.not_verified')}</p>
    </Modal>
  )
}
