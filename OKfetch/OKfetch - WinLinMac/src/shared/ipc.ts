// Contract between the main process and the renderer.
import type { PasswordError } from './keys'
import type {
  AddContactResult, BlockedView, ContactView, GroupView, MessageView, NetStatus, OutgoingRequestView, ProfileView, RequestView, SendResult, TransferProgress
} from './model'

export interface Settings {
  theme: 'light' | 'dark' | 'opikula' | 'custom'
  custom_colors: Record<string, string>
  custom_flags: Record<string, boolean>
  language: 'cs' | 'en'
  font_size: number
  window_bounds: { x?: number; y?: number; width: number; height: number; maximized: boolean } | null
  /** Storage folder chosen by the user; null = default for the system. */
  storage_path: string | null
  notifications: boolean
  close_to_tray: boolean
  autostart: boolean
}

export type PlatformName = 'windows' | 'linux' | 'macos'

/** Events pushed from the core (and the main process) to the UI. */
export type CoreEvent =
  | { type: 'profile' }
  | { type: 'contacts' }
  | { type: 'requests' }
  | { type: 'groups' }
  | { type: 'blocked' }
  | { type: 'chat'; chatId: string }
  | { type: 'typing'; chatId: string; pub: string }
  | { type: 'net'; status: NetStatus }
  | { type: 'transfer'; progress: TransferProgress }
  | { type: 'incoming'; chatId: string; title: string; text: string }
  | { type: 'request'; title: string }

export type UiEvent = CoreEvent | { type: 'open-chat'; chatId: string } | { type: 'app'; status: AppStatus }

export type AppStatus =
  | { phase: 'starting' }
  | { phase: 'ready' }
  /** The storage folder cannot be written: the user has to choose another one. */
  | { phase: 'storage'; path: string; error: string }

export interface Requests {
  incoming: RequestView[]
  outgoing: OutgoingRequestView[]
  invites: GroupView[]
}

export interface SecurityInfo {
  /** 'dpapi' | 'keychain' | 'gnome_libsecret' | 'kwallet' | 'basic_text' | 'none' ... */
  backend: string
  /** False when keys are stored without real protection (Linux basic_text). */
  strong: boolean
  storagePath: string
}

export type SendFileResult = SendResult | { ok: false; reason: 'cancelled' }

export interface OkfetchApi {
  platform: PlatformName

  getStatus(): Promise<AppStatus>
  onEvent(listener: (event: UiEvent) => void): () => void

  // storage location
  pickFolder(): Promise<string | null>
  useStoragePath(path: string, move: boolean): Promise<{ ok: true } | { ok: false; error: string }>

  // profile
  getProfile(): Promise<ProfileView>
  setUsername(name: string): Promise<void>
  setAvatar(png: Uint8Array | null): Promise<boolean>
  setPassword(password: string | null): Promise<PasswordError | null>
  getNetStatus(): Promise<NetStatus>
  getSecurityInfo(): Promise<SecurityInfo>

  // contacts
  listContacts(): Promise<ContactView[]>
  listRequests(): Promise<Requests>
  listBlocked(): Promise<BlockedView[]>
  addContact(identifier: string, password: string, name?: string): Promise<AddContactResult>
  cancelRequest(pub: string): Promise<void>
  acceptRequest(pub: string, name?: string): Promise<boolean>
  rejectRequest(pub: string, feedback?: string): Promise<void>
  blockPeer(pub: string, name?: string): Promise<void>
  unblockPeer(pub: string): Promise<void>
  renameContact(pub: string, name: string): Promise<void>
  setContactIcon(pub: string, png: Uint8Array | null): Promise<boolean>
  verifyContact(pub: string, verified: boolean): Promise<void>
  getFingerprint(pub: string): Promise<string>
  removeContact(pub: string): Promise<void>

  // groups
  listGroups(): Promise<GroupView[]>
  createGroup(name: string, type: 'enc' | 'plain', members: string[]): Promise<string | null>
  updateGroup(id: string, changes: { name?: string; add?: string[] }): Promise<boolean>
  leaveGroup(id: string): Promise<boolean>
  acceptInvite(id: string): Promise<boolean>
  declineInvite(id: string): Promise<void>

  // chats
  getMessages(chatId: string): Promise<MessageView[]>
  sendMessage(chatId: string, html: string): Promise<SendResult>
  sendTyping(chatId: string): void
  markRead(chatId: string): Promise<void>
  deleteMessages(chatId: string, ids: string[], scope: 'me' | 'both'): Promise<{ deleted: number; skipped: number }>
  sendFile(chatId: string): Promise<SendFileResult>
  acceptFile(chatId: string, id: string): Promise<boolean>
  rejectFile(chatId: string, id: string, feedback?: string): Promise<boolean>
  cancelFile(chatId: string, id: string): Promise<boolean>
  openFile(chatId: string, id: string): Promise<void>
  showFile(chatId: string, id: string): Promise<void>
  openExternal(url: string): Promise<void>
  copyText(text: string): Promise<void>

  // settings
  getSettings(): Promise<Settings>
  updateSettings(patch: Partial<Settings>): Promise<Settings>

  windowMinimize(): void
  windowToggleMaximize(): void
  windowClose(): void
  onMaximized(listener: (maximized: boolean) => void): () => void
}

/** Methods the renderer calls with `invoke` (the rest of OkfetchApi is event wiring and window buttons). */
export const API_METHODS = [
  'getStatus', 'pickFolder', 'useStoragePath',
  'getProfile', 'setUsername', 'setAvatar', 'setPassword', 'getNetStatus', 'getSecurityInfo',
  'listContacts', 'listRequests', 'listBlocked', 'addContact', 'cancelRequest', 'acceptRequest', 'rejectRequest', 'blockPeer', 'unblockPeer',
  'renameContact', 'setContactIcon', 'verifyContact', 'getFingerprint', 'removeContact',
  'listGroups', 'createGroup', 'updateGroup', 'leaveGroup', 'acceptInvite', 'declineInvite',
  'getMessages', 'sendMessage', 'sendTyping', 'markRead', 'deleteMessages', 'sendFile', 'acceptFile', 'rejectFile', 'cancelFile', 'openFile', 'showFile',
  'openExternal', 'copyText', 'getSettings', 'updateSettings'
] as const

export type ApiMethod = (typeof API_METHODS)[number]

type NotInvoked = 'platform' | 'onEvent' | 'onMaximized' | 'windowMinimize' | 'windowToggleMaximize' | 'windowClose'
// Compile-time check: every invoked method of OkfetchApi is listed above.
const _complete: Exclude<keyof OkfetchApi, NotInvoked | ApiMethod> extends never ? true : never = true
void _complete

export type ApiHandlers = { [K in ApiMethod]: (...args: Parameters<OkfetchApi[K]>) => ReturnType<OkfetchApi[K]> | Awaited<ReturnType<OkfetchApi[K]>> }
