import { useState } from 'react'
import { Modal } from '../components/Modal'
import { useApp } from '../context'

interface Props {
  title: string
  label: string
  initial: string
  confirmText?: string
  maxLength?: number
  onConfirm: (value: string) => void
  onClose: () => void
}

/** One text field with Save / Cancel. */
export function PromptDialog({ title, label, initial, confirmText, maxLength = 64, onConfirm, onClose }: Props) {
  const { t } = useApp()
  const [value, setValue] = useState(initial)
  return (
    <Modal
      title={title}
      onClose={onClose}
      width={420}
      footer={
        <>
          <button type="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="primary" disabled={!value.trim()} onClick={() => onConfirm(value.trim())}>
            {confirmText ?? t('common.save')}
          </button>
        </>
      }
    >
      <label className="field-label">{label}</label>
      <input value={value} maxLength={maxLength} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && value.trim() && onConfirm(value.trim())} data-autofocus />
    </Modal>
  )
}
