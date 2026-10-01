// Sending, receiving, confirming, reading and deleting messages (contact chats and group chats).
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  isGroupChat, parseChatId, type FileView, type MessageView
} from '../../shared/model'
import { OFFLINE_CHAR_LIMIT, isEmptyMessage, plainText, textLength } from '../../shared/text'
import type { SendResult } from '../../shared/model'
import type { Core } from '../controller'
import { decryptText, encryptText, messageAd } from '../encryption/aead'
import { newId } from '../ids'
import type { Ctrl } from '../network/protocol'
import type { Peer } from '../network/swarm'
import type { StoredMessage } from '../records'
import { randomBytes } from '../sodium'

type Of<T extends Ctrl['t']> = Extract<Ctrl, { t: T }>

const MAX_BODY = 512 * 1024
const ID_PATTERN = /^[0-9a-f]{32}$/
const TYPING_THROTTLE_MS = 3000

export const newMessageId = (): string => randomBytes(16).toString('hex')

export interface FileMeta {
  name: string
  size: number
  mime: string
  hash: string
}

export class MessageService {
  private lastTyping = new Map<string, number>()

  constructor(private core: Core) {}

  // --- chat structure ---------------------------------------------------------

  /** Who receives what I write in this chat; null when the chat does not exist. */
  recipients(chatId: string): string[] | null {
    const parsed = parseChatId(chatId)
    if (!parsed) return null
    if (parsed.type === 'contact') return this.core.isContact(parsed.pub) ? [parsed.pub] : null
    const group = this.core.state.groups.find((g) => g.id === parsed.id)
    return group ? group.members.filter((m) => m.pub !== this.core.me).map((m) => m.pub) : null
  }

  /** How the chat is named in frames: 'enc' | 'plain' for contacts, the chat id for groups. */
  wireChat(chatId: string): string | null {
    const parsed = parseChatId(chatId)
    if (!parsed) return null
    return parsed.type === 'contact' ? parsed.kind : chatId
  }

  isEncrypted(chatId: string): boolean {
    const parsed = parseChatId(chatId)
    if (!parsed) return false
    if (parsed.type === 'contact') return parsed.kind === 'enc'
    return this.core.state.groups.find((g) => g.id === parsed.id)?.type === 'enc'
  }

  // --- sending ------------------------------------------------------------------

  send(chatId: string, html: string): SendResult {
    const recipients = this.recipients(chatId)
    const wire = this.wireChat(chatId)
    if (!recipients || !wire) return { ok: false, reason: 'no_chat' }
    if (isEmptyMessage(html)) return { ok: false, reason: 'empty' }
    if (textLength(html) > OFFLINE_CHAR_LIMIT && recipients.some((pub) => !this.core.net.isOnline(pub))) return { ok: false, reason: 'too_long_offline' }
    const enc = this.isEncrypted(chatId)
    const key = enc ? this.core.chatKey(chatId) : null
    if (enc && !key) return { ok: false, reason: 'no_chat' }
    const id = newMessageId()
    const lamport = this.core.tick()
    const ts = Date.now()
    const body = key ? encryptText(key, html, messageAd(wire, id)) : html
    this.core.chatLog(chatId).add({ id, chatId, from: this.core.me, ts, lamport, body, enc, kind: 'text', waiting: [...recipients], read: false })
    for (const pub of recipients) this.core.sendReliable(pub, { t: 'msg', rid: id, chat: wire, ts, lamport, body, enc })
    this.core.chatChanged(chatId)
    return { ok: true, id }
  }

  /** The peer confirmed it stored the message. */
  onDelivered(pub: string, frame: Of<'msg'>): void {
    const chatId = this.core.localChatId(pub, frame.chat)
    if (!chatId) return
    const log = this.core.chatLog(chatId)
    const message = log.messages.get(frame.rid)
    if (!message || !message.waiting.includes(pub)) return
    log.update(message.id, { waiting: message.waiting.filter((p) => p !== pub) })
    this.core.chatChanged(chatId)
  }

  // --- receiving ------------------------------------------------------------------

