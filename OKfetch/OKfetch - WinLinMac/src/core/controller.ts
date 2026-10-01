// The core: owns identity, state and network, routes incoming frames to the services
// and turns state changes into events for the UI. No Electron here, so it is testable.
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { CoreEvent } from '../shared/ipc'
import { contactChatId, isGroupChat, parseChatId } from '../shared/model'
import { deriveChatKey } from './encryption/aead'
import { DEFAULT_KDF, type KdfParams } from './encryption/passwordProof'
import { ContactService } from './contacts/contactService'
import { GroupService } from './groups/groupService'
import { createIdentity, fromIdentifier, toIdentifier, type Identity } from './identity'
import { MessageService } from './messages/messageService'
import { FRAME_BLOCK, RELIABLE, decodeBlock, parseCtrl, PROTOCOL_VERSION, type Ctrl, type Frame } from './network/protocol'
import { PeerNetwork, type Peer } from './network/swarm'
import type { OutboxEntry } from './records'
import { RateLimiter } from './security/rateLimit'
import { CoreState, plainProtector, type KeyProtector } from './state'
import { ChatLog } from './storage/chatLog'
import { readJson, writeJson } from './storage/jsonStore'
import { chatDirName } from './storage/names'
import { TransferService } from './files_transfer/transferService'

export type { CoreEvent }

export interface CoreOptions {
  /** Storage folder. */
  root: string
  protector?: KeyProtector
  /** Local DHT bootstrap (tests). Default = public HyperDHT. */
  bootstrap?: { host: string; port: number }[]
  /** Lighter Argon2 settings for tests. */
  kdf?: KdfParams
  retryMs?: number
  strangerTimeoutMs?: number
  /** How long opening the core waits for the network before it continues in the background. */
  startTimeoutMs?: number
}

interface IdentityFile {
  publicKey: string
  secretBlob: string
}

export class Core {
  readonly state: CoreState
  readonly protector: KeyProtector
  readonly identity: Identity
  readonly me: string
  readonly kdf: KdfParams
  readonly rate = new RateLimiter()
  readonly net: PeerNetwork
  readonly contacts: ContactService
  readonly messages: MessageService
  readonly transfers: TransferService
  readonly groups: GroupService
  readonly strangerTimeoutMs: number
  private listeners = new Set<(event: CoreEvent) => void>()
  private logs = new Map<string, ChatLog>()
  private unreadCache = new Map<string, number>()
  private lamport = 0
  private closed = false

  private constructor(readonly options: CoreOptions) {
    mkdirSync(options.root, { recursive: true })
    this.protector = options.protector ?? plainProtector
    this.kdf = options.kdf ?? DEFAULT_KDF
    this.strangerTimeoutMs = options.strangerTimeoutMs ?? 30_000
    this.state = new CoreState(options.root)
    this.identity = this.loadIdentity()
    this.me = toIdentifier(this.identity.publicKey)
    this.lamport = this.state.profile.lamport
    this.net = new PeerNetwork({
      identity: this.identity,
      bootstrap: options.bootstrap,
      retryMs: options.retryMs,
      admit: (pub) => !this.isBlocked(pub),
      onOpen: (peer) => this.handleOpen(peer),
      onFrame: (peer, frame) => this.handleFrame(peer, frame),
      onClose: (peer) => this.handleClose(peer),
      onStatus: (status) => this.emit({ type: 'net', status })
    })
    this.contacts = new ContactService(this)
    this.messages = new MessageService(this)
    this.transfers = new TransferService(this)
    this.groups = new GroupService(this)
  }

  static async open(options: CoreOptions): Promise<Core> {
    const core = new Core(options)
    // Without internet the DHT may take long to give up; the UI must not wait for it.
    const starting = core.net.start().catch((error) => console.error('[okfetch] network start failed', error))
    await Promise.race([starting, new Promise((resolve) => setTimeout(resolve, options.startTimeoutMs ?? 8000).unref?.())])
    core.dialKnown()
    return core
  }

  private loadIdentity(): Identity {
    const path = this.state.file('identity.json')
    const stored = readJson<IdentityFile | null>(path, null)
    if (stored) {
      return { publicKey: Buffer.from(stored.publicKey, 'hex'), secretKey: Buffer.from(this.protector.unprotect(stored.secretBlob), 'hex') }
    }
    const identity = createIdentity()
    writeJson(path, { publicKey: identity.publicKey.toString('hex'), secretBlob: this.protector.protect(identity.secretKey.toString('hex')) } satisfies IdentityFile)
    return identity
  }

  // --- events ---------------------------------------------------------

