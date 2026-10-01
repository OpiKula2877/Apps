// A file in the chat: offer with accept / refuse, progress, the finished file (image preview) and refusals.
import { useState } from 'react'
import type { MessageView } from '../../../shared/model'
import { api } from '../api'
import { Icon } from '../components/Icon'
import { useApp } from '../context'
import { RejectFeedbackDialog } from '../dialogs/RejectFeedbackDialog'
import { formatSize, isImage } from '../util/format'
import { MediaPreview } from './MediaPreview'

interface Props {
  message: MessageView
  /** Bytes transferred according to the latest progress event (overrides the stored value). */
  done?: number
}

export function FileOfferCard({ message, done }: Props) {
  const { t } = useApp()
  const [explain, setExplain] = useState(false)
  const file = message.file
  if (!file) return null
  const chatId = message.chatId
  const incoming = file.direction === 'in'
  const transferred = Math.min(done ?? file.done, file.size)
  const percent = file.size > 0 ? Math.round((transferred / file.size) * 100) : 100
  const preview = file.state === 'done' && file.rel && incoming && isImage(file.mime, file.name)

  let body
  switch (file.state) {
    case 'offered':
      body = incoming ? (
        <div className="file-actions">
          <button type="button" className="primary" onClick={() => void api.acceptFile(chatId, message.id)}>
            <Icon name="download" size={16} /> {t('file.accept')}
          </button>
          <button type="button" onClick={() => void api.rejectFile(chatId, message.id)}>
            {t('file.reject')}
          </button>
          <button type="button" className="link" onClick={() => setExplain(true)}>
            {t('file.reject_explain')}
          </button>
        </div>
      ) : (
        <div className="file-actions">
          <span className="muted">{t('file.waiting')}</span>
          <button type="button" className="link" onClick={() => void api.cancelFile(chatId, message.id)}>
            {t('file.withdraw')}
          </button>
        </div>
      )
      break
    case 'accepted':
    case 'transferring':
      body = (
        <div className="file-progress">
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${percent}%` }} />
          </div>
          <div className="row">
            <span className="muted grow">
              {formatSize(transferred)} / {formatSize(file.size)} ({percent} %)
            </span>
            <button type="button" className="link" onClick={() => void api.cancelFile(chatId, message.id)}>
              {t('file.cancel')}
            </button>
          </div>
        </div>
      )
      break
    case 'done':
      body = incoming ? (
        <div className="file-actions">
          <button type="button" onClick={() => void api.openFile(chatId, message.id)}>
            {t('file.open')}
          </button>
          <button type="button" onClick={() => void api.showFile(chatId, message.id)}>
            <Icon name="folder" size={16} /> {t('file.show')}
          </button>
        </div>
      ) : (
        <span className="muted">{t('file.sent')}</span>
      )
      break
    case 'rejected':
      body = (
        <div className="file-note error-text">
          {t(incoming ? 'file.rejected_by_me' : 'file.rejected_by_them')}
          {file.feedback && <div className="file-feedback">„{file.feedback}“</div>}
        </div>
      )
      break
    case 'canceled':
      body = <span className="muted">{t('file.canceled')}</span>
      break
    default:
      body = <span className="error-text">{t('file.failed')}</span>
  }

  return (
    <div className="file-card">
      {preview ? (
        <MediaPreview rel={file.rel!} name={file.name} />
      ) : (
        <div className="file-head">
          <Icon name={isImage(file.mime, file.name) ? 'image' : 'file'} size={26} />
          <div className="file-meta">
            <div className="file-name" title={file.name}>
              {message.broken ? t('chat.undecryptable') : file.name}
            </div>
            <div className="muted">{formatSize(file.size)}</div>
          </div>
        </div>
      )}
      {preview && (
        <div className="file-caption muted">
          {file.name} · {formatSize(file.size)}
        </div>
      )}
      {body}
      {explain && (
        <RejectFeedbackDialog
          title={t('file.reject_explain')}
          info={t('file.reject_info')}
          confirmText={t('file.reject')}
          onClose={() => setExplain(false)}
          onConfirm={(feedback) => {
            setExplain(false)
            void api.rejectFile(chatId, message.id, feedback)
          }}
        />
      )}
    </div>
  )
}
