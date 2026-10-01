import { useState } from 'react'
import { normalizeKey } from '../../../shared/keys'
import { Modal } from '../components/Modal'
import { SecretInput } from '../components/SecretInput'
import { useApp } from '../context'
import { keyErrorText } from '../pages/KeyPage'

export function DecoyKeyDialog({ onSave, onClose }: { onSave: (key: string) => void; onClose: () => void }) {
  const { t } = useApp()
  const [key, setKey] = useState('')
  const [again, setAgain] = useState('')
  const [error, setError] = useState('')

  const save = (): void => {
    const problem = keyErrorText(t, key) ?? (normalizeKey(key) !== normalizeKey(again) ? t('key.error.mismatch') : null)
    if (problem) return setError(problem)
    onSave(key)
  }

  return (
    <Modal
      title={t('decoy.dialog_title')}
      onClose={onClose}
      width={440}
      footer={
        <>
          <button type="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="primary" onClick={save}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <p className="muted">{t('decoy.dialog_info')}</p>
      <label className="field-label">{t('key.label')}</label>
      <SecretInput value={key} onChange={(e) => (setKey(e.target.value), setError(''))} onKeyDown={(e) => e.key === 'Enter' && save()} />
      <label className="field-label">{t('key.confirm_label')}</label>
      <SecretInput value={again} onChange={(e) => (setAgain(e.target.value), setError(''))} onKeyDown={(e) => e.key === 'Enter' && save()} />
      {error && <p className="error-text">{error}</p>}
    </Modal>
  )
}
