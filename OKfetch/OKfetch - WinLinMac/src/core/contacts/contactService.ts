// Contacts, requests, profile and blocking.
// Adding a contact: the requester dials the receiver, the receiver answers with a random challenge, the requester
// proves it knows the receive password (without sending it) and hands over a fresh 16-character contact key
// that only a holder of the password can unwrap. The receiver then accepts or declines.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  contactChatId, fileUrl,
  type AddContactResult, type BlockedView, type ContactView, type OutgoingRequestView, type ProfileView, type RequestView
} from '../../shared/model'
import { validatePassword, type PasswordError } from '../../shared/keys'
import type { Core } from '../controller'
import { generateContactKey, isContactKey } from '../encryption/contactKey'
import { fingerprint } from '../encryption/fingerprint'
import { deriveK, makeProof, unwrapContactKey, verifyProof, wrapContactKey } from '../encryption/passwordProof'
import { newId } from '../ids'
import { fromIdentifier, parseIdentifier } from '../identity'
import type { Ctrl } from '../network/protocol'
import type { Peer } from '../network/swarm'
import { randomBytes, blake2b } from '../sodium'
import { chatDirName } from '../storage/names'

type Of<T extends Ctrl['t']> = Extract<Ctrl, { t: T }>

const MAX_AVATAR_BYTES = 256 * 1024

export function cleanName(raw: unknown, max = 64): string {
  return typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : ''
}

export class ContactService {
  private challenges = new Map<string, Buffer>()
  private idle = new Map<string, NodeJS.Timeout>()

  constructor(private core: Core) {}

  private get state() {
    return this.core.state
  }

  private get avatarDir(): string {
    return join(this.core.filesRoot, '_avatars')
  }

  private avatarRel = (hash: string): string => `_avatars/${hash}.png`

  private saveAvatar(png: Uint8Array): string {
    const hash = blake2b(png).toString('hex')
    mkdirSync(this.avatarDir, { recursive: true })
    const path = join(this.avatarDir, `${hash}.png`)
    if (!existsSync(path)) writeFileSync(path, png)
    return hash
  }

  private hasAvatar = (hash: string): boolean => existsSync(join(this.avatarDir, `${hash}.png`))

  private avatarUrl(hash: string | null): string | null {
    return hash && this.hasAvatar(hash) ? fileUrl(this.avatarRel(hash)) : null
  }

  // --- views ------------------------------------------------------------

  list(): ContactView[] {
    return this.state.contacts.map((contact) => {
      const enc = contactChatId(contact.pub, 'enc')
      const plain = contactChatId(contact.pub, 'plain')
      return {
        pub: contact.pub,
        name: contact.name,
        username: contact.username,
        online: this.core.net.isOnline(contact.pub) && !this.core.isBlocked(contact.pub),
        verified: contact.verified,
        blocked: this.core.isBlocked(contact.pub),
        avatar: this.avatarUrl(contact.icon) ?? this.avatarUrl(contact.avatar),
        unread: { enc: this.core.unread(enc), plain: this.core.unread(plain) },
        lastActivity: Math.max(this.lastTs(enc), this.lastTs(plain), contact.addedAt)
      }
    })
  }

  private lastTs(chatId: string): number {
    let last = 0
    for (const message of this.core.chatLog(chatId).messages.values()) last = Math.max(last, message.ts)
    return last
  }

  incoming(): RequestView[] {
    return this.state.incoming.map((r) => ({ pub: r.pub, username: r.username, ts: r.ts }))
  }

  outgoing(): OutgoingRequestView[] {
    return this.state.outgoing.map((r) => ({ pub: r.pub, name: r.name, ts: r.ts, state: r.state, reason: r.reason, retryMin: r.retryMin, feedback: r.feedback }))
  }

  blockedList(): BlockedView[] {
    return this.state.blocked.map((b) => ({ pub: b.pub, name: b.name, ts: b.ts }))
  }

  profile(): ProfileView {
    return {
      username: this.state.profile.username,
      identifier: this.core.me,
      avatar: this.avatarUrl(this.state.profile.avatar),
      passwordSet: Boolean(this.state.profile.kBlob)
    }
  }

  // --- profile ------------------------------------------------------------

  private broadcastHello(): void {
    for (const contact of this.state.contacts) {
      const peer = this.core.net.peer(contact.pub)
      if (peer) this.core.sendHello(peer)
    }
    this.core.emit({ type: 'profile' })
  }

  setUsername(name: string): void {
    this.state.profile.username = cleanName(name)
    this.state.saveProfile()
    this.broadcastHello()
  }

