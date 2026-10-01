import { useEffect, useRef } from 'react'
import { Icon, IconButton } from '../components/Icon'
import { useApp } from '../context'

interface Props {
  query: string
  onQuery: (query: string) => void
  /** 0-based index of the active match and the total. */
  index: number
  total: number
  onStep: (delta: 1 | -1) => void
  onClose: () => void
}

/** Ctrl+F in a chat: highlights every occurrence and jumps between them. */
export function ChatSearch({ query, onQuery, index, total, onStep, onClose }: Props) {
  const { t } = useApp()
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])
  return (
    <div className="chat-search">
      <span className="search">
        <Icon name="search" size={16} />
        <input
          ref={input}
          value={query}
          placeholder={t('chat.search')}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onStep(e.shiftKey ? -1 : 1)
            else if (e.key === 'Escape') onClose()
          }}
        />
      </span>
      <span className="muted search-count">{query ? (total ? `${index + 1} / ${total}` : t('chat.search_none')) : ''}</span>
      <IconButton icon="chevron_left" label={t('chat.search_prev')} size={16} disabled={!total} onClick={() => onStep(-1)} />
      <IconButton icon="chevron_right" label={t('chat.search_next')} size={16} disabled={!total} onClick={() => onStep(1)} />
      <IconButton icon="close" label={t('common.close')} size={16} onClick={onClose} />
    </div>
  )
}
