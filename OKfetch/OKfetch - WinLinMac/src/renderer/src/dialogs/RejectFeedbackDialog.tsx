import { useState } from 'react'
import { Modal } from '../components/Modal'
import { useApp } from '../context'

interface Props {
  title: string
  info: string
  confirmText: string
  /** Empty text is allowed (plain refusal). */
  onConfirm: (feedback: string) => void
  onClose: () => void
}

/** Asks for an optional explanation that the other side will see (file or contact request refused). */
export function RejectFeedbackDialog({ title, info, confirmText, onConfirm, onClose }: Props) {
  const { t } = useApp()
  const [text, setText] = useState('')
  return (
    <Modal
      title={title}
      onClose={onClose}
      width={480}
      footer={
        <>
          <button type="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="danger" onClick={() => onConfirm(text.trim())}>
            {confirmText}
          </button>
        </>
      }
    >
      <p className="muted">{info}</p>
      <textarea
        className="feedback-text"
        rows={4}
        maxLength={300}
        value={text}
        placeholder={t('reject.placeholder')}
        onChange={(e) => setText(e.target.value)}
        data-autofocus
      />
      <div className="counter muted">{text.length} / 300</div>
    </Modal>
  )
}