  /** PNG bytes already cropped and scaled by the renderer; null removes the picture. */
  setAvatar(png: Uint8Array | null): boolean {
    if (png && (png.length > MAX_AVATAR_BYTES || png.length < 8)) return false
    this.state.profile.avatar = png ? this.saveAvatar(png) : null
    this.state.saveProfile()
    this.broadcastHello()
    return true
  }

  async setPassword(password: string | null): Promise<PasswordError | null> {
    if (password === null || password === '') {
      this.state.profile.kBlob = null
    } else {
      const error = validatePassword(password)
      if (error) return error
      const k = await deriveK(password, this.core.identity.publicKey, this.core.kdf)
      this.state.profile.kBlob = this.core.protector.protect(k.toString('hex'))
    }
    this.state.saveProfile()
    this.core.emit({ type: 'profile' })
    return null
  }

  // --- requests I send --------------------------------------------------------

  async add(raw: string, password: string, name?: string): Promise<AddContactResult> {
    const pub = parseIdentifier(raw)
    if (!pub) return { ok: false, reason: 'bad_identifier' }
    if (pub === this.core.me) return { ok: false, reason: 'self' }
    if (this.core.isContact(pub)) return { ok: false, reason: 'exists' }
    if (this.core.isBlocked(pub)) return { ok: false, reason: 'blocked' }
    const existing = this.state.outgoing.find((r) => r.pub === pub)
    if (existing && existing.state !== 'rejected') return { ok: false, reason: 'pending' }
    if (validatePassword(password)) return { ok: false, reason: 'bad_password' }
    const k = await deriveK(password, fromIdentifier(pub), this.core.kdf)
    const request = {
      pub,
      name: cleanName(name),
      ts: Date.now(),
      keyBlob: this.core.protector.protect(generateContactKey()),
      kBlob: this.core.protector.protect(k.toString('hex')),
      state: 'waiting' as const
    }
    this.state.outgoing = [...this.state.outgoing.filter((r) => r.pub !== pub), request]
    this.state.saveContacts()
    this.core.net.dial(pub)
    this.core.sendNow(pub, { t: 'challenge_get' })
    this.core.emit({ type: 'requests' })
    return { ok: true }
  }

  cancelOutgoing(pub: string): void {
    this.state.outgoing = this.state.outgoing.filter((r) => r.pub !== pub)
    this.state.saveContacts()
    this.core.releaseIfUnused(pub)
    this.core.emit({ type: 'requests' })
  }

  // --- requests I receive -------------------------------------------------------

  /** Send the challenge to someone who is not a contact. `strict` closes the connection if nothing happens. */
  challenge(peer: Peer, strict = true): void {
    if (!this.state.profile.kBlob) {
      peer.send({ t: 'request_result', rid: newId(), accepted: false, reason: 'no_password' })
      return
    }
    const nonce = randomBytes(16)
    this.challenges.set(peer.pub, nonce)
    peer.send({ t: 'challenge', nonce: nonce.toString('base64') })
    if (strict && !this.core.isMember(peer.pub)) {
      clearTimeout(this.idle.get(peer.pub))
      const timer = setTimeout(() => {
        if (!this.core.isContact(peer.pub)) peer.close()
      }, this.core.strangerTimeoutMs)
      timer.unref?.()
      this.idle.set(peer.pub, timer)
    }
  }

  onClose(pub: string): void {
    this.challenges.delete(pub)
    clearTimeout(this.idle.get(pub))
    this.idle.delete(pub)
  }

  onChallenge(peer: Peer, ctrl: Of<'challenge'>): void {
    const request = this.state.outgoing.find((r) => r.pub === peer.pub)
    if (!request || request.state === 'rejected') return
    const nonce = Buffer.from(ctrl.nonce, 'base64')
    if (nonce.length !== 16) return
    const k = Buffer.from(this.core.protector.unprotect(request.kBlob), 'hex')
    const key = this.core.protector.unprotect(request.keyBlob)
    peer.send({
      t: 'request',
      username: this.state.profile.username,
      proof: makeProof(k, nonce, this.core.identity.publicKey, fromIdentifier(peer.pub)).toString('base64'),
      key: wrapContactKey(k, nonce, key)
    })
  }

