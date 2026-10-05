// Application state in the main process: storage choice, sign-in, the open library (media list
// and data file), saving with offline retry, background refresh, uploads, downloads and settings.
// Both windows (library and viewer) show what this controller broadcasts.
import { createWriteStream, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { open as openFile, readdir, rm, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { once } from 'node:events'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Zip, ZipPassThrough } from 'fflate'
import type {
  ImportResult,
  LibraryState,
  MediaItem,
  Message,
  Prefs,
  Quota,
  RenameResult,
  Screen,
  Settings,
  StorageMode,
  SyncState,
  VideoInfo
} from '../shared/ipc'
import { kindOf, mimeOf, validFileName } from '../shared/formats'
import { uniqueName } from '../shared/library'
import { applyOp, emptyData, mergeData, sanitizeData, serializeData, type DataOp, type LibraryData } from '../shared/model'
import { PREF_KEYS, isRecord, pickPrefs, sanitizePrefs } from '../shared/prefs'
import { resolveFlags } from '../shared/theme'
import { AuthError, BackendError, OfflineError, type Account, type MediaBackend, type UploadSource } from '../core/backend'
import type { TokenProvider } from '../core/driveRest'
import { errorText, isAbort } from '../core/errors'
import { sanitizeSettings } from '../core/settings'
import { LibraryCache, type VideoInfoMap } from './cache'
import type { Hooks } from './hooks'
import { ThumbService, type Thumb } from './thumbs'
import { Transfers, type TransferHandle } from './transfers'

const SAVE_DELAY_MS = 1000
const RETRY_MS = 60_000
const WATCH_DELAY_MS = 1500
const MAX_DROP_FILES = 5000

class NoDataError extends Error {
  name = 'NoDataError'
}

const encode = (text: string): Uint8Array => new TextEncoder().encode(text)
const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)

function prefsOf(settings: Settings): Prefs {
  return sanitizePrefs(settings)
}

function samePrefs(a: Prefs, b: Prefs): boolean {
  return PREF_KEYS.every((key) => JSON.stringify(a[key]) === JSON.stringify(b[key]))
}

function fileSource(path: string, name: string, size: number, modified: number): UploadSource {
  return {
    path,
    name,
    size,
    mime: mimeOf(name),
    modified,
    async read(start, end) {
      const handle = await openFile(path, 'r')
      try {
        const buffer = Buffer.alloc(end - start)
        const { bytesRead } = await handle.read(buffer, 0, end - start, start)
        return new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead)
      } finally {
        await handle.close()
      }
    }
  }
}

/** Supported files among the given paths; folders are searched (dropped folders). */
async function collectFiles(paths: string[]): Promise<{ path: string; name: string; size: number; modified: number }[]> {
  const found: { path: string; name: string; size: number; modified: number }[] = []
  const visit = async (path: string, depth: number): Promise<void> => {
    if (found.length >= MAX_DROP_FILES) return
    let info
    try {
      info = await stat(path)
    } catch {
      return
    }
    if (info.isDirectory()) {
      if (depth > 6) return
      for (const name of (await readdir(path).catch(() => [] as string[])).sort()) if (!name.startsWith('.')) await visit(join(path, name), depth + 1)
    } else if (info.isFile() && kindOf(basename(path))) {
      found.push({ path, name: basename(path), size: info.size, modified: Math.round(info.mtimeMs) })
    }
  }
  for (const path of paths) await visit(path, 0)
  return found
}

function counter(handle: TransferHandle, start = 0): Transform {
  let done = start
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      done += chunk.length
      handle.progress(done)
      callback(null, chunk)
    }
  })
}

export class Controller {
  settings: Settings
  readonly transfers: Transfers
  private screen: Screen = { name: 'loading' }
  private mode: StorageMode | null = null
  private tokens: TokenProvider | null = null
  private backend: MediaBackend | null = null
  private cache: LibraryCache | null = null
  private thumbs: ThumbService | null = null
  private media: MediaItem[] = []
  private online = false
  private loading = false
  private data: LibraryData = emptyData()
  private base: string | null = null
  private dirty = false
  private pending = false
  private status: SyncState = 'saved'
  private videoInfo: VideoInfoMap = {}
  private session = 0
  private queue: Promise<unknown> = Promise.resolve()
  private work: Promise<unknown> = Promise.resolve()
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private retryTimer: ReturnType<typeof setInterval> | null = null
  private syncTimer: ReturnType<typeof setInterval> | null = null
  private watchTimer: ReturnType<typeof setTimeout> | null = null
  private mediaTimer: ReturnType<typeof setTimeout> | null = null
  private stopWatch: (() => void) | null = null

