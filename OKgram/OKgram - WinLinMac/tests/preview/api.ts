// Preview replacement of src/renderer/src/api.ts: the real UI with an in-memory library,
// so the windows can be looked at in a plain browser (no Electron, no Google account).
// The data changes go through the real applyOp(), like in the main process.
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import { defaultSettings, sanitizeSettings } from '../../src/core/settings'
import type { LibraryState, MediaItem, Message, OkgramApi, Screen, Settings, SyncState, Transfer, ViewerContext } from '../../src/shared/ipc'
import { applyOp, emptyData, type DataOp, type LibraryData } from '../../src/shared/model'
import { pickPrefs, sanitizePrefs } from '../../src/shared/prefs'
import { makeSamples } from './media'
import { blobs } from './urls'

type Channel = 'screen' | 'message' | 'library' | 'data' | 'status' | 'transfers' | 'settings' | 'viewer'
const listeners = new Map<Channel, Set<(payload: never) => void>>()
const emit = (channel: Channel, payload: unknown): void => listeners.get(channel)?.forEach((fn) => (fn as (p: unknown) => void)(payload))
const listen =
  <T>(channel: Channel) =>
  (fn: (payload: T) => void): (() => void) => {
    if (!listeners.has(channel)) listeners.set(channel, new Set())
    listeners.get(channel)!.add(fn as (payload: never) => void)
    return () => listeners.get(channel)!.delete(fn as (payload: never) => void)
  }

const params = new URLSearchParams(location.search)
const isViewer = params.has('viewer')
const samples = await makeSamples()
for (const s of samples) blobs.set(s.item.id, { url: s.url, thumb: s.thumb })

let settings: Settings = { ...defaultSettings(), storage: 'local', local_folder: 'C:\\Users\\Opi\\Pictures\\OKgram', sync_minutes: 5 }
let media: MediaItem[] = samples.map((s) => s.item)
let data: LibraryData = emptyData(sanitizePrefs(settings))
data = applyOp(data, { type: 'meta', ids: ['Sněžka.jpg', 'Jezero.jpg'], patch: { star: true } })
data = applyOp(data, { type: 'meta', ids: ['Chata večer.jpg'], patch: { color: 'orange' } })
data = applyOp(data, { type: 'meta', ids: ['Les u potoka.jpg'], patch: { color: 'green' } })
data = applyOp(data, { type: 'album.create', id: 'hory', name: 'Hory', parent: null, icon: 'mountain', color: 'blue', items: ['Krkonoše východ.jpg', 'Sněžka.jpg', 'Kopce.png', 'Údolí.jpg'] })
data = applyOp(data, { type: 'album.create', id: 'krk', name: 'Krkonoše 2026', parent: 'hory', icon: 'flag', items: ['Krkonoše východ.jpg', 'Sněžka.jpg'] })
data = applyOp(data, { type: 'album.create', id: 'rod', name: 'Rodina', parent: null, icon: 'heart', color: 'red', items: ['Babička 80.jpg', 'Chata večer.jpg'] })
data = applyOp(data, { type: 'album.create', id: 'more', name: 'Léto u moře', parent: null, icon: 'sun', color: 'yellow', items: ['Léto 2026/Moře 1.jpg', 'Léto 2026/Moře 2.jpg', 'Léto 2026/Pláž.jpg', 'Výlet na kole.webm'] })
data = applyOp(data, { type: 'profile', username: 'OpiKula' })

let screen: Screen = params.has('welcome')
  ? { name: 'welcome', mode: null, needSecret: true, busy: false, connectError: false, message: null, defaultFolder: 'C:\\Users\\Opi\\Pictures\\OKgram' }
  : { name: 'library', mode: params.has('drive') ? 'drive' : 'local', account: params.has('drive') ? { email: 'opikula@gmail.com', name: 'Opi Kula' } : { email: settings.local_folder!, name: 'OKgram' }, session: 1 }