  onEvent(listener: (event: CoreEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(event: CoreEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch (error) {
        console.error('[okfetch] event listener failed', error)
      }
    }
  }

  // --- shared helpers used by the services ------------------------------

  tick(observed = 0): number {
    this.lamport = Math.max(this.lamport, observed) + 1
    return this.lamport
  }

  get filesRoot(): string {
    return join(this.state.root, 'files')
  }

  chatLog(chatId: string): ChatLog {
    let log = this.logs.get(chatId)
    if (!log) {
      log = new ChatLog(join(this.state.root, 'chats', chatDirName(chatId), 'messages.jsonl'))
      for (const message of log.messages.values()) this.lamport = Math.max(this.lamport, message.lamport)
      this.logs.set(chatId, log)
    }
    return log
  }

  deleteChat(chatId: string): void {
    this.logs.delete(chatId)
    this.unreadCache.delete(chatId)
    rmSync(join(this.state.root, 'chats', chatDirName(chatId)), { recursive: true, force: true })
  }

  unread(chatId: string): number {
    let count = this.unreadCache.get(chatId)
    if (count === undefined) {
      count = 0
      for (const message of this.chatLog(chatId).messages.values()) if (message.from !== this.me && !message.read) count++
      this.unreadCache.set(chatId, count)
    }
    return count
  }

  /** Call after any change to a chat: refreshes counters and tells the UI. */
  chatChanged(chatId: string): void {
    this.unreadCache.delete(chatId)
    this.emit({ type: 'chat', chatId })
    this.emit({ type: isGroupChat(chatId) ? 'groups' : 'contacts' })
  }

  isContact(pub: string): boolean {
    return this.state.contacts.some((c) => c.pub === pub)
  }

  isBlocked(pub: string): boolean {
    return this.state.blocked.some((b) => b.pub === pub)
  }

  hasOutgoing(pub: string): boolean {
    return this.state.outgoing.some((r) => r.pub === pub)
  }

  isMember(pub: string): boolean {
    return this.state.groups.some((g) => g.members.some((m) => m.pub === pub))
  }

  nameOf(pub: string, groupId?: string): string {
    const contact = this.state.contacts.find((c) => c.pub === pub)
    if (contact) return contact.name || contact.username || pub.slice(0, 8)
    const groups = groupId ? this.state.groups.filter((g) => g.id === groupId) : this.state.groups
    for (const group of groups) {
      const member = group.members.find((m) => m.pub === pub)
      if (member?.name) return member.name
    }
    return `${pub.slice(0, 4)}…${pub.slice(-4)}`
  }

  /** Key of an encrypted chat; null for plain chats or when the key is missing. */
  chatKey(chatId: string): Buffer | null {
    const parsed = parseChatId(chatId)
    if (!parsed) return null
    if (parsed.type === 'contact') {
      if (parsed.kind !== 'enc') return null
      const contact = this.state.contacts.find((c) => c.pub === parsed.pub)
      if (!contact) return null
      return deriveChatKey(this.protector.unprotect(contact.keyBlob), 'contact', [this.identity.publicKey, fromIdentifier(parsed.pub)])
    }
    const group = this.state.groups.find((g) => g.id === parsed.id)
    if (!group || group.type !== 'enc' || !group.keyBlob) return null
    return deriveChatKey(this.protector.unprotect(group.keyBlob), `group/${group.id}`)
  }

  /** The chat id on this side for a message that names its chat the way the wire does. */
  localChatId(peerPub: string, wireChat: string): string | null {
    if (wireChat === 'enc' || wireChat === 'plain') return contactChatId(peerPub, wireChat)
    return isGroupChat(wireChat) ? wireChat : null
  }

  sendNow(pub: string, frame: Ctrl): boolean {
    return this.net.peer(pub)?.send(frame) ?? false
  }

  /** Keep the frame until the peer confirms it, resend on every new connection. */
  sendReliable(pub: string, frame: Ctrl & { rid: string }): void {
    if (!this.state.outbox.some((e) => e.peer === pub && e.rid === frame.rid)) {
      this.state.outbox.push({ rid: frame.rid, peer: pub, frame, ts: Date.now() })
      this.state.saveOutbox()
    }
    this.net.dial(pub)
    this.sendNow(pub, frame)
  }

  /** Stop dialling a peer that nothing needs any more (not a contact, no group, no waiting frame, no request). */
  releaseIfUnused(pub: string): void {
    if (this.isContact(pub) || this.isMember(pub) || this.hasOutgoing(pub) || this.state.outbox.some((e) => e.peer === pub)) return
    this.net.undial(pub)
  }

  dropOutbox(match: (entry: OutboxEntry) => boolean): void {
    const before = this.state.outbox.length
    this.state.outbox = this.state.outbox.filter((entry) => !match(entry))
    if (this.state.outbox.length !== before) this.state.saveOutbox()
  }

  /** Every peer we want to be connected to. */
  dialKnown(): void {
    for (const contact of this.state.contacts) this.net.dial(contact.pub)
    for (const request of this.state.outgoing) if (request.state === 'waiting') this.net.dial(request.pub)
    for (const group of this.state.groups) for (const member of group.members) if (member.pub !== this.me) this.net.dial(member.pub)
    for (const entry of this.state.outbox) this.net.dial(entry.peer)
  }

  // --- network callbacks -------------------------------------------------

  private handleOpen(peer: Peer): void {
    const pub = peer.pub
    if (this.isContact(pub) || this.isMember(pub)) {
      this.sendHello(peer)
      for (const entry of this.state.outbox) if (entry.peer === pub) peer.send(entry.frame)
    } else if (!this.hasOutgoing(pub)) {
      this.contacts.challenge(peer)
    }
    if (this.isMember(pub) && !this.isContact(pub)) this.contacts.challenge(peer, false)
    this.emit({ type: 'contacts' })
    this.emit({ type: 'groups' })
  }

  sendHello(peer: Peer): void {
    peer.greeted = true
    peer.send({ t: 'hello', v: PROTOCOL_VERSION, username: this.state.profile.username, avatar: this.state.profile.avatar })
  }

  private handleClose(peer: Peer): void {
    this.contacts.onClose(peer.pub)
    this.transfers.onPeerClosed(peer.pub)
    if (!this.closed) {
      this.emit({ type: 'contacts' })
      this.emit({ type: 'groups' })
    }
  }

  private handleFrame(peer: Peer, frame: Frame): void {
    const pub = peer.pub
    if (frame.type === FRAME_BLOCK) {
      const block = decodeBlock(frame.payload)
      if (block && this.isContact(pub)) this.transfers.onBlock(peer, block)
      return
    }
    const ctrl = parseCtrl(frame)
    if (!ctrl) return
    const known = this.isContact(pub) || this.isMember(pub) || this.hasOutgoing(pub)
    let ack = false
    switch (ctrl.t) {
      case 'hello':
        if (known) this.contacts.onHello(peer, ctrl)
        break
      case 'challenge':
        if (this.hasOutgoing(pub)) this.contacts.onChallenge(peer, ctrl)
        break
      case 'challenge_get':
        if (!this.isContact(pub)) this.contacts.challenge(peer)
        break
      case 'request':
        if (!this.isContact(pub)) this.contacts.onRequest(peer, ctrl)
        break
      case 'request_result':
        if (this.hasOutgoing(pub)) ack = this.contacts.onResult(peer, ctrl)
        break
      case 'rack':
        if (known) this.onRack(pub, ctrl.rid)
        break
      case 'msg':
        ack = this.messages.onMsg(peer, ctrl)
        break
      case 'read':
        ack = this.messages.onRead(peer, ctrl)
        break
      case 'del':
        ack = this.messages.onDel(peer, ctrl)
        break
      case 'typing':
        this.messages.onTyping(peer, ctrl)
        break
      case 'avatar_get':
      case 'avatar':
        if (this.isContact(pub)) this.contacts.onAvatar(peer, ctrl)
        break
      case 'file_offer':
        ack = this.transfers.onOffer(peer, ctrl)
        break
      case 'file_accept':
        ack = this.transfers.onAccept(peer, ctrl)
        break
      case 'file_reject':
        ack = this.transfers.onReject(peer, ctrl)
        break
      case 'file_cancel':
        this.transfers.onCancel(peer, ctrl)
        break
      case 'file_end':
        void this.transfers.onEnd(peer, ctrl)
        break
      case 'file_done':
        this.transfers.onDone(peer, ctrl)
        break
      case 'group_invite':
        ack = this.groups.onInvite(peer, ctrl)
        break
      case 'group_join':
        ack = this.groups.onJoin(peer, ctrl)
        break
      case 'group_update':
        ack = this.groups.onUpdate(peer, ctrl)
        break
      case 'group_leave':
        ack = this.groups.onLeave(peer, ctrl)
        break
    }
    if (ack && 'rid' in ctrl && RELIABLE.has(ctrl.t)) peer.send({ t: 'rack', rid: ctrl.rid })
  }

  private onRack(pub: string, rid: string): void {
    const entry = this.state.outbox.find((e) => e.peer === pub && e.rid === rid)
    if (!entry) return
    this.dropOutbox((e) => e === entry)
    this.releaseIfUnused(pub)
    if (entry.frame.t === 'msg') this.messages.onDelivered(pub, entry.frame)
    else if (entry.frame.t === 'file_offer') this.transfers.onOfferDelivered(pub, entry.frame.rid)
  }

  // --- life cycle ----------------------------------------------------------

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.state.profile.lamport = this.lamport
    this.state.saveProfile()
    this.transfers.shutdown()
    this.contacts.shutdown()
    await this.net.destroy()
  }
}

