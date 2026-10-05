import { useState } from 'react'
import type { Transfer } from '../../../shared/ipc'
import { api } from '../api'
import { Icon, IconButton } from '../components/Icon'
import { useApp } from '../context'
import { formatSize } from '../i18n'

const KIND_ICON = { upload: 'upload', download: 'download', zip: 'zip' } as const

/** Uploads, downloads and ZIP exports with progress (bottom of the library window). */
export function TransfersPanel({ transfers }: { transfers: Transfer[] }) {
  const { t, settings } = useApp()
  const [open, setOpen] = useState(true)
  if (!transfers.length) return null
  const running = transfers.filter((x) => x.state === 'active' || x.state === 'queued')
  const total = running.reduce((sum, x) => sum + x.total, 0)
  const done = running.reduce((sum, x) => sum + x.done, 0)
  const size = (bytes: number): string => formatSize(bytes, settings.language)
  return (
    <section className="transfers" aria-label={t('transfers.title')}>
      <div className="transfers-head">
        <IconButton icon={open ? 'down' : 'forward'} label={t(open ? 'transfers.hide' : 'transfers.show')} size={16} onClick={() => setOpen(!open)} />
        <span className="grow">
          {running.length
            ? t('transfers.running', { count: running.length, done: size(done), total: size(total) })
            : t('transfers.finished', { count: transfers.length })}
        </span>
        {running.length > 0 && (
          <div className="progress small">
            <div className="progress-fill" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
          </div>
        )}
        {running.length < transfers.length && (
          <button type="button" className="link" onClick={() => void api.clearTransfers()}>
            {t('transfers.clear')}
          </button>
        )}
      </div>
      {open && (
        <ul className="transfer-list">
          {transfers.map((x) => (
            <li key={x.id} className={`transfer state-${x.state}`}>
              <Icon name={KIND_ICON[x.kind]} size={15} />
              <span className="transfer-name ellipsis" title={x.name}>
                {x.name}
              </span>
              <div className="progress">
                <div className="progress-fill" style={{ width: `${x.total ? Math.min(100, (x.done / x.total) * 100) : x.state === 'done' ? 100 : 0}%` }} />
              </div>
              <span className="transfer-state muted" title={x.error}>
                {x.state === 'active' ? `${size(x.done)} / ${size(x.total)}` : t(`transfers.${x.state}`)}
              </span>
              {(x.state === 'active' || x.state === 'queued') && (
                <IconButton icon="close" size={14} label={t('transfers.cancel')} onClick={() => void api.cancelTransfer(x.id)} />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
