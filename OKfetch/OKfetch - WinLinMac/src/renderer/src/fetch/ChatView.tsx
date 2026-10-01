import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isGroupChat, parseChatId, type MessageView } from '../../../shared/model'
import { api } from '../api'
import { Icon, IconButton } from '../components/Icon'
import { useApp } from '../context'
import { useData } from '../data'
import { canDeleteForBoth } from '../../../shared/selection'
import { formatDay } from '../util/format'
import { countMatches } from '../util/sanitize'
import { ChatSearch } from './ChatSearch'
import { Composer } from './Composer'
import { MessageBubble } from './MessageBubble'
import { SelectionBar } from './SelectionBar'

interface Props {
  chatId: string
  /** The chat is the visible tab of the visible page. */
  active: boolean
}

const NEAR_BOTTOM_PX = 140

export function ChatView({ chatId, active }: Props) {
  const { t, settings, confirm, notify } = useApp()
  const data = useData()
  const [messages, setMessages] = useState<MessageView[]>([])
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const [match, setMatch] = useState(0)
  const [progress, setProgress] = useState<Record<string, number>>({})
  const list = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  const parsed = parseChatId(chatId)
  const group = parsed?.type === 'group' ? data.groups.find((g) => g.id === parsed.id) : undefined
  const contact = parsed?.type === 'contact' ? data.contacts.find((c) => c.pub === parsed.pub) : undefined
  const typingNow = data.typingChats.has(chatId)
  const someoneOffline = group ? group.members.some((m) => !m.me && !m.online) : contact ? !contact.online : false
  const typingName = contact ? contact.name : t('chat.someone')

  const load = useCallback(() => void api.getMessages(chatId).then(setMessages), [chatId])
  useEffect(() => {
    load()
    return data.onChat(chatId, load)
  }, [chatId, load, data])

  useEffect(
    () =>
      data.onTransfer((p) => {
        if (p.chatId === chatId) setProgress((current) => ({ ...current, [p.messageId]: p.done }))
      }),
    [chatId, data]
  )

  // Reading: an open, visible, focused chat marks its incoming messages as read.
  const unread = messages.some((m) => m.unread)
  useEffect(() => {
    if (!active || !unread) return
    const mark = (): void => {
      if (document.hasFocus() && document.visibilityState === 'visible') void api.markRead(chatId)
    }
    mark()
    window.addEventListener('focus', mark)
    return () => window.removeEventListener('focus', mark)
  }, [active, unread, chatId])

  // Keep the newest message in view unless the reader scrolled up.
  useEffect(() => {
    const element = list.current
    if (element && stick.current) element.scrollTop = element.scrollHeight
  }, [messages, typingNow, active])

  const onScroll = (): void => {
    const element = list.current
    if (element) stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < NEAR_BOTTOM_PX
  }

  // Search: every occurrence in order; `match` is the active one.
  const counts = useMemo(() => (query ? messages.map((m) => (m.file || m.broken ? 0 : countMatches(m.html, query))) : []), [messages, query])
  const total = counts.reduce((sum, n) => sum + n, 0)
  const activeLocation = useMemo(() => {
    let left = total ? ((match % total) + total) % total : 0
    for (let i = 0; i < counts.length; i++) {
      if (left < counts[i]) return { id: messages[i].id, occurrence: left }
      left -= counts[i]
    }
    return null
  }, [counts, match, messages, total])

  useEffect(() => {
    if (!active) return
    const onKey = (event: KeyboardEvent): void => {
      const mod = api.platform === 'macos' ? event.metaKey : event.ctrlKey
      if (mod && event.key.toLowerCase() === 'f' && !document.querySelector('.modal')) {
        event.preventDefault()
        setSearching(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])

  const closeSearch = (): void => {
    setSearching(false)
    setQuery('')
    setMatch(0)
  }

  const toggle = (id: string): void =>
    setSelected((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  const stopSelecting = (): void => {
    setSelecting(false)
    setSelected(new Set())
  }

  const chosen = messages.filter((m) => selected.has(m.id))
  const remove = async (scope: 'me' | 'both'): Promise<void> => {
    const ok = await confirm({
      title: t(scope === 'me' ? 'chat.delete_me' : 'chat.delete_both'),
      text: t(scope === 'me' ? 'chat.delete_me_text' : 'chat.delete_both_text', { n: chosen.length }),
      confirmText: t('common.delete'),
      danger: true
    })
    if (!ok) return
    const result = await api.deleteMessages(chatId, [...selected], scope)
    if (result.skipped) notify(t('chat.delete_skipped', { n: result.skipped }), true)
    stopSelecting()
  }

  const firstPending = messages.findIndex((m) => m.mine && m.status === 'pending')
  const showSender = isGroupChat(chatId)

  return (
    <div className="chat">
      <div className="chat-toolbar">
        <div className="grow" />
        <IconButton icon="search" label={`${t('chat.search')} (${api.platform === 'macos' ? '⌘' : 'Ctrl+'}F)`} size={16} onClick={() => setSearching(true)} />
        <IconButton icon="list_check" label={t('chat.select')} size={16} className={selecting ? 'toggled' : ''} onClick={() => (selecting ? stopSelecting() : setSelecting(true))} />
      </div>
      {searching && (
        <ChatSearch query={query} onQuery={(q) => { setQuery(q); setMatch(0) }} index={total ? ((match % total) + total) % total : 0} total={total} onStep={(d) => setMatch((m) => m + d)} onClose={closeSearch} />
      )}
      <div className="chat-messages" ref={list} onScroll={onScroll}>
        {messages.length === 0 && <div className="empty muted">{t('chat.empty')}</div>}
        {messages.map((message, index) => {
          const previous = messages[index - 1]
          const newDay = !previous || new Date(previous.ts).toDateString() !== new Date(message.ts).toDateString()
          return (
            <Fragment key={message.id}>
              {newDay && <div className="day-separator muted">{formatDay(message.ts, settings.language)}</div>}
              {index === firstPending && (
                <div className="pending-banner">
                  <Icon name="clock" size={14} /> {t('chat.undelivered')}
                </div>
              )}
              <MessageBubble
                message={message}
                showSender={showSender}
                selectionMode={selecting}
                selected={selected.has(message.id)}
                onToggle={() => toggle(message.id)}
                query={query}
                activeMatch={activeLocation?.id === message.id ? activeLocation.occurrence : null}
                transferDone={progress[message.id]}
              />
            </Fragment>
          )
        })}
      </div>
      <div className="typing-line muted">{typingNow ? t('chat.typing', { name: typingName }) : ''}</div>
      {selecting ? (
        <SelectionBar count={selected.size} canDeleteBoth={canDeleteForBoth(chosen)} onDeleteMe={() => void remove('me')} onDeleteBoth={() => void remove('both')} onCancel={stopSelecting} />
      ) : (
        <Composer chatId={chatId} someoneOffline={someoneOffline} canAttach={!isGroupChat(chatId)} />
      )}
    </div>
  )
}