let status: SyncState = 'saved'
let transfers: Transfer[] = []
let counter = 0

const library = (): LibraryState => ({ media, online: true, loading: false })
const setScreen = (next: Screen): void => {
  screen = next
  emit('screen', screen)
}
const message = (m: Message): void => emit('message', m)
const save = (): void => {
  status = 'saving'
  emit('status', status)
  setTimeout(() => emit('status', (status = 'saved')), 700)
}
const mutate = (op: DataOp): void => {
  data = applyOp(data, op)
  if (op.type === 'prefs') emit('settings', (settings = { ...settings, ...data.prefs }))
  emit('data', data)
  save()
}

function fakeTransfer(kind: Transfer['kind'], name: string, total: number, then?: () => void): void {
  const id = `t${++counter}`
  transfers = [...transfers, { id, kind, name, total, done: 0, state: 'active' }]
  emit('transfers', transfers)
  let done = 0
  const timer = setInterval(() => {
    done = Math.min(total, done + total / 8)
    transfers = transfers.map((t) => (t.id === id ? { ...t, done, state: done >= total ? 'done' : 'active' } : t))
    emit('transfers', transfers)
    if (done >= total) {
      clearInterval(timer)
      then?.()
    }
  }, 250)
}

const viewerContext = (): ViewerContext => {
  try {
    return JSON.parse(localStorage.getItem('okgram-viewer') ?? '')
  } catch {
    return { ids: media.map((m) => m.id), index: 0, slideshow: false, serial: 1 }
  }
}

