// Groups: encrypted or plain, mesh topology (every member talks to every member).
// The roster authorises connections between members who are not contacts. Name and member changes are
// last-writer-wins on (lamport clock, public key of the writer); anyone can change them.
import { groupChatId, type GroupView } from '../../shared/model'
import type { Core } from '../controller'
import { cleanName } from '../contacts/contactService'
import { decryptText, deriveChatKey, encryptText } from '../encryption/aead'
import { generateContactKey, isContactKey } from '../encryption/contactKey'
import { newId } from '../ids'
import { fromIdentifier } from '../identity'
import type { Ctrl, GroupDoc } from '../network/protocol'
import type { Peer } from '../network/swarm'
import type { StoredGroup } from '../records'
import { randomBytes } from '../sodium'

type Of<T extends Ctrl['t']> = Extract<Ctrl, { t: T }>

const MAX_MEMBERS = 50
const ID_PATTERN = /^[0-9a-f]{32}$/
const PUB_PATTERN = /^[a-z0-9]{52}$/

/** Validate a group document that came from the network. */
export function sanitizeDoc(raw: unknown): GroupDoc | null {
  if (!raw || typeof raw !== 'object') return null
  const doc = raw as Record<string, unknown>
  if (typeof doc.id !== 'string' || !ID_PATTERN.test(doc.id) || (doc.type !== 'enc' && doc.type !== 'plain')) return null
  if (typeof doc.by !== 'string' || !PUB_PATTERN.test(doc.by) || !Array.isArray(doc.members) || doc.members.length > MAX_MEMBERS) return null
  const lamport = Number(doc.lamport)
  if (!Number.isSafeInteger(lamport) || lamport < 0) return null
  const name = cleanName(doc.name)
  if (!name) return null
  const seen = new Set<string>()
  const members: GroupDoc['members'] = []
  for (const entry of doc.members) {
    const member = entry as { pub?: unknown; name?: unknown }
    if (typeof member?.pub !== 'string' || !PUB_PATTERN.test(member.pub) || seen.has(member.pub)) return null
    seen.add(member.pub)
    members.push({ pub: member.pub, name: cleanName(member.name) })
  }
  return { id: doc.id, name, type: doc.type, members, lamport, by: doc.by }
}

/** True when (lamport, by) of `a` is newer than that of `b`. */
export const isNewer = (a: { lamport: number; by: string }, b: { lamport: number; by: string }): boolean =>
  a.lamport > b.lamport || (a.lamport === b.lamport && a.by > b.by)

export class GroupService {
  constructor(private core: Core) {}

  private get groups(): StoredGroup[] {
    return this.core.state.groups
  }

  private find(id: string): StoredGroup | undefined {
    return this.groups.find((g) => g.id === id)
  }

  private toDoc(group: StoredGroup): GroupDoc {
    return { id: group.id, name: group.name, type: group.type, members: group.members, lamport: group.lamport, by: group.by }
  }

  private others(group: StoredGroup): string[] {
    return group.members.map((m) => m.pub).filter((pub) => pub !== this.core.me)
  }

  private save(): void {
    this.core.state.saveGroups()
    this.core.emit({ type: 'groups' })
    this.core.emit({ type: 'requests' })
  }

  list(): GroupView[] {
    return this.groups.map((group) => {
      const chatId = groupChatId(group.id)
      let last = group.createdAt
      for (const message of this.core.chatLog(chatId).messages.values()) last = Math.max(last, message.ts)
      return {
        id: group.id,
        name: group.name,
        type: group.type,
        members: group.members.map((m) => ({
          pub: m.pub,
          name: m.pub === this.core.me ? this.core.state.profile.username || m.name : this.core.nameOf(m.pub, group.id),
          online: m.pub === this.core.me || this.core.net.isOnline(m.pub),
          me: m.pub === this.core.me
        })),
        unread: this.core.unread(chatId),
        state: group.state,
        inviterName: group.inviter ? this.core.nameOf(group.inviter) : null,
        lastActivity: last
      }
    })
  }

