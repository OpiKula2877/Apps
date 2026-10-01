// File transfer: offer, accept / reject (with an explanation), blocks of 64 KiB with backpressure,
// BLAKE2b check on arrival. Encrypted chats encrypt every block; plain chats send raw blocks.
import { closeSync, mkdirSync, openSync, readSync, renameSync, rmSync, statSync, writeSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { parseChatId, type FileState, type SendResult } from '../../shared/model'
import type { Core } from '../controller'
import { encryptText, messageAd } from '../encryption/aead'
import { BLOCK_OVERHEAD, BLOCK_SIZE, decryptBlock, deriveFileKey, encryptBlock } from '../encryption/fileCipher'
import type { Ctrl } from '../network/protocol'
import type { Peer } from '../network/swarm'
import { hashStream } from '../sodium'
import { chatDirName, safeFileName } from '../storage/names'
import { newMessageId, type FileMeta } from '../messages/messageService'
import { cleanName } from '../contacts/contactService'
import type { StoredMessage } from '../records'
import { decryptText } from '../encryption/aead'

type Of<T extends Ctrl['t']> = Extract<Ctrl, { t: T }>

const ID_PATTERN = /^[0-9a-f]{32}$/
const PROGRESS_INTERVAL_MS = 150

interface Transfer {
  id: string
  chatId: string
  peer: string
  direction: 'in' | 'out'
  meta: FileMeta
  key: Buffer | null
  done: number
  /** Blocks sent or received so far. */
  blocks: number
  state: FileState
  abort: boolean
  // receiving
  partPath?: string
  finalPath?: string
  fd?: number
  chain: Promise<void>
  hasher?: ReturnType<typeof hashStream>
  lastReport: number
}

const MIME: Record<string, string> = {
  gif: 'image/gif', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', txt: 'text/plain', pdf: 'application/pdf',
  zip: 'application/zip', mp4: 'video/mp4', mp3: 'audio/mpeg'
}

export const IMAGE_MIMES: ReadonlySet<string> = new Set(['image/gif', 'image/png', 'image/jpeg', 'image/webp'])

function guessMime(name: string): string {
  const extension = name.split('.').pop()?.toLowerCase() ?? ''
  return MIME[extension] ?? 'application/octet-stream'
}

// Plain synchronous file calls work the same on the desktop (Node) and on the phone (Bare); the loop yields so the UI stays alive.
const yieldToLoop = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

async function hashFile(path: string): Promise<string> {
  const hasher = hashStream()
  const fd = openSync(path, 'r')
  try {
    const buffer = Buffer.alloc(1024 * 1024)
    for (let position = 0; ; ) {
      const read = readSync(fd, buffer, 0, buffer.length, position)
      if (read === 0) break
      hasher.update(buffer.subarray(0, read))
      position += read
      await yieldToLoop()
    }
  } finally {
    closeSync(fd)
  }
  return hasher.digest().toString('hex')
}

function writeAll(fd: number, data: Buffer): void {
  for (let offset = 0; offset < data.length; ) offset += writeSync(fd, data, offset, data.length - offset)
}

export class TransferService {
  private active = new Map<string, Transfer>()

  constructor(private core: Core) {}

  // --- helpers ------------------------------------------------------------------

  private find(pub: string, id: string): { chatId: string; message: StoredMessage } | null {
    for (const kind of ['enc', 'plain'] as const) {
      const chatId = `${pub}:${kind}`
      const message = this.core.chatLog(chatId).messages.get(id)
      if (message?.kind === 'file' && message.file) return { chatId, message }
    }
    return null
  }

  private readMeta(message: StoredMessage): FileMeta | null {
    try {
      let text = message.body
      if (message.enc) {
        const key = this.core.chatKey(message.chatId)
        const wire = this.core.messages.wireChat(message.chatId) ?? ''
        const plain = key ? decryptText(key, message.body, messageAd(wire, message.id)) : null
        if (plain === null) return null
        text = plain
      }
      return JSON.parse(text) as FileMeta
    } catch {
      return null
    }
  }

  private patch(chatId: string, id: string, file: Partial<NonNullable<StoredMessage['file']>>): void {
    this.core.chatLog(chatId).update(id, { file })
    this.core.chatChanged(chatId)
  }

  private report(t: Transfer, force = false): void {
    const now = Date.now()
    if (!force && now - t.lastReport < PROGRESS_INTERVAL_MS) return
    t.lastReport = now
    this.core.emit({ type: 'transfer', progress: { chatId: t.chatId, messageId: t.id, done: t.done, total: t.meta.size, state: t.state } })
  }

  progressOf(id: string, state: FileState, size: number): number {
    const active = this.active.get(id)
    if (active) return active.done
    return state === 'done' ? size : 0
  }

  /** A transfer that was running when the app stopped can never finish: show it as failed. */
  effectiveState(id: string, state: FileState): FileState {
    return (state === 'transferring' || state === 'accepted') && !this.active.has(id) ? 'failed' : state
  }

  filePath(chatId: string, id: string): string | null {
    const message = this.core.chatLog(chatId).messages.get(id)
    return message?.file?.rel && message.file.state === 'done' ? join(this.core.filesRoot, ...message.file.rel.split('/')) : null
  }

  // --- sending ---------------------------------------------------------------------

  async sendFile(chatId: string, path: string): Promise<SendResult> {
    const parsed = parseChatId(chatId)
    if (!parsed || parsed.type !== 'contact' || !this.core.isContact(parsed.pub)) return { ok: false, reason: 'no_chat' }
    let size: number
    try {
      const info = statSync(path)
      if (!info.isFile()) return { ok: false, reason: 'no_file' }
      size = info.size
    } catch {
      return { ok: false, reason: 'no_file' }
    }
    const hash = await hashFile(path)
    const enc = parsed.kind === 'enc'
    const key = enc ? this.core.chatKey(chatId) : null
    if (enc && !key) return { ok: false, reason: 'no_chat' }
    const id = newMessageId()
    const name = basename(path)
    const json = JSON.stringify({ name, size, mime: guessMime(name), hash } satisfies FileMeta)
    const body = key ? encryptText(key, json, messageAd(parsed.kind, id)) : json
    const lamport = this.core.tick()
    const ts = Date.now()
    this.core.chatLog(chatId).add({
      id, chatId, from: this.core.me, ts, lamport, body, enc, kind: 'file', waiting: [parsed.pub], read: false,
      file: { state: 'offered', direction: 'out', source: path }
    })
    this.core.sendReliable(parsed.pub, { t: 'file_offer', rid: id, chat: parsed.kind, ts, lamport, meta: body, enc })
    this.core.chatChanged(chatId)
    return { ok: true, id }
  }

  onOfferDelivered(pub: string, id: string): void {
    const found = this.find(pub, id)
    if (!found) return
    this.core.chatLog(found.chatId).update(id, { waiting: [] })
    this.core.chatChanged(found.chatId)
  }

  onAccept(peer: Peer, ctrl: Of<'file_accept'>): boolean {
    const found = this.find(peer.pub, String(ctrl.id))
    if (!found || found.message.from !== this.core.me || !found.message.file?.source) return false
    const { chatId, message } = found
    if (message.file!.state !== 'offered' || this.active.has(message.id)) return true
    const meta = this.readMeta(message)
    if (!meta) return false
    const enc = message.enc
    const key = enc ? this.core.chatKey(chatId) : null
    const transfer: Transfer = {
      id: message.id, chatId, peer: peer.pub, direction: 'out', meta, key: key ? deriveFileKey(key, message.id) : null,
      done: 0, blocks: 0, state: 'transferring', abort: false, chain: Promise.resolve(), lastReport: 0
    }
    this.active.set(message.id, transfer)
    this.patch(chatId, message.id, { state: 'transferring' })
    void this.pump(transfer, peer, message.file!.source!)
    return true
  }

  private async pump(t: Transfer, peer: Peer, source: string): Promise<void> {
    let fd: number | null = null
    try {
      fd = openSync(source, 'r')
      const buffer = Buffer.alloc(BLOCK_SIZE)
      for (let index = 0; !t.abort; index++) {
        const bytesRead = readSync(fd, buffer, 0, BLOCK_SIZE, index * BLOCK_SIZE)
        if (bytesRead === 0) break
        const block = buffer.subarray(0, bytesRead)
        const data = t.key ? encryptBlock(t.key, index, block) : Buffer.from(block)
        if (!(await peer.sendBlock(t.id, index, data))) throw new Error('interrupted')
        t.done += bytesRead
        t.blocks = index + 1
        this.report(t)
        if (index % 16 === 15) await yieldToLoop()
      }
      if (t.abort) return
      if (t.done !== t.meta.size) throw new Error('changed')
      if (!peer.send({ t: 'file_end', id: t.id, blocks: t.blocks })) throw new Error('interrupted')
    } catch (error) {
      if (!t.abort) this.fail(t, error instanceof Error ? error.message : 'failed')
    } finally {
      if (fd !== null) closeSync(fd)
    }
  }

  onDone(peer: Peer, ctrl: Of<'file_done'>): void {
    const t = this.active.get(String(ctrl.id))
    if (!t || t.direction !== 'out' || t.peer !== peer.pub) return
    this.active.delete(t.id)
    t.state = ctrl.ok ? 'done' : 'failed'
    t.done = ctrl.ok ? t.meta.size : t.done
    this.patch(t.chatId, t.id, { state: t.state, feedback: ctrl.ok ? undefined : 'failed' })
    this.report(t, true)
  }

  // --- receiving ---------------------------------------------------------------------

  onOffer(peer: Peer, ctrl: Of<'file_offer'>): boolean {
    if (!this.core.isContact(peer.pub) || !ID_PATTERN.test(String(ctrl.rid))) return false
    if ((ctrl.chat !== 'enc' && ctrl.chat !== 'plain') || (ctrl.chat === 'enc') !== Boolean(ctrl.enc) || typeof ctrl.meta !== 'string' || ctrl.meta.length > 8192) return false
    const chatId = `${peer.pub}:${ctrl.chat}`
    const log = this.core.chatLog(chatId)
    if (log.has(ctrl.rid)) return true
    const lamport = Number.isFinite(ctrl.lamport) ? Math.max(0, Math.floor(ctrl.lamport)) : 0
    const message: StoredMessage = {
      id: ctrl.rid, chatId, from: peer.pub, ts: Number.isFinite(ctrl.ts) ? Math.min(ctrl.ts, Date.now() + 86_400_000) : Date.now(), lamport,
      body: ctrl.meta, enc: ctrl.enc, kind: 'file', waiting: [], read: false, file: { state: 'offered', direction: 'in' }
    }
    const meta = this.readMeta(message)
    if (!meta || typeof meta.name !== 'string' || !Number.isSafeInteger(meta.size) || meta.size < 0 || !/^[0-9a-f]{64}$/.test(String(meta.hash))) return false
    this.core.tick(lamport)
    log.add(message)
    this.core.chatChanged(chatId)
    this.core.emit({ type: 'incoming', chatId, title: this.core.nameOf(peer.pub), text: cleanName(meta.name, 120) })
    return true
  }

  accept(chatId: string, id: string): boolean {
    const message = this.core.chatLog(chatId).messages.get(id)
    const parsed = parseChatId(chatId)
    if (!message || parsed?.type !== 'contact' || message.kind !== 'file' || message.file?.direction !== 'in' || message.file.state !== 'offered') return false
    const meta = this.readMeta(message)
    if (!meta) return false
    const key = message.enc ? this.core.chatKey(chatId) : null
    const dir = join(this.core.filesRoot, chatDirName(chatId))
    const name = `${id}_${safeFileName(meta.name)}`
    const finalPath = join(dir, name)
    mkdirSync(dir, { recursive: true })
    this.active.set(id, {
      id, chatId, peer: parsed.pub, direction: 'in', meta, key: key ? deriveFileKey(key, id) : null, done: 0, blocks: 0, state: 'accepted', abort: false,
      partPath: `${finalPath}.part`, finalPath, chain: Promise.resolve(), hasher: hashStream(), lastReport: 0
    })
    this.patch(chatId, id, { state: 'accepted', rel: `${chatDirName(chatId)}/${name}` })
    this.core.sendReliable(parsed.pub, { t: 'file_accept', rid: newMessageId(), id })
    return true
  }

  reject(chatId: string, id: string, feedback = ''): boolean {
    const message = this.core.chatLog(chatId).messages.get(id)
    const parsed = parseChatId(chatId)
    if (!message || parsed?.type !== 'contact' || message.file?.direction !== 'in' || message.file.state !== 'offered') return false
    this.patch(chatId, id, { state: 'rejected', feedback: cleanName(feedback, 300) || undefined })
    this.core.sendReliable(parsed.pub, { t: 'file_reject', rid: newMessageId(), id, feedback: cleanName(feedback, 300) })
    return true
  }

  onReject(peer: Peer, ctrl: Of<'file_reject'>): boolean {
    const found = this.find(peer.pub, String(ctrl.id))
    if (!found || found.message.from !== this.core.me || found.message.file?.state !== 'offered') return found !== null
    this.patch(found.chatId, found.message.id, { state: 'rejected', feedback: cleanName(ctrl.feedback, 300) || undefined })
    return true
  }

  onBlock(peer: Peer, block: { id: string; index: number; data: Buffer }): void {
    const t = this.active.get(block.id)
    if (!t || t.direction !== 'in' || t.peer !== peer.pub || (t.state !== 'accepted' && t.state !== 'transferring')) return
    if (block.index !== t.blocks || block.data.length > BLOCK_SIZE + BLOCK_OVERHEAD) return this.fail(t, 'order')
    const plain = t.key ? decryptBlock(t.key, block.index, block.data) : block.data
    if (!plain) return this.fail(t, 'decrypt')
    if (t.done + plain.length > t.meta.size) return this.fail(t, 'size')
    if (t.state === 'accepted') {
      t.state = 'transferring'
      this.patch(t.chatId, t.id, { state: 'transferring' })
    }
    t.blocks++
    t.done += plain.length
    t.hasher!.update(plain)
    const data = Buffer.from(plain)
    t.chain = t.chain
      .then(() => {
        if (t.fd === undefined) {
          mkdirSync(dirname(t.partPath!), { recursive: true })
          t.fd = openSync(t.partPath!, 'w')
        }
        writeAll(t.fd, data)
      })
      .catch(() => {
        t.abort = true
      })
    this.report(t)
  }

  async onEnd(peer: Peer, ctrl: Of<'file_end'>): Promise<void> {
    const t = this.active.get(String(ctrl.id))
    if (!t || t.direction !== 'in' || t.peer !== peer.pub) return
    await t.chain
    if (t.fd !== undefined) closeSync(t.fd)
    t.fd = undefined
    const good = !t.abort && ctrl.blocks === t.blocks && t.done === t.meta.size && t.hasher!.digest().toString('hex') === t.meta.hash
    if (!good) {
      peer.send({ t: 'file_done', id: t.id, ok: false })
      return this.fail(t, 'hash', false)
    }
    try {
      if (t.meta.size === 0) {
        mkdirSync(dirname(t.finalPath!), { recursive: true })
        closeSync(openSync(t.finalPath!, 'w'))
      } else {
        renameSync(t.partPath!, t.finalPath!)
      }
    } catch {
      peer.send({ t: 'file_done', id: t.id, ok: false })
      return this.fail(t, 'disk', false)
    }
    this.active.delete(t.id)
    t.state = 'done'
    this.patch(t.chatId, t.id, { state: 'done' })
    this.report(t, true)
    peer.send({ t: 'file_done', id: t.id, ok: true })
  }

  // --- cancel and cleanup ------------------------------------------------------------------

  cancel(chatId: string, id: string): boolean {
    const t = this.active.get(id)
    if (t) {
      this.core.sendNow(t.peer, { t: 'file_cancel', id })
      this.stop(t, 'canceled')
      return true
    }
    const message = this.core.chatLog(chatId).messages.get(id)
    const parsed = parseChatId(chatId)
    if (message?.file && parsed?.type === 'contact' && message.file.state === 'offered') {
      // Still waiting for an answer: withdraw the offer.
      this.core.dropOutbox((entry) => entry.frame.t === 'file_offer' && entry.frame.rid === id)
      this.core.sendNow(parsed.pub, { t: 'file_cancel', id })
      this.patch(chatId, id, { state: 'canceled' })
      return true
    }
    return false
  }

  onCancel(peer: Peer, ctrl: Of<'file_cancel'>): void {
    const id = String(ctrl.id)
    const t = this.active.get(id)
    if (t && t.peer === peer.pub) return this.stop(t, 'canceled')
    const found = this.find(peer.pub, id)
    if (found?.message.file?.state === 'offered') this.patch(found.chatId, id, { state: 'canceled' })
  }

  private fail(t: Transfer, feedback: string, notify = true): void {
    if (notify) this.core.sendNow(t.peer, { t: 'file_cancel', id: t.id })
    this.stop(t, 'failed', feedback)
  }

  private stop(t: Transfer, state: FileState, feedback?: string): void {
    t.abort = true
    this.active.delete(t.id)
    const fd = t.fd
    t.fd = undefined
    void t.chain.finally(() => {
      if (fd !== undefined) {
        try {
          closeSync(fd)
        } catch {
          // already closed
        }
      }
      if (t.partPath) rmSync(t.partPath, { force: true })
    })
    t.state = state
    this.patch(t.chatId, t.id, { state, feedback })
    this.report(t, true)
  }

  onPeerClosed(pub: string): void {
    for (const t of [...this.active.values()]) if (t.peer === pub) this.stop(t, 'failed', 'interrupted')
  }

  cancelAllFor(pub: string): void {
    for (const t of [...this.active.values()]) if (t.peer === pub) this.stop(t, 'canceled')
  }

  /** The message was deleted: stop its transfer and remove the received file. */
  discard(message: StoredMessage): void {
    const t = this.active.get(message.id)
    if (t) {
      this.core.sendNow(t.peer, { t: 'file_cancel', id: t.id })
      this.stop(t, 'canceled')
    }
    if (message.file?.direction === 'in' && message.file.rel) this.core.messages.removeFile(message.file.rel)
    this.core.dropOutbox((entry) => entry.frame.t === 'file_offer' && entry.frame.rid === message.id)
  }

  shutdown(): void {
    for (const t of [...this.active.values()]) {
      t.abort = true
      if (t.fd !== undefined) {
        try {
          closeSync(t.fd)
        } catch {
          // already closed
        }
      }
    }
    this.active.clear()
  }
}