export const api: OkgramApi = {
  platform: 'windows',
  isViewer,
  getScreen: async () => screen,
  onScreen: listen('screen'),
  onMessage: listen('message'),
  getLibrary: async () => library(),
  onLibrary: listen('library'),
  getData: async () => data,
  onData: listen('data'),
  getStatus: async () => status,
  onStatus: listen('status'),
  getTransfers: async () => transfers,
  onTransfers: listen('transfers'),
  getSettings: async () => settings,
  onSettings: listen('settings'),
  async updateSettings(patch) {
    settings = sanitizeSettings({ ...settings, ...patch })
    const prefs = pickPrefs(patch)
    if (Object.keys(prefs).length) {
      data = applyOp(data, { type: 'prefs', patch: prefs })
      emit('data', data)
      save()
    }
    emit('settings', settings)
    return settings
  },

  async chooseMode(mode) {
    setScreen({ name: 'welcome', mode, needSecret: mode === 'drive', busy: false, connectError: false, message: null, defaultFolder: 'C:\\Users\\Opi\\Pictures\\OKgram' })
  },
  async chooseClientSecret() {
    if (screen.name === 'welcome') setScreen({ ...screen, needSecret: false, message: { key: 'login.secret_ok' } })
  },
  async login() {
    setScreen({ name: 'library', mode: 'drive', account: { email: 'opikula@gmail.com', name: 'Opi Kula' }, session: 2 })
  },
  async retry() {},
  async openLocal() {
    setScreen({ name: 'library', mode: 'local', account: { email: settings.local_folder!, name: 'OKgram' }, session: 3 })
  },
  async leave() {
    setScreen({ name: 'welcome', mode: null, needSecret: true, busy: false, connectError: false, message: { key: 'login.closed' }, defaultFolder: 'C:\\Users\\Opi\\Pictures\\OKgram' })
    return 'done'
  },

  async refresh() {
    emit('library', { ...library(), loading: true })
    setTimeout(() => emit('library', library()), 600)
  },
  async mutate(op) {
    mutate(op)
  },
  async upload(_paths, albumId) {
    const copy = samples[counter % (samples.length - 1)]
    const id = `Nahráno ${++counter}.jpg`
    blobs.set(id, { url: copy.url, thumb: copy.thumb })
    fakeTransfer('upload', id, copy.item.size || 500_000, () => {
      media = [...media, { ...copy.item, id, name: id, created: Date.now() }]
      emit('library', library())
      if (albumId) mutate({ type: 'album.add', id: albumId, items: [id] })
      message({ key: 'upload.done', params: { count: 1 } })
    })
  },
  pathForFile: (file) => file.name,
  async download(ids) {
    for (const id of ids) fakeTransfer('download', id.split('/').pop()!, media.find((m) => m.id === id)?.size ?? 1)
  },
  async downloadZip(ids, name) {
    fakeTransfer('zip', `${name}.zip`, ids.reduce((sum, id) => sum + (media.find((m) => m.id === id)?.size ?? 0), 0), () => message({ key: 'zip.done', params: { path: `C:\\Users\\Opi\\Downloads\\${name}.zip` } }))
  },
  async cancelTransfer(id) {
    transfers = transfers.map((t) => (t.id === id ? { ...t, state: 'cancelled' } : t))
    emit('transfers', transfers)
  },
  async clearTransfers() {
    transfers = transfers.filter((t) => t.state === 'active' || t.state === 'queued')
    emit('transfers', transfers)
  },
  async rename(id, stem) {
    const item = media.find((m) => m.id === id)
    if (!item) return 'failed'
    const name = `${stem}.${item.ext}`
    const nextId = id.includes('/') ? `${id.slice(0, id.lastIndexOf('/') + 1)}${name}` : name
    if (media.some((m) => m.id === nextId && m.id !== id)) return 'exists'
    blobs.set(nextId, blobs.get(id)!)
    media = media.map((m) => (m.id === id ? { ...m, id: nextId, name } : m))
    emit('library', library())
    mutate({ type: 'rekey', from: id, to: nextId })
    return 'ok'
  },
  async trash(ids) {
    media = media.filter((m) => !ids.includes(m.id))
    emit('library', library())
    mutate({ type: 'forget', ids })
    return ids.length
  },
  async share(id) {
    media = media.map((m) => (m.id === id ? { ...m, shared: true } : m))
    emit('library', library())
    return screen.name === 'library' && screen.mode === 'drive' ? 'https://drive.google.com/file/d/xyz/view' : `C:\\Users\\Opi\\Pictures\\OKgram\\${id}`
  },
  async unshare(id) {
    media = media.map((m) => (m.id === id ? { ...m, shared: false } : m))
    emit('library', library())
    return true
  },
  async copyText() {},
  async openInSystem() {
    return true
  },
  async storeThumbnail() {},
  async quota() {
    return { used: 6_200_000_000, limit: 15_000_000_000, library: media.reduce((sum, m) => sum + m.size, 0) }
  },
  cacheSize: async () => 12_400_000,
  async clearCache() {
    message({ key: 'settings.cache_cleared' })
  },
  exportSettings: async () => true,
  importSettings: async () => 'cancel',
  pickDownloadFolder: async () => null,
  async openLogs() {},
  log: (text) => console.warn('[app log]', text),

  async openViewer(ids, index, slideshow = false) {
    localStorage.setItem('okgram-viewer', JSON.stringify({ ids, index, slideshow, serial: Date.now() }))
    window.open(`${location.pathname}?viewer`, 'okgram-viewer', 'width=1000,height=720')
  },
  getViewerContext: async () => viewerContext(),
  onViewerContext: listen('viewer'),

  windowMinimize() {},
  windowToggleMaximize() {},
  windowClose: () => window.close(),
  setFullScreen(on) {
    if (on) void document.documentElement.requestFullscreen().catch(() => undefined)
    else if (document.fullscreenElement) void document.exitFullscreen()
  },
  onMaximized: () => () => undefined,
  onFullScreen(fn) {
    const handler = (): void => fn(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }
}

export const MOD = 'Ctrl+'
export const modKey = (event: KeyboardEvent | MouseEvent | ReactMouseEvent | ReactKeyboardEvent): boolean => event.ctrlKey
