// View models shared by the main process and the renderer.

export type ChatKind = 'enc' | 'plain'
export type FileState = 'offered' | 'accepted' | 'transferring' | 'done' | 'rejected' | 'canceled' | 'failed'
export type MessageStatus = 'pending' | 'delivered' | 'read'

/** Chat ids: `<identifier>:enc`, `<identifier>:plain` for contacts, `g:<id>` for groups. */
export const contactChatId = (pub: string, kind: ChatKind): string => `${pub}:${kind}`
export const groupChatId = (id: string): string => `g:${id}`
export const isGroupChat = (chatId: string): boolean => chatId.startsWith('g:')

export function parseChatId(chatId: string): { type: 'contact'; pub: string; kind: ChatKind } | { type: 'group'; id: string } | null {
  if (chatId.startsWith('g:')) return /^g:[0-9a-f]{32}$/.test(chatId) ? { type: 'group', id: chatId.slice(2) } : null
  const match = /^([a-z0-9]{52}):(enc|plain)$/.exec(chatId)
  return match ? { type: 'contact', pub: match[1], kind: match[2] as ChatKind } : null
}

export interface ContactView {
  pub: string
  /** Name chosen by me. */
  name: string
  /** Name the contact chose for itself. */
  username: string
  online: boolean
  verified: boolean
  blocked: boolean
  /** `okfetch-file://` URL of the custom icon or the contact's avatar. */
  avatar: string | null
  unread: Record<ChatKind, number>
  lastActivity: number
}

export interface RequestView {
  pub: string
  username: string
  ts: number
}

export interface OutgoingRequestView {
  pub: string
  name: string
  ts: number
  state: 'waiting' | 'sent' | 'rejected'
  /** 'bad_password' | 'rate_limited' | 'no_password' | 'declined' */
  reason?: string
  retryMin?: number
  feedback?: string
}

export interface GroupMemberView {
  pub: string
  name: string
  online: boolean
  me: boolean
}

export interface GroupView {
  id: string
  name: string
  type: ChatKind
  members: GroupMemberView[]
  unread: number
  state: 'active' | 'invited'
  inviterName: string | null
  lastActivity: number
}

export interface FileView {
  name: string
  size: number
  mime: string
  hash: string
  state: FileState
  direction: 'in' | 'out'
  /** Bytes transferred so far. */
  done: number
  /** Path inside storage/files, used to build the `okfetch-file://` URL. */
  rel?: string
  feedback?: string
}

export interface MessageView {
  id: string
  chatId: string
  from: string
  fromName: string
  mine: boolean
  ts: number
  lamport: number
  html: string
  /** Outgoing messages only. */
  status: MessageStatus | null
  /** Incoming and not read by me yet. */
  unread: boolean
  file?: FileView
  /** Encrypted message that cannot be decrypted (wrong or missing key). */
  broken?: boolean
}

export interface BlockedView {
  pub: string
  name: string
  ts: number
}

export interface ProfileView {
  username: string
  identifier: string
  avatar: string | null
  passwordSet: boolean
}

export type NetStatus = 'connecting' | 'online' | 'offline'

export interface TransferProgress {
  chatId: string
  messageId: string
  done: number
  total: number
  state: FileState
}

/** Result codes of operations that can fail for a reason the UI explains. */
export type AddContactResult =
  | { ok: true }
  | { ok: false; reason: 'bad_identifier' | 'self' | 'exists' | 'bad_password' | 'blocked' | 'pending' }

export type SendResult = { ok: true; id: string } | { ok: false; reason: 'empty' | 'too_long_offline' | 'no_chat' | 'not_connected' | 'no_file' }

/** URL of a file inside the storage folder (`rel` uses forward slashes). Served by the main process. */
export const fileUrl = (rel: string): string => `okfetch-file://f/${rel.split('/').map(encodeURIComponent).join('/')}`

export function newId(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, '')
}

export const nowMs = (): number => Date.now()
