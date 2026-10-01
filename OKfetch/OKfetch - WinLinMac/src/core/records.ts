// Records persisted by the core (as opposed to the view models in shared/model.ts).
import type { FileState } from '../shared/model'
import type { Ctrl } from './network/protocol'

export interface StoredFile {
  state: FileState
  direction: 'in' | 'out'
  /** Path inside storage/files (received files, avatars). */
  rel?: string
  /** Source path of an outgoing file. */
  source?: string
  feedback?: string
}

export interface StoredMessage {
  id: string
  chatId: string
  from: string
  ts: number
  lamport: number
  /** HTML (plain chats) or base64 ciphertext (encrypted chats). File messages hold their metadata as JSON here. */
  body: string
  enc: boolean
  kind: 'text' | 'file'
  /** Outgoing: recipients that have not confirmed delivery yet. */
  waiting: string[]
  /** Outgoing: the peer has read it. Incoming: I have read it. */
  read: boolean
  file?: StoredFile
}

export interface MessagePatch {
  waiting?: string[]
  read?: boolean
  file?: Partial<StoredFile>
}

export interface StoredContact {
  pub: string
  /** Name chosen by me. */
  name: string
  /** Name the contact chose for itself. */
  username: string
  /** Hash of a custom icon set by me (overrides the contact's avatar). */
  icon: string | null
  /** Hash of the contact's own avatar. */
  avatar: string | null
  verified: boolean
  addedAt: number
  /** The 16-character key, protected by the operating system. */
  keyBlob: string
}

export interface IncomingRequest {
  pub: string
  username: string
  ts: number
  keyBlob: string
}

export interface OutgoingRequest {
  pub: string
  name: string
  ts: number
  keyBlob: string
  /** Receive password of the other side, protected (K). Needed to answer the challenge. */
  kBlob: string
  /** waiting = not delivered yet, sent = the other side has it and decides, rejected = answered with no. */
  state: 'waiting' | 'sent' | 'rejected'
  reason?: string
  retryMin?: number
  feedback?: string
}

export interface StoredGroup {
  id: string
  name: string
  type: 'enc' | 'plain'
  members: { pub: string; name: string }[]
  lamport: number
  by: string
  /** Protected group key (encrypted groups). */
  keyBlob: string | null
  /** 'invited' until I accept. */
  state: 'active' | 'invited'
  inviter: string | null
  createdAt: number
}

export interface OutboxEntry {
  rid: string
  peer: string
  frame: Ctrl
  ts: number
}

export interface Profile {
  username: string
  /** Hash of my avatar (stored in files/_avatars). */
  avatar: string | null
  /** K derived from my receive password, protected. Null = nobody can send me a request. */
  kBlob: string | null
  lamport: number
}

export interface BlockedPeer {
  pub: string
  name: string
  ts: number
}
