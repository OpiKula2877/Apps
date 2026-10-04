// The API of the app as one table of handlers. Electron's main process and the phone's Bare worklet both use it.
import { extname } from 'node:path'
import type { ApiHandlers, AppStatus, BackupResult, SendFileResult, Settings } from '../shared/ipc'
import type { Core } from './controller'
import type { KeyProtector } from './state'

export interface ApiHost {
  core(): Core
  status(): AppStatus
  protector(): KeyProtector
  settings(): Settings
  updateSettings(patch: Partial<Settings>): Settings
  pickFolder(): Promise<string | null>
  pickFile(source?: 'file' | 'camera'): Promise<string | null>
  useStoragePath(path: string, move: boolean): Promise<{ ok: true } | { ok: false; error: string }>
  openPath(path: string): Promise<void>
  showItem(path: string): void
  openExternal(url: string): Promise<void>
  copyText(text: string): void
  // Android only; the desktop leaves them out.
  /** A file the host copied into the app (shared from another app) and that may be sent. */
  isPrepared?(path: string): boolean
  saveFile?(path: string): Promise<boolean>
  shareFile?(path: string): Promise<void>
  createBackup?(password: string, withFiles: boolean): Promise<BackupResult>
  restoreBackup?(password: string): Promise<BackupResult>
  resetData?(): Promise<void>
}

const UNSUPPORTED: BackupResult = { ok: false, error: 'unsupported' }

// Received files that are safe to open with the system viewer; everything else is only shown in its folder.
const OPENABLE = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.txt', '.pdf', '.mp3', '.mp4'])
const SAFE_URL = /^(https?:\/\/|mailto:)/i

export function createHandlers(host: ApiHost): ApiHandlers {
  return {
    getStatus: () => host.status(),
    pickFolder: () => host.pickFolder(),
    useStoragePath: (path, move) => host.useStoragePath(String(path), Boolean(move)),

    getProfile: () => host.core().contacts.profile(),
    setUsername: (name) => host.core().contacts.setUsername(String(name)),
    setAvatar: (png) => host.core().contacts.setAvatar(png instanceof Uint8Array ? png : null),
    setPassword: (password) => host.core().contacts.setPassword(password === null ? null : String(password)),
    getNetStatus: () => host.core().net.status,
    getNetDiagnostics: () => host.core().net.diagnostics(),
    probePeer: (pub) => host.core().net.probe(String(pub)),
    getSecurityInfo: () => ({ backend: host.protector().backend, strong: host.protector().strong, storagePath: host.core().state.root }),

    listContacts: () => host.core().contacts.list(),
    listRequests: () => {
      const core = host.core()
      return { incoming: core.contacts.incoming(), outgoing: core.contacts.outgoing(), invites: core.groups.list().filter((g) => g.state === 'invited') }
    },
    listBlocked: () => host.core().contacts.blockedList(),
    addContact: (identifier, password, name) => host.core().contacts.add(String(identifier), String(password), name === undefined ? undefined : String(name)),
    cancelRequest: (pub) => host.core().contacts.cancelOutgoing(String(pub)),
    acceptRequest: (pub, name) => host.core().contacts.accept(String(pub), name === undefined ? undefined : String(name)),
    rejectRequest: (pub, feedback) => host.core().contacts.reject(String(pub), feedback === undefined ? '' : String(feedback)),
    blockPeer: (pub, name) => host.core().contacts.block(String(pub), name === undefined ? '' : String(name)),
    unblockPeer: (pub) => host.core().contacts.unblock(String(pub)),
    renameContact: (pub, name) => host.core().contacts.rename(String(pub), String(name)),
    setContactIcon: (pub, png) => host.core().contacts.setIcon(String(pub), png instanceof Uint8Array ? png : null),
    verifyContact: (pub, verified) => host.core().contacts.setVerified(String(pub), Boolean(verified)),
    getFingerprint: (pub) => host.core().contacts.fingerprint(String(pub)),
    removeContact: (pub) => host.core().contacts.remove(String(pub)),

    listGroups: () => host.core().groups.list(),
    createGroup: (name, type, members) => host.core().groups.create(String(name), type === 'plain' ? 'plain' : 'enc', Array.isArray(members) ? members.map(String) : []),
    updateGroup: (id, changes) => host.core().groups.update(String(id), { name: changes?.name === undefined ? undefined : String(changes.name), add: Array.isArray(changes?.add) ? changes.add.map(String) : undefined }),
    leaveGroup: (id) => host.core().groups.leave(String(id)),
    acceptInvite: (id) => host.core().groups.accept(String(id)),
    declineInvite: (id) => host.core().groups.decline(String(id)),

    getMessages: (chatId) => host.core().messages.list(String(chatId)),
    sendMessage: (chatId, html) => host.core().messages.send(String(chatId), String(html)),
    sendTyping: (chatId) => host.core().messages.typing(String(chatId)),
    markRead: (chatId) => host.core().messages.markRead(String(chatId)),
    deleteMessages: (chatId, ids, scope) =>
      host.core().messages.deleteMessages(String(chatId), Array.isArray(ids) ? ids.map(String) : [], scope === 'both' ? 'both' : 'me'),
    sendFile: async (chatId, source): Promise<SendFileResult> => {
      const path = await host.pickFile(source === 'camera' ? 'camera' : 'file')
      return path ? host.core().transfers.sendFile(String(chatId), path) : { ok: false, reason: 'cancelled' }
    },
    sendPrepared: async (chatId, path): Promise<SendFileResult> =>
      host.isPrepared?.(String(path)) ? host.core().transfers.sendFile(String(chatId), String(path)) : { ok: false, reason: 'no_file' },
    acceptFile: (chatId, id) => host.core().transfers.accept(String(chatId), String(id)),
    rejectFile: (chatId, id, feedback) => host.core().transfers.reject(String(chatId), String(id), feedback === undefined ? '' : String(feedback)),
    cancelFile: (chatId, id) => host.core().transfers.cancel(String(chatId), String(id)),
    openFile: async (chatId, id) => {
      const path = host.core().transfers.filePath(String(chatId), String(id))
      if (!path) return
      if (OPENABLE.has(extname(path).toLowerCase())) await host.openPath(path)
      else host.showItem(path)
    },
    showFile: async (chatId, id) => {
      const path = host.core().transfers.filePath(String(chatId), String(id))
      if (path) host.showItem(path)
    },
    saveFile: async (chatId, id) => {
      const path = host.core().transfers.filePath(String(chatId), String(id))
      return path && host.saveFile ? host.saveFile(path) : false
    },
    shareFile: async (chatId, id) => {
      const path = host.core().transfers.filePath(String(chatId), String(id))
      if (path && host.shareFile) await host.shareFile(path)
    },
    openExternal: async (url) => {
      if (SAFE_URL.test(String(url))) await host.openExternal(String(url))
    },
    copyText: (text) => host.copyText(String(text)),

    getSettings: () => host.settings(),
    updateSettings: (patch) => host.updateSettings(patch),

    createBackup: (password, withFiles) => (host.createBackup ? host.createBackup(String(password), Boolean(withFiles)) : UNSUPPORTED),
    restoreBackup: (password) => (host.restoreBackup ? host.restoreBackup(String(password)) : UNSUPPORTED),
    resetData: async () => {
      await host.resetData?.()
    }
  }
}

