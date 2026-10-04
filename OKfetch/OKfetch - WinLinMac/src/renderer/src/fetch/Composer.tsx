import { useCallback, useEffect, useRef, useState } from 'react'
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
  /** Phone: Enter makes a new line (the Send button sends), formatting hides behind "Aa", the clip offers the camera. */
  phone?: boolean
  draft?: string
  onDraftUsed?: () => void
}

export function Composer({ chatId, someoneOffline, canAttach, phone = false, draft, onDraftUsed }: Props) {
  const { t, notify } = useApp()
  const editor = useRef<RichEditorHandle>(null)
  const [html, setHtml] = useState('')
  const [formatting, setFormatting] = useState(false)
  const [attachMenu, setAttachMenu] = useState(false)
  const lastTyping = useRef(0)
  const length = textLength(html)
  const tooLong = someoneOffline && length > OFFLINE_CHAR_LIMIT
  const empty = isEmptyMessage(html)

  // Text shared from another app waits here until the user sends it.
  useEffect(() => {
    if (draft === undefined) return
    editor.current?.setText(draft)
    onDraftUsed?.()
  }, [draft, onDraftUsed])

  // The back button (Escape) closes the attach menu first.
  useEffect(() => {
    if (!attachMenu) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setAttachMenu(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [attachMenu])

  const send = useCallback(async () => {
    const current = editor.current?.html() ?? ''
    if (isEmptyMessage(current)) return
    const result = await api.sendMessage(chatId, current)
    if (result.ok) {
      editor.current?.clear()
      if (!phone) editor.current?.focus()
    } else {
      notify(t(`chat.send_error.${result.reason}`), true)
    }
  }, [chatId, notify, t, phone])

  const changed = (value: string): void => {
    setHtml(value)
    const now = Date.now()
    if (!isEmptyMessage(value) && now - lastTyping.current > 1500) {
      lastTyping.current = now
      api.sendTyping(chatId)
    }
  }

  const attach = async (source: 'file' | 'camera'): Promise<void> => {
    setAttachMenu(false)
    const result = await api.sendFile(chatId, source)
    if (!result.ok && result.reason !== 'cancelled') notify(t(`chat.send_error.${result.reason}`), true)
  }

  return (
    <div className={`composer ${phone ? 'phone-composer' : ''}`}>
      <RichEditor ref={editor} onChange={changed} onEnter={phone ? undefined : () => void send()} placeholder={t('chat.placeholder')} showToolbar={!phone || formatting} />
      <div className="composer-bar">
        {phone && (
          <button type="button" className={`icon-button format-toggle ${formatting ? 'toggled' : ''}`} title={t('chat.formatting')} aria-label={t('chat.formatting')} aria-pressed={formatting} onClick={() => setFormatting((v) => !v)}>
            Aa
          </button>
        )}
        {someoneOffline && (
          <span className={`counter-offline ${tooLong ? 'error-text' : 'muted'}`} title={t('chat.offline_limit')}>
            {length} / {OFFLINE_CHAR_LIMIT}
          </span>
        )}
        <div className="grow" />
        {canAttach && (
          <span className="attach-wrap">
            <button type="button" className="icon-button" title={t('chat.attach')} aria-label={t('chat.attach')} onClick={() => (phone ? setAttachMenu((v) => !v) : void attach('file'))}>
              <Icon name="paperclip" size={phone ? 22 : 18} />
            </button>
            {attachMenu && (
              <>
                <div className="sheet-backdrop" onClick={() => setAttachMenu(false)} />
                <div className="sheet attach-menu" role="menu">
                  <button type="button" role="menuitem" onClick={() => void attach('file')}>
                    <Icon name="file" size={18} /> {t('chat.attach_file')}
                  </button>
                  <button type="button" role="menuitem" onClick={() => void attach('camera')}>
                    <Icon name="camera" size={18} /> {t('chat.attach_photo')}
                  </button>
                </div>
              </>
            )}
          </span>
        )}
        <button type="button" className="primary send-button" disabled={empty || tooLong} onClick={() => void send()} aria-label={t('chat.send')}>
          <Icon name="send" size={16} /> {phone ? null : t('chat.send')}
        </button>
      </div>
    </div>
  )
}