  constructor(private readonly hooks: Hooks) {
    this.settings = sanitizeSettings(hooks.loadSettings())
    this.transfers = new Transfers((list) => hooks.ui.transfers(list))
  }

  // --- state for the windows ---------------------------------------------
  getScreen(): Screen {
    return this.screen
  }

  getLibrary(): LibraryState {
    return { media: this.withVideoInfo(this.media), online: this.online, loading: this.loading }
  }

  getData(): LibraryData {
    return this.data
  }

  getStatus(): SyncState {
    return this.status
  }

  getSettings(): Settings {
    return this.settings
  }

  item(id: string): MediaItem | undefined {
    return this.media.find((m) => m.id === id)
  }

  private setScreen(screen: Screen): void {
    this.screen = screen
    this.hooks.ui.screen(screen)
  }

  private message(key: string, params?: Message['params'], error = false): void {
    this.hooks.ui.message({ key, params, error })
  }

  private setStatus(status: SyncState): void {
    this.status = status
    this.hooks.ui.status(status)
  }

  private setOnline(online: boolean): void {
    if (this.online === online) return
    this.online = online
    if (online) this.thumbs?.resetFailures()
    this.hooks.ui.library(this.getLibrary())
  }

  private withVideoInfo(items: MediaItem[]): MediaItem[] {
    return items.map((item) => {
      const info = item.kind === 'video' ? this.videoInfo[item.id] : undefined
      if (!info || info.version !== item.version) return item
      return { ...item, width: item.width ?? info.width, height: item.height ?? info.height, duration: item.duration ?? info.duration }
    })
  }

  /** The media list changed: tell the windows and keep the offline copy (batched). */
  private mediaChanged(): void {
    if (this.mediaTimer) clearTimeout(this.mediaTimer)
    this.mediaTimer = setTimeout(() => {
      this.mediaTimer = null
      this.hooks.ui.library(this.getLibrary())
      try {
        this.cache?.writeList(this.media)
        this.cache?.writeVideoInfo(this.videoInfo)
      } catch (error) {
        this.hooks.log(`[cache] ${errorText(error)}`)
      }
    }, 120)
  }

  private saveSettingsFile(): void {
    try {
      this.hooks.saveSettings(this.settings)
    } catch (error) {
      this.hooks.log(`[settings] ${errorText(error)}`)
    }
  }