  onRequest(peer: Peer, ctrl: Of<'request'>): void {
    const pub = peer.pub
    const nonce = this.challenges.get(pub)
    const kBlob = this.state.profile.kBlob
    if (!nonce || !kBlob) return
    this.challenges.delete(pub)
    const refuse = (reason: string, retryMs = 0): void => {
      peer.send({ t: 'request_result', rid: newId(), accepted: false, reason, retryMin: Math.ceil(retryMs / 60000) })
    }
    const verdict = this.core.rate.check(pub)
    if (!verdict.allowed) return refuse('rate_limited', verdict.retryAfterMs)
    const k = Buffer.from(this.core.protector.unprotect(kBlob), 'hex')
    const proof = Buffer.from(String(ctrl.proof), 'base64')
    if (!verifyProof(k, nonce, fromIdentifier(pub), this.core.identity.publicKey, proof)) {
      const after = this.core.rate.fail(pub)
      return after.allowed ? refuse('bad_password') : refuse('rate_limited', after.retryAfterMs)
    }
    const key = unwrapContactKey(k, nonce, String(ctrl.key))
    if (!isContactKey(key)) return
    this.core.rate.success(pub)
    const username = cleanName(ctrl.username) || `${pub.slice(0, 8)}…`
    this.state.incoming = [...this.state.incoming.filter((r) => r.pub !== pub), { pub, username, ts: Date.now(), keyBlob: this.core.protector.protect(key) }]
    this.state.saveContacts()
    peer.send({ t: 'request_result', rid: newId(), accepted: false, reason: 'received' })
    this.core.emit({ type: 'requests' })
    this.core.emit({ type: 'request', title: username })
  }

  accept(pub: string, name?: string): boolean {
    const request = this.state.incoming.find((r) => r.pub === pub)
    if (!request || this.core.isBlocked(pub)) return false
    this.state.incoming = this.state.incoming.filter((r) => r.pub !== pub)
    this.state.contacts.push({
      pub, name: cleanName(name) || request.username, username: request.username, icon: null, avatar: null, verified: false, addedAt: Date.now(), keyBlob: request.keyBlob
    })
    this.state.saveContacts()
    this.core.net.dial(pub)
    this.core.sendReliable(pub, { t: 'request_result', rid: newId(), accepted: true, username: this.state.profile.username })
    const peer = this.core.net.peer(pub)
    if (peer) this.core.sendHello(peer)
    this.core.emit({ type: 'requests' })
    this.core.emit({ type: 'contacts' })
    return true
  }

  reject(pub: string, feedback = ''): void {
    if (!this.state.incoming.some((r) => r.pub === pub)) return
    this.state.incoming = this.state.incoming.filter((r) => r.pub !== pub)
    this.state.saveContacts()
    this.core.sendReliable(pub, { t: 'request_result', rid: newId(), accepted: false, reason: 'declined', feedback: cleanName(feedback, 300) })
    this.core.emit({ type: 'requests' })
  }

  onResult(peer: Peer, ctrl: Of<'request_result'>): boolean {
    const pub = peer.pub
    const request = this.state.outgoing.find((r) => r.pub === pub)
    if (!request) return false
    if (ctrl.accepted) {
      const username = cleanName(ctrl.username) || `${pub.slice(0, 8)}…`
      this.state.outgoing = this.state.outgoing.filter((r) => r.pub !== pub)
      this.state.contacts.push({
        pub, name: request.name || username, username, icon: null, avatar: null, verified: false, addedAt: Date.now(), keyBlob: request.keyBlob
      })
      this.state.saveContacts()
      this.core.sendHello(peer)
      this.core.emit({ type: 'requests' })
      this.core.emit({ type: 'contacts' })
    } else if (ctrl.reason === 'received') {
      request.state = 'sent'
      this.state.saveContacts()
      this.core.emit({ type: 'requests' })
    } else {
      request.state = 'rejected'
      request.reason = cleanName(ctrl.reason, 40) || 'declined'
      request.retryMin = Number(ctrl.retryMin) || undefined
      request.feedback = cleanName(ctrl.feedback, 300) || undefined
      this.state.saveContacts()
      this.core.emit({ type: 'requests' })
    }
    return true
  }

  // --- profile exchange ------------------------------------------------------------

  onHello(peer: Peer, ctrl: Of<'hello'>): void {
    const contact = this.state.contacts.find((c) => c.pub === peer.pub)
    if (!contact) return
    if (!peer.greeted) this.core.sendHello(peer)
    const username = cleanName(ctrl.username)
    let changed = false
    if (username && username !== contact.username) {
      // Follow the contact's own name unless I gave it another one.
      if (contact.name === contact.username) contact.name = username
      contact.username = username
      changed = true
    }
    const avatar = typeof ctrl.avatar === 'string' && /^[0-9a-f]{64}$/.test(ctrl.avatar) ? ctrl.avatar : null
    if (avatar && avatar !== contact.avatar) {
      if (this.hasAvatar(avatar)) {
        contact.avatar = avatar
        changed = true
      } else {
        peer.send({ t: 'avatar_get', hash: avatar })
      }
    } else if (!avatar && contact.avatar) {
      contact.avatar = null
      changed = true
    }
    if (changed) {
      this.state.saveContacts()
      this.core.emit({ type: 'contacts' })
    }
  }