  // --- creating and inviting -----------------------------------------------------

  create(name: string, type: 'enc' | 'plain', memberPubs: string[]): string | null {
    const title = cleanName(name)
    const contacts = [...new Set(memberPubs)].filter((pub) => this.core.isContact(pub) && !this.core.isBlocked(pub))
    if (!title || contacts.length === 0 || contacts.length + 1 > MAX_MEMBERS) return null
    const group: StoredGroup = {
      id: randomBytes(16).toString('hex'),
      name: title,
      type,
      members: [{ pub: this.core.me, name: this.core.state.profile.username }, ...contacts.map((pub) => ({ pub, name: this.core.nameOf(pub) }))],
      lamport: this.core.tick(),
      by: this.core.me,
      keyBlob: type === 'enc' ? this.core.protector.protect(generateContactKey()) : null,
      state: 'active',
      inviter: null,
      createdAt: Date.now()
    }
    this.groups.push(group)
    this.save()
    for (const pub of contacts) {
      this.core.net.dial(pub)
      this.invite(group, pub)
    }
    return group.id
  }

  private invite(group: StoredGroup, pub: string): void {
    const contact = this.core.state.contacts.find((c) => c.pub === pub)
    if (!contact) return
    let wrapped: string | null = null
    if (group.type === 'enc' && group.keyBlob) {
      const key = deriveChatKey(this.core.protector.unprotect(contact.keyBlob), 'group-invite', [this.core.identity.publicKey, fromIdentifier(pub)])
      wrapped = encryptText(key, this.core.protector.unprotect(group.keyBlob), `okfetch/ginvite/${group.id}`)
    }
    this.core.sendReliable(pub, { t: 'group_invite', rid: newId(), doc: this.toDoc(group), key: wrapped })
  }

  onInvite(peer: Peer, ctrl: Of<'group_invite'>): boolean {
    const contact = this.core.state.contacts.find((c) => c.pub === peer.pub)
    const doc = sanitizeDoc(ctrl.doc)
    if (!contact || !doc || !doc.members.some((m) => m.pub === this.core.me) || !doc.members.some((m) => m.pub === peer.pub)) return false
    if (this.find(doc.id)) return true
    let keyBlob: string | null = null
    if (doc.type === 'enc') {
      if (typeof ctrl.key !== 'string') return false
      const wrapKey = deriveChatKey(this.core.protector.unprotect(contact.keyBlob), 'group-invite', [this.core.identity.publicKey, fromIdentifier(peer.pub)])
      const key = decryptText(wrapKey, ctrl.key, `okfetch/ginvite/${doc.id}`)
      if (!isContactKey(key)) return false
      keyBlob = this.core.protector.protect(key)
    }
    this.core.tick(doc.lamport)
    this.groups.push({ ...doc, keyBlob, state: 'invited', inviter: peer.pub, createdAt: Date.now() })
    this.save()
    this.core.emit({ type: 'request', title: doc.name })
    return true
  }

  accept(id: string): boolean {
    const group = this.find(id)
    if (!group || group.state !== 'invited') return false
    group.state = 'active'
    this.save()
    for (const pub of this.others(group)) {
      this.core.net.dial(pub)
      this.core.sendReliable(pub, { t: 'group_join', rid: newId(), id })
    }
    return true
  }

  decline(id: string): void {
    const group = this.find(id)
    if (!group || group.state !== 'invited') return
    if (group.inviter) this.core.sendReliable(group.inviter, { t: 'group_leave', rid: newId(), id })
    this.drop(group)
  }

  onJoin(peer: Peer, ctrl: Of<'group_join'>): boolean {
    const group = this.find(String(ctrl.id))
    return Boolean(group?.members.some((m) => m.pub === peer.pub))
  }

  // --- changes ----------------------------------------------------------------------

