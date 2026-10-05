// Several sources are ticked: ask which one new files go to.
import { useState } from 'react'
import type { SourceState } from '../../../shared/ipc'
import { FRAME_HEX } from '../../../shared/model'
import { Icon } from '../components/Icon'
import { Modal } from '../components/Modal'
import { useApp } from '../context'

export function UploadTargetDialog({ sources, count, onDone }: { sources: SourceState[]; count: number | null; onDone: (id: string | null) => void }) {
  const { t } = useApp()
  const [chosen, setChosen] = useState(sources[0]?.id ?? '')
  return (
    <Modal
      title={t('upload.target_title')}
      onClose={() => onDone(null)}
      width={480}
      footer={
        <>
          <button type="button" onClick={() => onDone(null)}>
            {t('common.cancel')}
          </button>
          <button type="button" className="primary" disabled={!chosen} onClick={() => onDone(chosen)}>
            <Icon name="upload" size={16} /> {t('upload.target_button')}
          </button>
        </>
      }
    >
      <p className="muted">{count ? t('upload.target_info_count', { count }) : t('upload.target_info')}</p>
      <ul className="list picker-list" role="radiogroup">
        {sources.map((source) => (
          <li
            key={source.id}
            role="radio"
            aria-checked={chosen === source.id}
            className={chosen === source.id ? 'selected' : ''}
            onClick={() => setChosen(source.id)}
            onDoubleClick={() => onDone(source.id)}
          >
            <span style={source.color && chosen !== source.id ? { color: FRAME_HEX[source.color] } : undefined}>
              <Icon name={source.icon} size={18} />
            </span>
            <span className="stack-tight min0">
              <span className="ellipsis">{source.name}</span>
              <span className="muted small ellipsis">{source.kind === 'drive' ? source.account?.email : source.path}</span>
            </span>
          </li>
        ))}
      </ul>
    </Modal>
  )
}
