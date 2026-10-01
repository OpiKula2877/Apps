import { useState } from 'react'
import { resolveColors } from '../../../shared/theme'
import { api } from '../api'
import { Modal } from '../components/Modal'
import { useApp } from '../context'
import { OS_NAMES, OS_ORDER, buildHelp, type OsKey } from './helpContent'

export function HelpDialog({ onClose }: { onClose: () => void }) {
  const { t, settings } = useApp()
  const [os, setOs] = useState<OsKey>(api.platform)
  return (
    <Modal
      title={t('help.title')}
      onClose={onClose}
      width={760}
      height={680}
      className="help-dialog"
      footer={
        <button type="button" className="primary" onClick={onClose}>
          {t('common.close')}
        </button>
      }
    >
      <div className="tabs" role="tablist">
        {OS_ORDER.map((key) => (
          <button key={key} type="button" role="tab" aria-selected={os === key} className={`tab ${os === key ? 'checked' : ''}`} onClick={() => setOs(key)}>
            {OS_NAMES[key]}
          </button>
        ))}
      </div>
      <div className="help tab-panel" dangerouslySetInnerHTML={{ __html: buildHelp(settings.language, os, resolveColors(settings)) }} />
    </Modal>
  )
}
