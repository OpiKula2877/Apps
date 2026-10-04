// A fake core for the phone UI in a plain browser (Playwright tests, `vite --config vite.mobile.config.ts`).
// It answers the same API with sample data in memory; window.__okfetchFake lets tests push events.
import { defaultSettings, sanitizeSettings } from '../../../core/settings'
import type { ApiHandlers, Settings, UiEvent } from '../../../shared/ipc'
import type { ContactView, GroupView, MessageView, RequestView } from '../../../shared/model'
import { decodeLine, encodeLine } from '../../../mobile/rpc'
import { createMobileApi } from './mobileApi'
import { Okfetch, type LaunchItem } from './native'

const ME = 'ybndrfg8ejkmcpqxot1uwisza345h769ybndrfg8ejkmcpqxot1o'
const ALENA = 'kmcpqxot1uwisza345h769ybndrfg8ejkmcpqxot1uwisza345hy'
const BOB = 'uwisza345h769ybndrfg8ejkmcpqxot1uwisza345h769ybndrfo'
const CYRIL = 'xot1uwisza345h769ybndrfg8ejkmcpqxot1uwisza345h769ybo'

export interface FakeState {
  settings: Settings
  contacts: ContactView[]
  incoming: RequestView[]
  groups: GroupView[]
  messages: Record<string, MessageView[]>
  launch: LaunchItem[]
  scan: string | null
  calls: { method: string; args: unknown[] }[]
  emit(event: UiEvent): void
}

declare global {
  interface Window {
    __okfetchFake?: FakeState
  }
}

function message(chatId: string, from: string, html: string, minutesAgo: number, extra: Partial<MessageView> = {}): MessageView {
  const mine = from === ME
  return {
    id: Math.random().toString(16).slice(2).padEnd(32, '0'),
    chatId,
    from,
    fromName: mine ? 'Pepa' : from === ALENA ? 'Alena' : 'Bob',
    mine,
    ts: Date.now() - minutesAgo * 60_000,
    lamport: 100 - minutesAgo,
    html,
    status: mine ? 'read' : null,
    unread: false,
    ...extra
  }
}