  /** Rename and/or add contacts. Anyone in the group may do it. */
  update(id: string, changes: { name?: string; add?: string[] }): boolean {
    const group = this.find(id)
    if (!group || group.state !== 'active') return false
    const name = changes.name === undefined ? group.name : cleanName(changes.name)
    if (!name) return false
    const added = (changes.add ?? []).filter((pub, i, all) => all.indexOf(pub) === i && this.core.isContact(pub) && !group.members.some((m) => m.pub === pub))
    if (group.members.length + added.length > MAX_MEMBERS) return false
    group.name = name
    group.members = [...group.members, ...added.map((pub) => ({ pub, name: this.core.nameOf(pub) }))]
    group.lamport = this.core.tick(group.lamport)
    group.by = this.core.me
    this.save()
    for (const pub of added) {
      this.core.net.dial(pub)
      this.invite(group, pub)
    }
    this.broadcast(group, added)
    return true
  }

  private broadcast(group: StoredGroup, skip: string[] = []): void {
    for (const pub of this.others(group)) {
      if (!skip.includes(pub)) this.core.sendReliable(pub, { t: 'group_update', rid: newId(), doc: this.toDoc(group) })
    }
  }

  onUpdate(peer: Peer, ctrl: Of<'group_update'>): boolean {
    const doc = sanitizeDoc(ctrl.doc)
    const group = doc ? this.find(doc.id) : undefined
    if (!doc || !group || doc.type !== group.type || !group.members.some((m) => m.pub === peer.pub)) return false
    if (!isNewer(doc, group)) return true
    this.core.tick(doc.lamport)
    if (!doc.members.some((m) => m.pub === this.core.me)) {
      this.drop(group)
      return true
    }
    const removed = group.members.filter((m) => !doc.members.some((n) => n.pub === m.pub)).map((m) => m.pub)
    group.name = doc.name
    group.members = doc.members
    group.lamport = doc.lamport
    group.by = doc.by
    for (const pub of removed) this.forgetMember(group, pub)
    if (group.state === 'active') for (const pub of this.others(group)) this.core.net.dial(pub)
    this.save()
    return true
  }

  onLeave(peer: Peer, ctrl: Of<'group_leave'>): boolean {
    const group = this.find(String(ctrl.id))
    if (!group || !group.members.some((m) => m.pub === peer.pub)) return false
    group.members = group.members.filter((m) => m.pub !== peer.pub)
    group.lamport = this.core.tick(group.lamport)
    group.by = this.core.me
    this.forgetMember(group, peer.pub)
    this.save()
    this.broadcast(group)
    return true
  }

  /** Stop talking to a member who left: no queued frames, no pending delivery, no connection unless needed elsewhere. */
  private forgetMember(group: StoredGroup, pub: string): void {
    const chatId = groupChatId(group.id)
    this.core.dropOutbox((entry) => entry.peer === pub && ((entry.frame.t === 'msg' && entry.frame.chat === chatId) || (entry.frame.t === 'group_update' && entry.frame.doc.id === group.id)))
    const log = this.core.chatLog(chatId)
    for (const message of log.messages.values()) if (message.waiting.includes(pub)) log.update(message.id, { waiting: message.waiting.filter((p) => p !== pub) })
    this.core.chatChanged(chatId)
    this.core.releaseIfUnused(pub)
  }

  leave(id: string): boolean {
    const group = this.find(id)
    if (!group || group.state !== 'active') return false
    group.members = group.members.filter((m) => m.pub !== this.core.me)
    group.lamport = this.core.tick(group.lamport)
    group.by = this.core.me
    this.broadcast(group)
    this.drop(group)
    return true
  }

  private drop(group: StoredGroup): void {
    const chatId = groupChatId(group.id)
    this.core.state.groups = this.groups.filter((g) => g !== group)
    this.core.dropOutbox((entry) => (entry.frame.t === 'msg' && entry.frame.chat === chatId) || ('rid' in entry.frame && entry.frame.t === 'group_join' && entry.frame.id === group.id))
    this.core.deleteChat(chatId)
    for (const pub of this.others(group)) this.core.releaseIfUnused(pub)
    this.save()
    this.core.emit({ type: 'chat', chatId })
  }
}