  /** Chat id on this side if the peer may write into that chat, else null. */
  private authorize(peer: Peer, wireChat: string): string | null {
    const chatId = this.core.localChatId(peer.pub, wireChat)
    if (!chatId) return null
    const parsed = parseChatId(chatId)
    if (!parsed) return null
    if (parsed.type === 'contact') return this.core.isContact(peer.pub) ? chatId : null
    const group = this.core.state.groups.find((g) => g.id === parsed.id)
    return group?.members.some((m) => m.pub === peer.pub) ? chatId : null
  }

  onMsg(peer: Peer, ctrl: Of<'msg'>): boolean {
    if (!ID_PATTERN.test(String(ctrl.rid)) || typeof ctrl.body !== 'string' || ctrl.body.length > MAX_BODY) return false
    const chatId = this.authorize(peer, String(ctrl.chat))
    if (!chatId) return false
    if (Boolean(ctrl.enc) !== this.isEncrypted(chatId)) return false
    const log = this.core.chatLog(chatId)
    if (log.has(ctrl.rid)) return true
    const lamport = Number.isFinite(ctrl.lamport) ? Math.max(0, Math.floor(ctrl.lamport)) : 0
    const ts = Number.isFinite(ctrl.ts) ? Math.min(Math.floor(ctrl.ts), Date.now() + 86_400_000) : Date.now()
    this.core.tick(lamport)
    const message: StoredMessage = { id: ctrl.rid, chatId, from: peer.pub, ts, lamport, body: ctrl.body, enc: ctrl.enc, kind: 'text', waiting: [], read: false }
    log.add(message)
    this.core.chatChanged(chatId)
    const view = this.view(message)
    this.core.emit({
      type: 'incoming',
      chatId,
      title: this.core.nameOf(peer.pub, isGroupChat(chatId) ? chatId.slice(2) : undefined),
      text: view.broken ? '' : plainText(view.html).slice(0, 160)
    })
    return true
  }

  onRead(peer: Peer, ctrl: Of<'read'>): boolean {
    const chatId = this.authorize(peer, String(ctrl.chat))
    if (!chatId || !Array.isArray(ctrl.ids)) return false
    const log = this.core.chatLog(chatId)
    let changed = false
    for (const id of ctrl.ids.slice(0, 1000)) {
      const message = log.messages.get(String(id))
      if (message && message.from === this.core.me && !message.read) {
        log.update(message.id, { read: true, waiting: message.waiting.filter((p) => p !== peer.pub) })
        changed = true
      }
    }
    if (changed) this.core.chatChanged(chatId)
    return true
  }

  onDel(peer: Peer, ctrl: Of<'del'>): boolean {
    const chatId = this.authorize(peer, String(ctrl.chat))
    if (!chatId || !Array.isArray(ctrl.ids)) return false
    const log = this.core.chatLog(chatId)
    let changed = false
    for (const id of ctrl.ids.slice(0, 1000)) {
      const message = log.messages.get(String(id))
      // Nobody can delete somebody else's message from my history.
      if (message && message.from === peer.pub) {
        this.removeMessage(chatId, message)
        changed = true
      }
    }
    if (changed) this.core.chatChanged(chatId)
    return true
  }

  onTyping(peer: Peer, ctrl: Of<'typing'>): void {
    const chatId = this.authorize(peer, String(ctrl.chat))
    if (chatId) this.core.emit({ type: 'typing', chatId, pub: peer.pub })
  }

  // --- local actions -------------------------------------------------------------------

  /** I am typing: tell the other side (at most every 3 seconds). */
  typing(chatId: string): void {
    const wire = this.wireChat(chatId)
    const recipients = this.recipients(chatId)
    if (!wire || !recipients) return
    const now = Date.now()
    if (now - (this.lastTyping.get(chatId) ?? 0) < TYPING_THROTTLE_MS) return
    this.lastTyping.set(chatId, now)
    for (const pub of recipients) this.core.sendNow(pub, { t: 'typing', chat: wire })
  }