  /** Run storage work strictly one after another. */
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work)
    this.queue = run.catch(() => undefined)
    return run
  }

  /** Uploads, downloads and ZIP exports run one after another, apart from the data queue. */
  private background(work: () => Promise<void>): void {
    this.work = this.work.then(work, work).catch((error) => this.hooks.log(`[transfer] ${errorText(error)}`))
  }

  idle(): Promise<unknown> {
    return this.queue
  }

  // --- start, storage choice & sign-in ------------------------------------
  async start(): Promise<void> {
    const { storage, local_folder } = this.settings
    if (storage === 'local' && local_folder) return this.openLocal(local_folder)
    if (storage === 'drive') return this.beginDrive()
    return this.welcome(null)
  }

  private async welcome(mode: StorageMode | null, message: Message | null = null, connectError = false, busy = false): Promise<void> {
    this.mode = mode
    const needSecret = mode === 'drive' && !(await this.hooks.auth.hasClientSecret())
    this.setScreen({ name: 'welcome', mode, needSecret, busy, connectError, message, defaultFolder: this.hooks.defaultFolder })
  }

  async chooseMode(mode: StorageMode | null): Promise<void> {
    if (mode === 'drive') return this.beginDrive()
    return this.welcome(mode)
  }

  private async beginDrive(): Promise<void> {
    if (!(await this.hooks.auth.hasClientSecret())) return this.welcome('drive')
    await this.welcome('drive', { key: 'login.checking' }, false, true)
    try {
      this.tokens = await this.hooks.auth.load()
    } catch {
      this.tokens = null
    }
    if (!this.tokens) return this.welcome('drive')
    return this.openLibrary('drive', this.hooks.makeDrive(this.tokens))
  }

  async chooseClientSecret(): Promise<void> {
    const result = await this.hooks.auth.chooseClientSecret()
    if (result === 'cancel') return
    if (result !== 'ok') return this.welcome('drive', { key: `login.secret_${result}`, error: true })
    return this.welcome('drive', { key: 'login.secret_ok' })
  }

  async signIn(successText: string): Promise<void> {
    await this.welcome('drive', { key: 'login.waiting_browser' }, false, true)
    try {
      this.tokens = await this.hooks.auth.login(successText)
    } catch (error) {
      this.hooks.log(`[login] ${errorText(error)}`)
      return this.welcome('drive', { key: 'login.failed', error: true })
    }
    return this.openLibrary('drive', this.hooks.makeDrive(this.tokens))
  }

  async retry(): Promise<void> {
    if (this.mode === 'local') return this.openLocal(this.settings.local_folder)
    if (this.tokens) return this.openLibrary('drive', this.hooks.makeDrive(this.tokens))
    return this.beginDrive()
  }

  /** folder: a path, null = the default folder, true = let the user pick one. */
  async openLocal(folder: string | null | true): Promise<void> {
    const path = folder === true ? await this.hooks.pickFolder('OKgram', this.settings.local_folder ?? this.hooks.defaultFolder) : (folder ?? this.hooks.defaultFolder)
    if (!path) return
    return this.openLibrary('local', this.hooks.makeLocal(path))
  }

  private parse(bytes: Uint8Array): LibraryData {
    return sanitizeData(JSON.parse(decode(bytes)), prefsOf(this.settings))
  }

  /** A damaged data file is kept next to the cache and the library starts from scratch. */
  private parseOrRescue(bytes: Uint8Array, cache: LibraryCache): LibraryData | null {
    try {
      return this.parse(bytes)
    } catch (error) {
      this.hooks.log(`[data] damaged okgram.json: ${errorText(error)}`)
      try {
        mkdirSync(cache.folder, { recursive: true })
        writeFileSync(join(cache.folder, `okgram-damaged-${Date.now()}.json`), bytes)
      } catch {
        // nothing more to save
      }
      this.message('data.damaged', undefined, true)
      return null
    }
  }

  private async openLibrary(mode: StorageMode, backend: MediaBackend): Promise<void> {
    this.closeLibrary()
    const session = this.session
    await this.welcome(mode, { key: mode === 'drive' ? 'login.connecting' : 'login.opening' }, false, true)
    try {
      let account: Account
      let online = true
      try {
        account = await backend.account()
      } catch (error) {
        if (!(error instanceof OfflineError) || mode !== 'drive') throw error
        const last = this.settings.last_account
        if (!last.id) throw new NoDataError('offline without a known account')
        account = { id: last.id, email: last.email ?? '', displayName: last.name ?? '' }
        online = false
      }
      const cache = new LibraryCache(this.hooks.cacheRoot, `${mode}:${account.id}`)
      const cached = cache.readData()
      let data = cached ? this.parseOrRescue(cached.data, cache) : null
      let base = cached?.base ?? null
      let pending = Boolean(cached?.pending && data)
      let media = cache.readList()
      if (online) {
        try {
          const remote = await backend.readData()
          if (remote) {
            const remoteData = this.parseOrRescue(remote.data, cache)
            if (remoteData) {
              data = data && pending ? mergeData(data, remoteData) : remoteData
              base = remote.revision
            } else {
              pending = true
            }
          } else {
            pending = true
          }
          media = await backend.listMedia()
        } catch (error) {
          if (!(error instanceof OfflineError)) throw error
          online = false
        }
      }
      if (!data) {
        if (!online && mode === 'drive') throw new NoDataError('no data offline')
        data = { ...emptyData(prefsOf(this.settings)), prefs_modified: Date.now() }
        pending = true
      }
      if (session !== this.session) return
      this.mode = mode
      this.backend = backend
      this.cache = cache
      this.thumbs = new ThumbService(cache.thumbs, backend, this.hooks.resizeImage)
      this.videoInfo = cache.readVideoInfo()
      this.media = media ?? []
      this.online = online
      this.data = data
      this.base = base
      this.pending = pending
      this.dirty = pending
      this.status = pending ? (online ? 'saving' : 'pending') : 'saved'
      this.settings = {
        ...this.settings,
        storage: mode,
        local_folder: mode === 'local' ? account.id : this.settings.local_folder,
        last_account: mode === 'drive' ? { id: account.id, email: account.email, name: account.displayName } : this.settings.last_account
      }
      this.adoptPrefs()
      this.saveSettingsFile()
      if (online) cache.writeList(this.media)
      this.setScreen({ name: 'library', mode, account: { email: account.email, name: account.displayName }, session })
      this.hooks.ui.library(this.getLibrary())
      this.hooks.ui.data(this.data)
      this.hooks.ui.status(this.status)
      this.hooks.ui.settings(this.settings)
      if (pending) {
        if (online) this.scheduleSave(0)
        else this.startRetry()
      }
      this.startSync()
      this.startWatch()
    } catch (error) {
      if (session !== this.session) return
      this.backend = null
      if (error instanceof AuthError) {
        await this.hooks.auth.logout(null).catch(() => undefined)
        this.tokens = null
        return this.welcome('drive', { key: 'login.expired', error: true })
      }
      if (error instanceof NoDataError) return this.welcome(mode, { key: 'login.offline_no_data', error: true }, true)
      if (error instanceof BackendError && error.message === 'not_writable') {
        const path = (backend as { root?: string }).root ?? this.settings.local_folder ?? ''
        return this.welcome('local', { key: 'local.not_writable', params: { path }, error: true }, true)
      }
      this.hooks.log(`[open ${mode}] ${errorText(error)}`)
      return this.welcome(mode, { key: 'login.connect_failed', params: { error: errorText(error) }, error: true }, true)
    }
  }

  /** Take the preferences stored with the library (another computer may have changed them). */
  private adoptPrefs(): void {
    if (!this.data.prefs_modified) {
      this.data = { ...this.data, prefs: prefsOf(this.settings) }
      return
    }
    if (samePrefs(this.data.prefs, prefsOf(this.settings))) return
    const before = resolveFlags(this.settings).native_titlebar
    this.settings = { ...this.settings, ...this.data.prefs }
    this.saveSettingsFile()
    this.hooks.ui.settings(this.settings)
    const after = resolveFlags(this.settings).native_titlebar
    if (before !== after) this.hooks.nativeFrameChanged?.(after)
  }

  private closeLibrary(): void {
    this.session++
    for (const timer of [this.saveTimer, this.watchTimer, this.mediaTimer]) if (timer) clearTimeout(timer)
    this.saveTimer = this.watchTimer = this.mediaTimer = null
    this.stopRetry()
    if (this.syncTimer) clearInterval(this.syncTimer)
    this.syncTimer = null
    this.stopWatch?.()
    this.stopWatch = null
    this.backend = null
    this.cache = null
    this.thumbs = null
    this.media = []
    this.videoInfo = {}
    this.data = emptyData(prefsOf(this.settings))
    this.base = null
    this.dirty = false
    this.pending = false
    this.status = 'saved'
  }

  // --- saving & refreshing ------------------------------------------------
  private scheduleSave(delay = SAVE_DELAY_MS): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.save()
    }, delay)
  }

  private startRetry(): void {
    this.retryTimer ??= setInterval(() => {
      if (!this.pending) return this.stopRetry()
      this.dirty = true
      void this.save()
    }, RETRY_MS)
  }

  private stopRetry(): void {
    if (this.retryTimer) clearInterval(this.retryTimer)
    this.retryTimer = null
  }

  private startSync(): void {
    if (this.syncTimer) clearInterval(this.syncTimer)
    this.syncTimer = null
    const minutes = this.settings.sync_minutes
    if (minutes > 0 && this.backend) this.syncTimer = setInterval(() => void this.refresh(true), minutes * 60_000)
  }

  private startWatch(): void {
    this.stopWatch?.()
    this.stopWatch =
      this.backend?.watch?.(() => {
        if (this.watchTimer) clearTimeout(this.watchTimer)
        this.watchTimer = setTimeout(() => void this.refresh(true), WATCH_DELAY_MS)
      }) ?? null
  }

  /** Upload the data file now (joining it with a newer copy from another computer first). */
  save(): Promise<void> {
    return this.serial(async () => {
      const backend = this.backend
      const cache = this.cache
      if (!backend || !cache || !this.dirty) return
      const session = this.session
      this.dirty = false
      this.setStatus('saving')
      let bytes = encode(serializeData(this.data))
      try {
        const remote = await backend.dataRevision()
        if (remote !== null && remote !== this.base) {
          const fresh = await backend.readData()
          const freshData = fresh ? this.parseOrRescue(fresh.data, cache) : null
          if (freshData && session === this.session) {
            this.data = mergeData(this.data, freshData)
            this.adoptPrefs()
            this.hooks.ui.data(this.data)
            bytes = encode(serializeData(this.data))
          }
        }
        const revision = await backend.writeData(bytes)
        if (session !== this.session) return
        this.base = revision
        this.pending = false
        cache.writeData(bytes, revision, false)
        this.stopRetry()
        this.setOnline(true)
        if (!this.dirty) this.setStatus('saved')
      } catch (error) {
        if (session !== this.session) return
        this.pending = true
        try {
          cache.writeData(bytes, this.base, true)
        } catch {
          // disk full: keep the changes in memory
        }
        this.startRetry()
        if (error instanceof OfflineError) {
          this.setOnline(false)
          this.setStatus('pending')
        } else {
          this.hooks.log(`[save] ${errorText(error)}`)
          this.setStatus(error instanceof AuthError ? 'pending' : 'error')
          this.message(error instanceof AuthError ? 'status.auth_detail' : 'status.error_detail', { error: errorText(error) }, true)
        }
      }
    })
  }

  /** Load the media list again and pick up changes made on another computer. */
  refresh(quiet = false): Promise<void> {
    return this.serial(async () => {
      const backend = this.backend
      const cache = this.cache
      if (!backend || !cache) return
      const session = this.session
      this.loading = true
      this.hooks.ui.library(this.getLibrary())
      try {
        const media = await backend.listMedia()
        const remote = await backend.dataRevision()
        if (session !== this.session) return
        this.media = media
        cache.writeList(media)
        this.online = true
        this.thumbs?.resetFailures()
        if (remote !== null && remote !== this.base) {
          const fresh = await backend.readData()
          const freshData = fresh && session === this.session ? this.parseOrRescue(fresh.data, cache) : null
          if (fresh && freshData) {
            this.data = this.dirty || this.pending ? mergeData(this.data, freshData) : freshData
            if (!this.dirty && !this.pending) {
              this.base = fresh.revision
              cache.writeData(fresh.data, fresh.revision, false)
            }
            this.adoptPrefs()
            this.hooks.ui.data(this.data)
          }
        }
        if (this.pending) {
          this.dirty = true
          this.scheduleSave(0)
        }
      } catch (error) {
        if (session !== this.session) return
        if (error instanceof OfflineError) this.online = false
        else if (error instanceof AuthError) return void this.expired()
        else {
          this.hooks.log(`[refresh] ${errorText(error)}`)
          if (!quiet) this.message('library.refresh_failed', { error: errorText(error) }, true)
        }
      } finally {
        if (session === this.session) {
          this.loading = false
          this.hooks.ui.library(this.getLibrary())
        }
      }
    })
  }

  /** The Google sign-in is no longer valid: back to the sign-in screen (unsent changes stay cached). */
  private async expired(): Promise<void> {
    await this.hooks.auth.logout(null).catch(() => undefined)
    this.tokens = null
    this.closeLibrary()
    return this.welcome('drive', { key: 'login.expired', error: true })
  }

  mutate(op: DataOp): void {
    if (!this.backend || !op || typeof op !== 'object') return
    this.data = applyOp(this.data, op)
    if (op.type === 'prefs') this.adoptPrefs()
    this.hooks.ui.data(this.data)
    this.dirty = true
    this.setStatus('saving')
    this.scheduleSave()
  }

  // --- files --------------------------------------------------------------
  async upload(paths?: string[], albumId: string | null = null): Promise<void> {
    const backend = this.backend
    if (!backend) return
    const picked = paths?.length ? paths : await this.hooks.pickFiles()
    if (!picked.length) return
    const files = await collectFiles(picked)
    if (!files.length) return this.message('upload.unsupported', undefined, true)
    const session = this.session
    const jobs = files.map((file) => ({ file, handle: this.transfers.add('upload', file.name, file.size) }))
    this.background(async () => {
      const added: string[] = []
      for (const { file, handle } of jobs) {
        if (handle.signal.aborted || session !== this.session) {
          handle.fail('cancelled')
          continue
        }
        handle.start()
        try {
          const item = await backend.upload(fileSource(file.path, file.name, file.size, file.modified), handle.progress, handle.signal)
          handle.finish()
          if (session !== this.session) continue
          this.media = [...this.media.filter((m) => m.id !== item.id), item]
          added.push(item.id)
          this.mediaChanged()
        } catch (error) {
          handle.fail(errorText(error))
          if (!isAbort(error)) this.hooks.log(`[upload] ${file.name}: ${errorText(error)}`)
        }
      }
      if (session !== this.session) return
      if (albumId && added.length) this.mutate({ type: 'album.add', id: albumId, items: added })
      if (added.length) this.message('upload.done', { count: added.length })
      if (added.length < jobs.length && jobs.some((j) => !j.handle.signal.aborted)) this.message('upload.some_failed', undefined, true)
    })
  }

  private async saveTo(item: MediaItem, target: string, handle: TransferHandle): Promise<void> {
    const backend = this.backend
    if (!backend) throw new BackendError('closed')
    handle.start()
    try {
      const response = await backend.open(item.id, null, handle.signal)
      if (!response.body) throw new BackendError('empty response')
      await pipeline(Readable.fromWeb(response.body as never), counter(handle), createWriteStream(target), { signal: handle.signal })
      handle.finish()
    } catch (error) {
      await rm(target, { force: true }).catch(() => undefined)
      handle.fail(errorText(error))
      throw error
    }
  }

  async download(ids: string[]): Promise<void> {
    const items = ids.map((id) => this.item(id)).filter((m): m is MediaItem => Boolean(m))
    if (!items.length || !this.backend) return
    let folder = this.settings.download_folder
    let single: string | null = null
    if (!folder) {
      if (items.length === 1) {
        single = await this.hooks.pickSaveFile(items[0].name, [{ name: items[0].ext.toUpperCase(), extensions: [items[0].ext] }])
        if (!single) return
      } else {
        folder = await this.hooks.pickFolder('OKgram')
        if (!folder) return
      }
    }
    const target = folder
    const jobs = items.map((item) => ({ item, handle: this.transfers.add('download', item.name, item.size) }))
    this.background(async () => {
      let saved = 0
      const taken = new Set(target ? (await readdir(target).catch(() => [] as string[])).map((n) => n.toLowerCase()) : [])
      for (const { item, handle } of jobs) {
        if (handle.signal.aborted) continue
        const name = uniqueName(item.name, taken)
        taken.add(name.toLowerCase())
        try {
          if (target) mkdirSync(target, { recursive: true })
          await this.saveTo(item, single ?? join(target!, name), handle)
          saved++
        } catch (error) {
          if (!isAbort(error)) this.hooks.log(`[download] ${item.name}: ${errorText(error)}`)
        }
      }
      if (saved) this.message('download.done', { count: saved, folder: single ? dirname(single) : target! })
      else if (jobs.some((j) => !j.handle.signal.aborted)) this.message('download.failed', undefined, true)
    })
  }

  async downloadZip(ids: string[], name: string): Promise<void> {
    const items = ids.map((id) => this.item(id)).filter((m): m is MediaItem => Boolean(m))
    const backend = this.backend
    if (!items.length || !backend) return
    const safe = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || 'OKgram'
    const target = await this.hooks.pickSaveFile(`${safe}.zip`, [{ name: 'ZIP', extensions: ['zip'] }])
    if (!target) return
    const handle = this.transfers.add('zip', basename(target), items.reduce((sum, m) => sum + m.size, 0))
    this.background(async () => {
      handle.start()
      const out = createWriteStream(target)
      let zipError: Error | null = null
      const zip = new Zip((error, chunk, final) => {
        if (error) {
          zipError = error
          return
        }
        out.write(chunk)
        if (final) out.end()
      })
      try {
        const names = new Set<string>()
        let done = 0
        for (const item of items) {
          handle.signal.throwIfAborted()
          const entryName = uniqueName(item.name, names)
          names.add(entryName.toLowerCase())
          const entry = new ZipPassThrough(entryName)
          entry.mtime = new Date(item.modified || Date.now())
          zip.add(entry)
          const response = await backend.open(item.id, null, handle.signal)
          const reader = response.body?.getReader()
          for (;;) {
            const part = reader ? await reader.read() : { done: true as const, value: undefined }
            if (part.done) break
            entry.push(part.value)
            done += part.value.length
            handle.progress(done)
            if (zipError) throw zipError
            if (out.writableNeedDrain) await once(out, 'drain')
          }
          entry.push(new Uint8Array(0), true)
        }
        zip.end()
        if (zipError) throw zipError
        if (!out.writableFinished) await once(out, 'finish')
        handle.finish()
        this.message('zip.done', { path: target })
      } catch (error) {
        zip.terminate()
        out.destroy()
        await rm(target, { force: true }).catch(() => undefined)
        handle.fail(errorText(error))
        if (!isAbort(error)) {
          this.hooks.log(`[zip] ${errorText(error)}`)
          this.message('zip.failed', undefined, true)
        }
      }
    })
  }

  cancelTransfer(id: string): void {
    this.transfers.cancel(id)
  }

  clearTransfers(): void {
    this.transfers.clear()
  }

  /** stem: the new name without the extension (the extension never changes). */
  async rename(id: string, stem: string): Promise<RenameResult> {
    const item = this.item(id)
    const backend = this.backend
    if (!item || !backend) return 'failed'
    const clean = stem.trim().replace(new RegExp(`\\.${item.ext}$`, 'i'), '')
    const name = `${clean}.${item.ext}`
    if (!clean || !validFileName(name)) return 'invalid'
    if (name === item.name) return 'ok'
    const folder = (m: MediaItem): string => (backend.kind === 'local' ? dirname(m.id) : '')
    const taken = this.media.some((m) => m.id !== id && folder(m) === folder(item) && m.name.toLowerCase() === name.toLowerCase())
    if (taken) return 'exists'
    try {
      const updated = await backend.rename(id, name)
      this.media = this.media.map((m) => (m.id === id ? updated : m))
      if (updated.id !== id) {
        const info = this.videoInfo[id]
        if (info) {
          this.videoInfo[updated.id] = { ...info, version: updated.version }
          delete this.videoInfo[id]
        }
        this.mutate({ type: 'rekey', from: id, to: updated.id })
      }
      this.mediaChanged()
      return 'ok'
    } catch (error) {
      if (error instanceof BackendError && error.message === 'exists') return 'exists'
      this.hooks.log(`[rename] ${errorText(error)}`)
      return 'failed'
    }
  }

  async trash(ids: string[]): Promise<number> {
    const backend = this.backend
    if (!backend) return 0
    const done: string[] = []
    let lastError = ''
    for (const id of ids) {
      try {
        await backend.trash(id)
        done.push(id)
      } catch (error) {
        lastError = errorText(error)
        this.hooks.log(`[trash] ${lastError}`)
      }
    }
    if (done.length) {
      const gone = new Set(done)
      this.media = this.media.filter((m) => !gone.has(m.id))
      this.mutate({ type: 'forget', ids: done })
      this.mediaChanged()
    }
    if (done.length < ids.length) this.message('trash.failed', { error: lastError }, true)
    return done.length
  }

  /** Drive: anyone with the link can view the file. Local: the file's path. Copied to the clipboard. */
  async share(id: string): Promise<string | null> {
    const backend = this.backend
    if (!backend || !this.item(id)) return null
    try {
      const link = backend.kind === 'local' ? backend.localPath!(id) : await backend.share(id)
      this.hooks.writeClipboard(link)
      if (backend.kind === 'drive') {
        this.media = this.media.map((m) => (m.id === id ? { ...m, shared: true } : m))
        this.mediaChanged()
      }
      return link
    } catch (error) {
      this.hooks.log(`[share] ${errorText(error)}`)
      this.message('share.failed', { error: errorText(error) }, true)
      return null
    }
  }

  async unshare(id: string): Promise<boolean> {
    const backend = this.backend
    if (!backend || backend.kind !== 'drive') return false
    try {
      await backend.unshare(id)
      this.media = this.media.map((m) => (m.id === id ? { ...m, shared: false } : m))
      this.mediaChanged()
      return true
    } catch (error) {
      this.message('share.failed', { error: errorText(error) }, true)
      return false
    }
  }

  copyText(text: string): void {
    this.hooks.writeClipboard(text)
  }

  /** Open in the system's default app (a Drive file is downloaded to a temporary folder first). */
  async openInSystem(id: string): Promise<boolean> {
    const item = this.item(id)
    const backend = this.backend
    if (!item || !backend) return false
    let path: string
    if (backend.kind === 'local') path = backend.localPath!(id)
    else {
      const folder = join(this.hooks.tempDir, 'okgram-open')
      mkdirSync(folder, { recursive: true })
      path = join(folder, item.name)
      const handle = this.transfers.add('download', item.name, item.size)
      try {
        const current = statSync(path, { throwIfNoEntry: false })
        if (current?.size === item.size) handle.finish()
        else await this.saveTo(item, path, handle)
      } catch (error) {
        if (!isAbort(error)) this.message('system.open_failed', { error: errorText(error) }, true)
        return false
      }
    }
    const error = await this.hooks.openPath(path)
    if (error) this.message('system.open_failed', { error }, true)
    return !error
  }

  storeThumbnail(id: string, version: string, thumbnail: Uint8Array | null, info: VideoInfo | null): void {
    const item = this.item(id)
    if (!item || item.version !== version) return
    if (info && item.kind === 'video' && Number(info.width) > 0 && Number(info.height) > 0) {
      this.videoInfo[id] = { width: Math.round(info.width), height: Math.round(info.height), duration: Math.round(info.duration) || 0, version }
    }
    if (thumbnail && thumbnail.length && thumbnail.length < 4 * 1024 * 1024) {
      try {
        this.thumbs?.store(item, thumbnail)
      } catch (error) {
        this.hooks.log(`[thumb] ${errorText(error)}`)
      }
    }
    this.mediaChanged()
  }

  /** Thumbnail for the okgram://thumb/ protocol. */
  thumbnail(id: string): Promise<Thumb | null> {
    const item = this.item(id)
    return item && this.thumbs ? this.thumbs.get(item) : Promise.resolve(null)
  }

  /** File content for the okgram://media/ protocol. */
  async openMedia(id: string, range: string | null, signal?: AbortSignal): Promise<Response> {
    const item = this.item(id)
    const backend = this.backend
    if (!item || !backend) return new Response('Not found', { status: 404 })
    try {
      const upstream = await backend.open(id, range, signal)
      const headers = new Headers({ 'Content-Type': item.mime, 'Accept-Ranges': 'bytes' })
      for (const name of ['content-length', 'content-range']) {
        const value = upstream.headers.get(name)
        if (value) headers.set(name, value)
      }
      return new Response(upstream.body, { status: upstream.status, headers })
    } catch (error) {
      if (error instanceof OfflineError) this.setOnline(false)
      return new Response('Unavailable', { status: 503 })
    }
  }

  async quota(): Promise<Quota | null> {
    const backend = this.backend
    if (!backend) return null
    const library = this.media.reduce((sum, m) => sum + m.size, 0)
    try {
      const quota = await backend.quota()
      return quota ? { ...quota, library } : null
    } catch {
      return null
    }
  }

  cacheSize(): number {
    return this.cache?.size() ?? 0
  }

  clearCache(): void {
    if (!this.cache || !this.backend) return
    this.cache.clearThumbs()
    this.thumbs = new ThumbService(this.cache.thumbs, this.backend, this.hooks.resizeImage)
    this.message('settings.cache_cleared')
  }

  // --- settings -----------------------------------------------------------
  async updateSettings(patch: Partial<Settings>): Promise<Settings> {
    const before = this.settings
    this.settings = sanitizeSettings({ ...this.settings, ...patch })
    this.saveSettingsFile()
    const keys = Object.keys(pickPrefs(patch)) as (keyof Prefs)[]
    if (this.backend && keys.length) {
      const prefs = prefsOf(this.settings)
      this.mutate({ type: 'prefs', patch: Object.fromEntries(keys.map((key) => [key, prefs[key]])) as Partial<Prefs> })
    }
    if (resolveFlags(before).native_titlebar !== resolveFlags(this.settings).native_titlebar) this.hooks.nativeFrameChanged?.(resolveFlags(this.settings).native_titlebar)
    if (before.sync_minutes !== this.settings.sync_minutes) this.startSync()
    this.hooks.ui.settings(this.settings)
    return this.settings
  }

  async pickDownloadFolder(): Promise<string | null> {
    const folder = await this.hooks.pickFolder('OKgram', this.settings.download_folder ?? undefined)
    if (folder) await this.updateSettings({ download_folder: folder })
    return folder
  }

  async exportSettings(): Promise<boolean> {
    const target = await this.hooks.pickSaveFile('OKgram-settings.json', [{ name: 'JSON', extensions: ['json'] }])
    if (!target) return false
    try {
      writeFileSync(target, JSON.stringify({ app: 'okgram-settings', format: 1, prefs: prefsOf(this.settings), sync_minutes: this.settings.sync_minutes }, null, 2), 'utf8')
      this.message('settings.exported')
      return true
    } catch (error) {
      this.message('settings.export_failed', { error: errorText(error) }, true)
      return false
    }
  }

  async importSettings(): Promise<ImportResult> {
    const source = await this.hooks.pickOpenFile([{ name: 'JSON', extensions: ['json'] }])
    if (!source) return 'cancel'
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(source, 'utf8'))
    } catch {
      return 'invalid'
    }
    if (!isRecord(raw) || raw.app !== 'okgram-settings' || !isRecord(raw.prefs)) return 'invalid'
    await this.updateSettings({ ...sanitizePrefs(raw.prefs), ...(raw.sync_minutes !== undefined ? { sync_minutes: Number(raw.sync_minutes) } : {}) })
    this.message('settings.imported')
    return 'ok'
  }

  // --- leaving -------------------------------------------------------------
  /** Drive: sign out. Local: close the folder. 'pending' = changes not uploaded yet. */
  async leave(force = false): Promise<'done' | 'pending'> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    if (this.dirty) await this.save()
    await this.idle()
    if (this.pending && !force) return 'pending'
    const mode = this.mode
    this.transfers.cancelAll()
    if (mode === 'drive') {
      await this.welcome('drive', { key: 'login.logging_out' }, false, true)
      await this.hooks.auth.logout(this.tokens).catch(() => undefined)
      this.cache?.clear()
      this.tokens = null
    }
    this.closeLibrary()
    this.settings = { ...this.settings, storage: null, last_account: mode === 'drive' ? {} : this.settings.last_account }
    this.saveSettingsFile()
    await this.welcome(null, { key: mode === 'drive' ? 'login.logged_out' : 'login.closed' })
    return 'done'
  }

  /** Before the app quits: send unsaved changes (at most 15 s). */
  async shutdown(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
      void this.save()
    }
    this.stopRetry()
    if (this.syncTimer) clearInterval(this.syncTimer)
    this.stopWatch?.()
    this.transfers.cancelAll()
    await Promise.race([this.idle(), new Promise((resolve) => setTimeout(resolve, 15_000))])
  }

  /** Mode of the open library (for the window title and menus). */
  get storage(): StorageMode | null {
    return this.backend?.kind ?? null
  }
}
