import { useState } from 'react'
import { fileUrl } from '../../../shared/model'
import { Modal } from '../components/Modal'
import { useApp } from '../context'

/** Received image or GIF shown directly in the chat (GIFs animate); a click opens the large view. */
export function MediaPreview({ rel, name }: { rel: string; name: string }) {
  const { t } = useApp()
  const [big, setBig] = useState(false)
  const url = fileUrl(rel)
  return (
    <>
      <button type="button" className="media-thumb" onClick={() => setBig(true)} title={t('chat.media_open')}>
        <img src={url} alt={name} draggable={false} />
      </button>
      {big && (
        <Modal
          title={name}
          onClose={() => setBig(false)}
          width={Math.min(window.innerWidth - 80, 1100)}
          className="media-dialog"
          footer={
            <button type="button" className="primary" onClick={() => setBig(false)}>
              {t('common.close')}
            </button>
          }
        >
          <div className="media-big">
            <img src={url} alt={name} draggable={false} />
          </div>
        </Modal>
      )}
    </>
  )
}
