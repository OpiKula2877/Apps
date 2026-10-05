// Preview replacement of src/renderer/src/api.ts: the real UI with an in-memory library,
// so the windows can be looked at in a plain browser (no Electron, no Google account).
// The data changes go through the real applyOp(), like in the main process.
// ?empty starts without sources.
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import { defaultSettings, sanitizeSettings, sanitizeSource } from '../../src/core/settings'
import type { LibraryState, MediaItem, Message, OkgramApi, Screen, Settings, SourceConfig, SourceState, SyncState, Transfer, ViewerContext } from '../../src/shared/ipc'
import { applyOp, emptyData, type DataOp, type LibraryData } from '../../src/shared/model'
import { pickPrefs, sanitizePrefs } from '../../src/shared/prefs'
import { makeSamples } from './media'
import { blobs } from './urls'

type Channel = 'screen' | 'message' | 'library' | 'data' | 'status' | 'transfers' | 'settings' | 'viewer' | 'sources'
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

const SAMPLE_SOURCES: SourceConfig[] = [
  sanitizeSource({ id: 'pc', kind: 'local', name: 'Fotky v PC', path: 'C:\\Users\\Opi\\Pictures\\OKgram', icon: 'image', color: 'green' })!,
  sanitizeSource({ id: 'drive1', kind: 'drive', name: 'Disk – osobní', icon: 'globe', color: 'blue', account: { id: 'p1', email: 'samuelpelc464@gmail.com', name: 'Samuel' } })!,
  sanitizeSource({ id: 'drive2', kind: 'drive', name: 'Disk – rodina', icon: 'users', color: 'purple', account: { id: 'p2', email: 'pelcsamuel464@gmail.com', name: 'Samuel' } })!
]

let settings: Settings = { ...defaultSettings(), sources: params.has('empty') ? [] : SAMPLE_SOURCES, sync_minutes: 5 }
let media: MediaItem[] = samples.map((s) => s.item)
let data: LibraryData = emptyData(sanitizePrefs(settings))
data = applyOp(data, { type: 'meta', ids: ['pc:Sněžka.jpg', 'pc:Jezero.jpg'], patch: { star: true } })
data = applyOp(data, { type: 'meta', ids: ['pc:Chata večer.jpg'], patch: { color: 'orange' } })
data = applyOp(data, { type: 'album.create', id: 'hory', name: 'Hory', parent: null, icon: 'mountain', color: 'blue', items: ['pc:Krkonoše východ.jpg', 'pc:Sněžka.jpg', 'drive2:Výlet 2025/Skály.jpg'] })
data = applyOp(data, { type: 'album.create', id: 'more', name: 'Léto u moře', parent: null, icon: 'sun', color: 'yellow', items: ['drive1:Léto 2026/Moře 1.jpg', 'drive1:Léto 2026/Pláž.jpg', 'drive1:Výlet na kole.webm'] })
data = applyOp(data, { type: 'profile', username: 'OpiKula' })

const screen: Screen = { name: 'library', session: 1 }
let status: SyncState = 'saved'
let transfers: Transfer[] = []
let counter = 0

const sources = (): SourceState[] =>
  settings.sources.map((s) => ({
    ...s,
    status: s.id === 'drive2' && params.has('login') ? 'login' : 'ready',
    sync: 'saved',
    loading: false,
    count: media.filter((m) => m.source === s.id).length,
    message: s.id === 'drive2' && params.has('login') ? { key: 'source.login_expired', error: true } : null
  }))
const visible = (): MediaItem[] => media.filter((m) => settings.sources.some((s) => s.id === m.source))
const library = (): LibraryState => ({ media: visible(), loading: false })
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
const sourcesChanged = (): void => {
  emit('settings', settings)
  emit('sources', sources())
  emit('library', library())
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
    settings = sanitizeSettings({ ...settings, ...patch, sources: settings.sources })
    const prefs = pickPrefs(patch)
    if (Object.keys(prefs).length) mutate({ type: 'prefs', patch: prefs })
    emit('settings', settings)
    return settings
  },

  getSources: async () => sources(),
  onSources: listen('sources'),
  defaultFolder: async () => 'C:\\Users\\Opi\\Pictures\\OKgram',
  pickFolder: async () => 'C:\\Users\\Opi\\Pictures\\Dovolená',
  async addLocalSource(draft) {
    const config = sanitizeSource({ ...draft, id: `local${++counter}`, kind: 'local' })
    if (!config) return { ok: false, error: { key: 'source.no_folder', error: true } }
    settings = { ...settings, sources: [...settings.sources, config] }
    sourcesChanged()
    return { ok: true, id: config.id }
  },
  async addDriveSource(draft) {
    await new Promise((r) => setTimeout(r, 900))
    const id = `drive${++counter}`
    const config = sanitizeSource({ ...draft, id, kind: 'drive', name: draft.name || 'novy@gmail.com', account: { id, email: 'novy@gmail.com', name: 'Nový' } })!
    settings = { ...settings, sources: [...settings.sources, config] }
    sourcesChanged()
    return { ok: true, id }
  },
  async updateSource(id, patch) {
    settings = { ...settings, sources: settings.sources.map((s) => (s.id === id ? (sanitizeSource({ ...s, ...patch }) ?? s) : s)) }
    sourcesChanged()
    return { ok: true, id }
  },
  async reconnectSource(id) {
    return { ok: true, id }
  },
  async removeSource(id) {
    settings = { ...settings, sources: settings.sources.filter((s) => s.id !== id) }
    sourcesChanged()
    return 'done'
  },
  hasClientSecret: async () => true,
  chooseClientSecret: async () => 'ok',

  async refresh() {
    emit('library', { ...library(), loading: true })
    setTimeout(() => emit('library', library()), 600)
  },
  async mutate(op) {
    mutate(op)
  },
  async upload(source, _paths, albumId) {
    const copy = samples[counter % (samples.length - 1)]
    const name = `Nahráno ${++counter}.jpg`
    const id = `${source}:${name}`
    blobs.set(id, { url: copy.url, thumb: copy.thumb })
    fakeTransfer('upload', name, copy.item.size || 500_000, () => {
      media = [...media, { ...copy.item, id, source, name, created: Date.now() }]
      emit('library', library())
      emit('sources', sources())
      if (albumId) mutate({ type: 'album.add', id: albumId, items: [id] })
      message({ key: 'upload.done', params: { count: 1, name: settings.sources.find((s) => s.id === source)?.name ?? '' } })
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
    const nextId = id.includes('/') ? `${id.slice(0, id.lastIndexOf('/') + 1)}${name}` : `${item.source}:${name}`
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
    return 'https://drive.google.com/file/d/xyz/view'
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
    return settings.sources.map((s, i) => ({
      source: s.id,
      used: [312_000_000_000, 6_200_000_000, 11_900_000_000][i % 3],
      limit: [512_000_000_000, 15_000_000_000, 15_000_000_000][i % 3],
      library: media.filter((m) => m.source === s.id).reduce((sum, m) => sum + m.size, 0)
    }))
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