export function installWebFake(): void {
  const contact = (pub: string, name: string, online: boolean, unread = 0): ContactView => ({
    pub, name, username: name, online, via: online ? (pub === ALENA ? 'direct' : 'relay') : null, verified: pub === ALENA, blocked: false, avatar: null, unread: { enc: unread, plain: 0 }, lastActivity: Date.now()
  })
  const listeners = new Set<(line: string) => void>()
  const state: FakeState = {
    settings: { ...defaultSettings() },
    contacts: [contact(ALENA, 'Alena', true, 2), contact(BOB, 'Bob', false)],
    incoming: [{ pub: CYRIL, username: 'Cyril', ts: Date.now() - 3_600_000 }],
    groups: [
      {
        id: 'a'.repeat(32), name: 'Parta', type: 'enc', unread: 0, state: 'active', inviterName: null, lastActivity: Date.now(),
        members: [{ pub: ME, name: 'Pepa', online: true, me: true }, { pub: ALENA, name: 'Alena', online: true, me: false }]
      }
    ],
    messages: {
      [`${ALENA}:enc`]: [
        message(`${ALENA}:enc`, ALENA, '<p>Ahoj! Posílám fotky z výletu.</p>', 30),
        message(`${ALENA}:enc`, ME, '<p>Díky, <strong>super</strong> 🙂</p>', 25),
        message(`${ALENA}:enc`, ALENA, '<p>Zítra v 8 na nádraží?</p>', 2, { unread: true }),
        message(`${ALENA}:enc`, ALENA, '<p>Dej vědět.</p>', 1, { unread: true })
      ],
      [`${BOB}:plain`]: [message(`${BOB}:plain`, ME, '<p>Čekám, až budeš online.</p>', 60, { status: 'pending' })],
      // A long chat: the message list must scroll while the composer stays on the screen.
      [`${BOB}:enc`]: Array.from({ length: 60 }, (_, i) => message(`${BOB}:enc`, i % 2 ? ME : BOB, `<p>Zpráva číslo ${i + 1}</p>`, 600 - i * 5))
    },
    launch: [],
    scan: null,
    calls: [],
    emit(event) {
      const line = encodeLine({ t: 'event', event })
      for (const listener of listeners) listener(line)
    }
  }

  const chatChanged = (chatId: string): void => {
    state.emit({ type: 'chat', chatId })
    state.emit({ type: chatId.startsWith('g:') ? 'groups' : 'contacts' })
  }

  const handlers: Partial<Record<keyof ApiHandlers, (...args: any[]) => unknown>> = {
    getStatus: () => ({ phase: 'ready' }),
    getSettings: () => state.settings,
    updateSettings(patch: Partial<Settings>) {
      state.settings = sanitizeSettings({ ...state.settings, ...patch })
      state.emit({ type: 'settings', settings: state.settings })
      return state.settings
    },
    getProfile: () => ({ username: 'Pepa', identifier: ME, avatar: null, passwordSet: true }),
    setUsername: () => undefined,
    setAvatar: () => true,
    setPassword: () => null,
    getNetStatus: () => 'online',
    getNetDiagnostics: () => ({ status: 'online', host: '203.0.113.7', port: 0, firewalled: true, randomized: true, localAddresses: ['192.168.1.23'], connections: 1, relay: { relays: 3, connected: 3, links: 0 } }),
    probePeer: (pub: string) => (pub === ALENA ? { ok: true, code: 'CONNECTED', ms: 0 } : { ok: false, code: 'HOLEPUNCH_DOUBLE_RANDOMIZED_NATS', ms: 4200 }),
    getSecurityInfo: () => ({ backend: 'android_keystore', strong: true, storagePath: '/data/user/0/cz.opikula.okfetch/files/okfetch' }),
    listContacts: () => state.contacts,
    listRequests: () => ({ incoming: state.incoming, outgoing: [], invites: [] }),
    listBlocked: () => [],
    addContact: () => ({ ok: true }),
    cancelRequest: () => undefined,
    acceptRequest(pub: string) {
      const request = state.incoming.find((r) => r.pub === pub)
      state.incoming = state.incoming.filter((r) => r.pub !== pub)
      if (request) state.contacts = [...state.contacts, contact(pub, request.username, true)]
      state.emit({ type: 'requests' })
      state.emit({ type: 'contacts' })
      return true
    },
    rejectRequest(pub: string) {
      state.incoming = state.incoming.filter((r) => r.pub !== pub)
      state.emit({ type: 'requests' })
    },
    blockPeer: () => undefined,
    unblockPeer: () => undefined,
    renameContact(pub: string, name: string) {
      state.contacts = state.contacts.map((c) => (c.pub === pub ? { ...c, name } : c))
      state.emit({ type: 'contacts' })
    },
    setContactIcon: () => true,
    verifyContact: () => undefined,
    getFingerprint: () => '12345 67890 13579 24680 11223 44556',
    removeContact: () => undefined,
    listGroups: () => state.groups,
    createGroup: () => 'b'.repeat(32),
    updateGroup: () => true,
    leaveGroup: () => true,
    acceptInvite: () => true,
    declineInvite: () => undefined,
    getMessages: (chatId: string) => state.messages[chatId] ?? [],
    sendMessage(chatId: string, html: string) {
      const sent = message(chatId, ME, html, 0, { status: 'delivered' })
      state.messages[chatId] = [...(state.messages[chatId] ?? []), sent]
      chatChanged(chatId)
      return { ok: true, id: sent.id }
    },
    sendTyping: () => undefined,
    markRead(chatId: string) {
      state.messages[chatId] = (state.messages[chatId] ?? []).map((m) => ({ ...m, unread: false }))
      state.contacts = state.contacts.map((c) => (chatId.startsWith(c.pub) ? { ...c, unread: { enc: 0, plain: 0 } } : c))
      chatChanged(chatId)
    },
    deleteMessages(chatId: string, ids: string[]) {
      const before = state.messages[chatId]?.length ?? 0
      state.messages[chatId] = (state.messages[chatId] ?? []).filter((m) => !ids.includes(m.id))
      chatChanged(chatId)
      return { deleted: before - state.messages[chatId].length, skipped: 0 }
    },
    sendFile: () => ({ ok: false, reason: 'cancelled' }),
    sendPrepared: () => ({ ok: true, id: 'f'.repeat(32) }),
    acceptFile: () => true,
    rejectFile: () => true,
    cancelFile: () => true,
    openFile: () => undefined,
    showFile: () => undefined,
    saveFile: () => true,
    shareFile: () => undefined,
    openExternal: () => undefined,
    copyText: () => undefined,
    createBackup: () => ({ ok: true }),
    restoreBackup: () => ({ ok: false, error: 'cancelled' }),
    resetData: () => undefined,
    pickFolder: () => null,
    useStoragePath: () => ({ ok: false, error: 'unsupported' })
  }

  window.__okfetchFake = state
  // Tests: behave as if Java queued something for the app (share, notification, okfetch: link).
  Object.assign(window, { __okfetchFireLaunch: () => (Okfetch as unknown as { fireLaunch(): Promise<void> }).fireLaunch() })
  window.okfetch = createMobileApi({
    send(line) {
      const call = decodeLine(line)
      if (call?.t !== 'call') return
      state.calls.push({ method: call.method, args: call.args })
      const handler = handlers[call.method as keyof ApiHandlers]
      setTimeout(() => {
        let reply: string
        try {
          const result = handler ? handler(...call.args) : null
          reply = encodeLine({ t: 'reply', id: call.id, ok: true, result: result === undefined ? null : result })
        } catch (error) {
          reply = encodeLine({ t: 'reply', id: call.id, ok: false, error: String(error) })
        }
        for (const listener of listeners) listener(reply)
      }, 5)
    },
    onLine: (listener) => listeners.add(listener)
  })
}