  /** The chat is open and visible: mark incoming messages as read and tell the sender. */
  markRead(chatId: string): void {
    const log = this.core.chatLog(chatId)
    const ids: string[] = []
    for (const message of log.messages.values()) {
      if (message.from !== this.core.me && !message.read) ids.push(message.id)
    }
    if (!ids.length) return
    for (const id of ids) log.update(id, { read: true })
    const parsed = parseChatId(chatId)
    if (parsed?.type === 'contact') {
      for (let i = 0; i < ids.length; i += 200) this.core.sendReliable(parsed.pub, { t: 'read', rid: newId(), chat: parsed.kind, ids: ids.slice(i, i + 200) })
    }
    this.core.chatChanged(chatId)
  }

  private removeMessage(chatId: string, message: StoredMessage): void {
    this.core.chatLog(chatId).remove(message.id)
    this.core.dropOutbox((entry) => entry.frame.t === 'msg' && entry.frame.rid === message.id)
    if (message.kind === 'file') this.core.transfers.discard(message)
  }

  /** `me`: only from my history (also cancels messages still waiting). `both`: own messages are removed on the other side too. */
  deleteMessages(chatId: string, ids: string[], scope: 'me' | 'both'): { deleted: number; skipped: number } {
    const log = this.core.chatLog(chatId)
    const wire = this.wireChat(chatId)
    const recipients = this.recipients(chatId)
    const removed: string[] = []
    let skipped = 0
    for (const id of ids) {
      const message = log.messages.get(id)
      if (!message) continue
      if (scope === 'both' && message.from !== this.core.me) {
        skipped++
        continue
      }
      this.removeMessage(chatId, message)
      removed.push(id)
    }
    if (scope === 'both' && removed.length && wire && recipients) {
      for (const pub of recipients) {
        for (let i = 0; i < removed.length; i += 200) this.core.sendReliable(pub, { t: 'del', rid: newId(), chat: wire, ids: removed.slice(i, i + 200) })
      }
    }
    if (removed.length) this.core.chatChanged(chatId)
    return { deleted: removed.length, skipped }
  }

  // --- views ------------------------------------------------------------------------------

  /** Decrypted text and file metadata of a stored message. */
  view(message: StoredMessage): MessageView {
    const mine = message.from === this.core.me
    const group = isGroupChat(message.chatId) ? message.chatId.slice(2) : undefined
    let text = message.body
    let broken = false
    if (message.enc) {
      const key = this.core.chatKey(message.chatId)
      const wire = this.wireChat(message.chatId) ?? ''
      const plain = key ? decryptText(key, message.body, messageAd(wire, message.id)) : null
      if (plain === null) broken = true
      text = plain ?? ''
    }
    let file: FileView | undefined
    let html = text
    if (message.kind === 'file' && message.file) {
      let meta: FileMeta | null = null
      try {
        meta = broken ? null : (JSON.parse(text) as FileMeta)
      } catch {
        broken = true
      }
      file = {
        name: meta?.name ?? '?',
        size: meta?.size ?? 0,
        mime: meta?.mime ?? '',
        hash: meta?.hash ?? '',
        state: this.core.transfers.effectiveState(message.id, message.file.state),
        direction: message.file.direction,
        done: this.core.transfers.progressOf(message.id, message.file.state, meta?.size ?? 0),
        rel: message.file.rel,
        feedback: message.file.feedback
      }
      html = ''
    }
    const status = mine ? (message.read ? 'read' : message.waiting.length ? 'pending' : 'delivered') : null
    return {
      id: message.id,
      chatId: message.chatId,
      from: message.from,
      fromName: mine ? '' : this.core.nameOf(message.from, group),
      mine,
      ts: message.ts,
      lamport: message.lamport,
      html,
      status,
      unread: !mine && !message.read,
      file,
      broken: broken || undefined
    }
  }

  list(chatId: string): MessageView[] {
    if (!parseChatId(chatId)) return []
    return this.core.chatLog(chatId).sorted().map((message) => this.view(message))
  }

  /** Remove a file that belongs to a deleted message from the disk. */
  removeFile(rel: string): void {
    rmSync(join(this.core.filesRoot, ...rel.split('/')), { force: true })
  }
}
