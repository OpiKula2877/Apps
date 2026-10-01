import { useEffect, useMemo, useRef, type MouseEvent } from 'react'
import type { MessageView } from '../../../shared/model'
import { api } from '../api'
import { Icon } from '../components/Icon'
import { useApp } from '../context'
import { formatTime } from '../util/format'
import { highlight } from '../util/sanitize'
import { FileOfferCard } from './FileOfferCard'

interface Props {
  message: MessageView
  showSender: boolean
  selectionMode: boolean
  selected: boolean
  onToggle: () => void
  query: string
  /** Index of the highlighted occurrence inside this message, or null. */
  activeMatch: number | null
  transferDone?: number
}

function StatusMark({ message }: { message: MessageView }) {
  const { t } = useApp()
  if (!message.mine || !message.status) return null
  if (message.status === 'pending') return <span title={t('chat.status.pending')}><Icon name="clock" size={14} /></span>
  if (message.status === 'delivered') return <span title={t('chat.status.delivered')}><Icon name="check" size={14} /></span>
  return <span className="read-mark" title={t('chat.status.read')}><Icon name="check_double" size={14} /></span>
}

export function MessageBubble({ message, showSender, selectionMode, selected, onToggle, query, activeMatch, transferDone }: Props) {
  const { t, settings } = useApp()
  const bubble = useRef<HTMLDivElement>(null)
  const html = useMemo(() => (message.file || message.broken ? '' : highlight(message.html, query, activeMatch)), [message.html, message.file, message.broken, query, activeMatch])

  useEffect(() => {
    if (activeMatch !== null) bubble.current?.querySelector('mark.active')?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [activeMatch, query])

  // Links open in the system browser, never inside the app.
  const onClick = (event: MouseEvent): void => {
    const link = (event.target as HTMLElement).closest('a')
    if (link) {
      event.preventDefault()
      void api.openExternal(link.getAttribute('href') ?? '')
    } else if (selectionMode) {
      onToggle()
    }
  }

  return (
    <div className={`message-row ${message.mine ? 'mine' : 'theirs'} ${selectionMode ? 'selecting' : ''} ${selected ? 'selected' : ''}`} onClick={selectionMode ? onToggle : undefined}>
      {selectionMode && <input type="checkbox" className="select-box" checked={selected} onChange={onToggle} onClick={(e) => e.stopPropagation()} />}
      <div className="bubble" ref={bubble} data-message={message.id}>
        {showSender && !message.mine && <div className="bubble-sender">{message.fromName}</div>}
        {message.broken && !message.file ? (
          <div className="muted">{t('chat.undecryptable')}</div>
        ) : message.file ? (
          <FileOfferCard message={message} done={transferDone} />
        ) : (
          <div className="bubble-text editor-html" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
        )}
        <div className="bubble-meta muted">
          <span>{formatTime(message.ts, settings.language)}</span>
          <StatusMark message={message} />
        </div>
      </div>
    </div>
  )
}