  onAvatar(peer: Peer, ctrl: Of<'avatar_get'> | Of<'avatar'>): void {
    if (ctrl.t === 'avatar_get') {
      const hash = this.state.profile.avatar
      if (!hash || hash !== ctrl.hash) return
      const path = join(this.avatarDir, `${hash}.png`)
      if (existsSync(path)) peer.send({ t: 'avatar', hash, data: readFileSync(path).toString('base64') })
      return
    }
    const contact = this.state.contacts.find((c) => c.pub === peer.pub)
    if (!contact || typeof ctrl.data !== 'string' || ctrl.data.length > MAX_AVATAR_BYTES * 2) return
    const data = Buffer.from(ctrl.data, 'base64')
    if (data.length > MAX_AVATAR_BYTES || blake2b(data).toString('hex') !== ctrl.hash) return
    this.saveAvatar(data)
    contact.avatar = ctrl.hash
    this.state.saveContacts()
    this.core.emit({ type: 'contacts' })
  }

  // --- managing contacts ---------------------------------------------------------------

  rename(pub: string, name: string): void {
    const contact = this.state.contacts.find((c) => c.pub === pub)
    if (!contact) return
    contact.name = cleanName(name) || contact.username
    this.state.saveContacts()
    this.core.emit({ type: 'contacts' })
    this.core.emit({ type: 'groups' })
  }

  setIcon(pub: string, png: Uint8Array | null): boolean {
    const contact = this.state.contacts.find((c) => c.pub === pub)
    if (!contact || (png && png.length > MAX_AVATAR_BYTES)) return false
    contact.icon = png ? this.saveAvatar(png) : null
    this.state.saveContacts()
    this.core.emit({ type: 'contacts' })
    return true
  }

  setVerified(pub: string, verified: boolean): void {
    const contact = this.state.contacts.find((c) => c.pub === pub)
    if (!contact) return
    contact.verified = verified
    this.state.saveContacts()
    this.core.emit({ type: 'contacts' })
  }

  fingerprint(pub: string): string {
    return fingerprint(this.core.identity.publicKey, fromIdentifier(pub))
  }

  block(pub: string, name = ''): void {
    if (pub === this.core.me || this.core.isBlocked(pub)) return
    const contact = this.state.contacts.find((c) => c.pub === pub)
    const request = this.state.incoming.find((r) => r.pub === pub)
    this.state.blocked.push({ pub, name: contact?.name || request?.username || cleanName(name), ts: Date.now() })
    this.state.saveBlocked()
    this.state.incoming = this.state.incoming.filter((r) => r.pub !== pub)
    this.state.saveContacts()
    this.core.net.peer(pub)?.close()
    this.core.emit({ type: 'blocked' })
    this.core.emit({ type: 'requests' })
    this.core.emit({ type: 'contacts' })
    this.core.emit({ type: 'groups' })
  }

  unblock(pub: string): void {
    this.state.blocked = this.state.blocked.filter((b) => b.pub !== pub)
    this.state.saveBlocked()
    if (this.core.isContact(pub)) this.core.net.dial(pub)
    this.core.emit({ type: 'blocked' })
    this.core.emit({ type: 'contacts' })
  }

  /** Delete the contact together with both chats and the received files. */
  remove(pub: string): void {
    if (!this.core.isContact(pub)) return
    this.state.contacts = this.state.contacts.filter((c) => c.pub !== pub)
    this.state.saveContacts()
    this.core.dropOutbox((entry) => entry.peer === pub)
    this.core.transfers.cancelAllFor(pub)
    for (const kind of ['enc', 'plain'] as const) {
      const chatId = contactChatId(pub, kind)
      this.core.deleteChat(chatId)
      rmSync(join(this.core.filesRoot, chatDirName(chatId)), { recursive: true, force: true })
    }
    this.core.releaseIfUnused(pub)
    this.core.emit({ type: 'contacts' })
    this.core.emit({ type: 'groups' })
  }

  shutdown(): void {
    for (const timer of this.idle.values()) clearTimeout(timer)
    this.idle.clear()
  }
}
