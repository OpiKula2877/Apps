import { useCallback, useRef, useState } from 'react'
import { OFFLINE_CHAR_LIMIT, isEmptyMessage, textLength } from '../../../shared/text'
import { api } from '../api'
import { Icon } from '../components/Icon'
import { useApp } from '../context'
import { RichEditor, type RichEditorHandle } from '../editor/RichEditor'

interface Props {
  chatId: string
  /** At least one recipient is offline: messages wait, so the 5000 character limit applies. */
  someoneOffline: boolean
  canAttach: boolean
}

export function Composer({ chatId, someoneOffline, canAttach }: Props) {
  const { t, notify } = useApp()
  const editor = useRef<RichEditorHandle>(null)
  const [html, setHtml] = useState('')
  const lastTyping = useRef(0)
  const length = textLength(html)
  const tooLong = someoneOffline && length > OFFLINE_CHAR_LIMIT
  const empty = isEmptyMessage(html)

  const send = useCallback(async () => {
    const current = editor.current?.html() ?? ''
    if (isEmptyMessage(current)) return
    const result = await api.sendMessage(chatId, current)
    if (result.ok) {
      editor.current?.clear()
      editor.current?.focus()
    } else {
      notify(t(`chat.send_error.${result.reason}`), true)
    }
  }, [chatId, notify, t])

  const changed = (value: string): void => {
    setHtml(value)
    const now = Date.now()
    if (!isEmptyMessage(value) && now - lastTyping.current > 1500) {
      lastTyping.current = now
      api.sendTyping(chatId)
    }
  }

  const attach = async (): Promise<void> => {
    const result = await api.sendFile(chatId)
    if (!result.ok && result.reason !== 'cancelled') notify(t(`chat.send_error.${result.reason}`), true)
  }

  return (
    <div className="composer">
      <RichEditor ref={editor} onChange={changed} onEnter={() => void send()} placeholder={t('chat.placeholder')} />
      <div className="composer-bar">
        {someoneOffline && (
          <span className={`counter-offline ${tooLong ? 'error-text' : 'muted'}`} title={t('chat.offline_limit')}>
            {length} / {OFFLINE_CHAR_LIMIT}
          </span>
        )}
        <div className="grow" />
        {canAttach && (
          <button type="button" className="icon-button" title={t('chat.attach')} aria-label={t('chat.attach')} onClick={() => void attach()}>
            <Icon name="paperclip" size={18} />
          </button>
        )}
        <button type="button" className="primary" disabled={empty || tooLong} onClick={() => void send()}>
          <Icon name="send" size={16} /> {t('chat.send')}
        </button>
      </div>
    </div>
  )
}
