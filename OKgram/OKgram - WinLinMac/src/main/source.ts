// One source (a local folder or a Google Drive account): its storage, offline cache,
// thumbnails, media list and its own okgram.json with saving, offline retry and refresh.
// The controller joins all sources into one library.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MediaItem, Message, Prefs, SourceConfig, SourceState, SourceStatus, SyncState, VideoInfo } from '../shared/ipc'
import { applyOp, emptyData, mergeData, sanitizeData, serializeData, type DataOp, type LibraryData } from '../shared/model'
import { joinId } from '../shared/sources'
import { AuthError, BackendError, OfflineError, type Account, type MediaBackend, type UploadSource } from '../core/backend'
import type { TokenProvider } from '../core/driveRest'
import { errorText } from '../core/errors'
import { LEGACY_DRIVE_ID } from '../core/settings'
import { LibraryCache, type VideoInfoMap } from './cache'
import type { Hooks } from './hooks'
import { ThumbService, type Thumb } from './thumbs'

const SAVE_DELAY_MS = 1000
const RETRY_MS = 60_000
const WATCH_DELAY_MS = 1500

class NoDataError extends Error {
  name = 'NoDataError'
}

const encode = (text: string): Uint8Array => new TextEncoder().encode(text)
const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)

export interface SourceEnv {
  hooks: Hooks
  prefs(): Prefs
  syncMinutes(): number
  /** Something of this source changed: its file list, its data or its state. */
  changed(source: string, what: 'media' | 'data' | 'state'): void
  /** The Google account behind a source became known (first sign-in). */
  account(source: string, account: Account): void
  message(message: Message): void
}

export class SourceSession {
  backend: MediaBackend | null = null
  tokens: TokenProvider | null = null
  cache: LibraryCache | null = null
  data: LibraryData
  status: SourceStatus = 'connecting'
  sync: SyncState = 'saved'
  message: Message | null = null
  loading = false
  private thumbs: ThumbService | null = null
  private files: MediaItem[] = []
  private videoInfo: VideoInfoMap = {}
  private base: string | null = null
  private dirty = false
  private pending = false
  private generation = 0
  private queue: Promise<unknown> = Promise.resolve()
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private retryTimer: ReturnType<typeof setInterval> | null = null
  private syncTimer: ReturnType<typeof setInterval> | null = null
  private watchTimer: ReturnType<typeof setTimeout> | null = null
  private mediaTimer: ReturnType<typeof setTimeout> | null = null
  private stopWatch: (() => void) | null = null

  constructor(
    public config: SourceConfig,
    private readonly env: SourceEnv
  ) {
    this.data = emptyData(env.prefs())
  }

  get id(): string {
    return this.config.id
  }

  /** The data of this source takes part in the library (open, possibly offline from the cache). */
  get loaded(): boolean {
    return this.backend !== null
  }

  get isPending(): boolean {
    return this.pending || this.dirty
  }

  state(): SourceState {
    return { ...this.config, status: this.status, sync: this.sync, loading: this.loading, count: this.files.length, message: this.message }
  }

  /** The media list with ids "<source>:<id>". */
  items(): MediaItem[] {
    return this.files.map((item) => this.wrap(item))
  }

  rawItem(raw: string): MediaItem | undefined {
    return this.files.find((m) => m.id === raw)
  }

  wrap(item: MediaItem): MediaItem {
    const info = item.kind === 'video' ? this.videoInfo[item.id] : undefined
    const wrapped = { ...item, id: joinId(this.id, item.id), source: this.id }
    if (!info || info.version !== item.version) return wrapped
    return { ...wrapped, width: item.width ?? info.width, height: item.height ?? info.height, duration: item.duration ?? info.duration }
  }

  private changed(what: 'media' | 'data' | 'state'): void {
    this.env.changed(this.id, what)
  }

  private setState(status: SourceStatus, message: Message | null = null): void {
    this.status = status
    this.message = message
    this.changed('state')
  }

  private setSync(sync: SyncState): void {
    this.sync = sync
    this.changed('state')
  }

  private log(text: string): void {
    this.env.hooks.log(`[${this.config.kind} ${this.id}] ${text}`)
  }

  /** The file list changed: tell the windows and keep the offline copy (batched). */
  private mediaChanged(): void {
    this.changed('media')
    if (this.mediaTimer) clearTimeout(this.mediaTimer)
    this.mediaTimer = setTimeout(() => {
      this.mediaTimer = null
      try {
        this.cache?.writeList(this.files)
        this.cache?.writeVideoInfo(this.videoInfo)
      } catch (error) {
        this.log(`cache: ${errorText(error)}`)
      }
    }, 150)
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work)
    this.queue = run.catch(() => undefined)
    return run
  }

  private parse(bytes: Uint8Array): LibraryData {
    return sanitizeData(JSON.parse(decode(bytes)), this.env.prefs())
  }

  /** A damaged data file is kept next to the cache and the source starts from scratch. */
  private parseOrRescue(bytes: Uint8Array, cache: LibraryCache): LibraryData | null {
    try {
      return this.parse(bytes)
    } catch (error) {
      this.log(`damaged okgram.json: ${errorText(error)}`)
      try {
        mkdirSync(cache.folder, { recursive: true })
        writeFileSync(join(cache.folder, `okgram-damaged-${Date.now()}.json`), bytes)
      } catch {
        // nothing more to save
      }
      this.env.message({ key: 'data.damaged', params: { name: this.config.name }, error: true })
      return null
    }
  }

  // --- open & close -------------------------------------------------------
  async open(): Promise<void> {
    this.close()
    const generation = this.generation
    const { hooks } = this.env
    this.loading = true
    this.setState('connecting')
    try {
      let backend: MediaBackend
      if (this.config.kind === 'local') {
        backend = hooks.makeLocal(this.config.path ?? '', this.config.subfolders)
      } else {
        this.tokens ??= await hooks.auth.load(this.id, this.id === LEGACY_DRIVE_ID).catch(() => null)
        if (generation !== this.generation) return
        if (!this.tokens) {
          this.loading = false
          return this.setState('login', { key: 'source.login_needed' })
        }
        backend = hooks.makeDrive(this.tokens)
      }
      let account: Account
      let online = true
      try {
        account = await backend.account()
      } catch (error) {
        const known = this.config.account
        if (!(error instanceof OfflineError) || this.config.kind !== 'drive' || !known) throw error
        account = { id: known.id, email: known.email, displayName: known.name }
        online = false
      }
      const cache = new LibraryCache(hooks.cacheRoot, `${this.config.kind}:${account.id}`)
      const cached = cache.readData()
      let data = cached ? this.parseOrRescue(cached.data, cache) : null
      let base = cached?.base ?? null
      let pending = Boolean(cached?.pending && data)
      let media = cache.readList()
      if (online) {
        try {
          const remote = await backend.readData()
          const remoteData = remote ? this.parseOrRescue(remote.data, cache) : null
          if (remote && remoteData) {
            data = data && pending ? mergeData(data, remoteData) : remoteData
            base = remote.revision
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
        if (!online) throw new NoDataError('no data offline')
        data = { ...emptyData(this.env.prefs()), prefs_modified: Date.now() }
        pending = true
      }
      if (generation !== this.generation) return
      this.backend = backend
      this.cache = cache
      this.thumbs = new ThumbService(cache.thumbs, backend, hooks.resizeImage)
      this.videoInfo = cache.readVideoInfo()
      // Older cached lists may carry ids with a source prefix; the cache keeps raw ids.
      this.files = (media ?? []).map((m) => ({ ...m, source: this.id }))
      this.data = data
      this.base = base
      this.pending = pending
      this.dirty = pending
      this.sync = pending ? (online ? 'saving' : 'pending') : 'saved'
      this.loading = false
      if (this.config.kind === 'drive') this.env.account(this.id, account)
      if (online) cache.writeList(this.files)
      this.status = online ? 'ready' : 'offline'
      this.message = online ? null : { key: 'source.offline' }
      this.changed('media')
      this.changed('data')
      this.changed('state')
      if (pending) {
        if (online) this.scheduleSave(0)
        else this.startRetry()
      }
      this.startSync()
      this.startWatch()
    } catch (error) {
      if (generation !== this.generation) return
      this.backend = null
      this.loading = false
      if (error instanceof AuthError) {
        await hooks.auth.logout(this.id, null).catch(() => undefined)
        this.tokens = null
        return this.setState('login', { key: 'source.login_expired', error: true })
      }
      if (error instanceof NoDataError) return this.setState('offline', { key: 'source.offline_no_data', error: true })
      if (error instanceof BackendError && error.message === 'not_writable') {
        return this.setState('error', { key: 'local.not_writable', params: { path: this.config.path ?? '' }, error: true })
      }
      this.log(`open: ${errorText(error)}`)
      this.setState('error', { key: 'source.connect_failed', params: { error: errorText(error) }, error: true })
    }
  }

  /** Stop timers and drop the open storage (the data stays in the cache). */
  close(): void {
    this.generation++
    for (const timer of [this.saveTimer, this.watchTimer, this.mediaTimer]) if (timer) clearTimeout(timer)
    this.saveTimer = this.watchTimer = this.mediaTimer = null
    this.stopRetry()
    if (this.syncTimer) clearInterval(this.syncTimer)
    this.syncTimer = null
    this.stopWatch?.()
    this.stopWatch = null
    this.backend = null
    this.thumbs = null
    this.files = []
    this.data = emptyData(this.env.prefs())
    this.base = null
    this.dirty = false
    this.pending = false
    this.sync = 'saved'
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

  startSync(): void {
    if (this.syncTimer) clearInterval(this.syncTimer)
    this.syncTimer = null
    const minutes = this.env.syncMinutes()
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

  /** Apply changes to this source's data file and save it soon. */
  apply(ops: DataOp[]): void {
    if (!this.backend || !ops.length) return
    this.data = ops.reduce((data, op) => applyOp(data, op), this.data)
    this.dirty = true
    this.sync = 'saving'
    this.changed('data')
    this.changed('state')
    this.scheduleSave()
  }

  /** Save now (joining with a newer copy from another computer first). */
  save(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    return this.serial(async () => {
      const backend = this.backend
      const cache = this.cache
      if (!backend || !cache || !this.dirty) return
      const generation = this.generation
      this.dirty = false
      this.setSync('saving')
      let bytes = encode(serializeData(this.data))
      try {
        const remote = await backend.dataRevision()
        if (remote !== null && remote !== this.base) {
          const fresh = await backend.readData()
          const freshData = fresh ? this.parseOrRescue(fresh.data, cache) : null
          if (freshData && generation === this.generation) {
            this.data = mergeData(this.data, freshData)
            this.changed('data')
            bytes = encode(serializeData(this.data))
          }
        }
        const revision = await backend.writeData(bytes)
        if (generation !== this.generation) return
        this.base = revision
        this.pending = false
        cache.writeData(bytes, revision, false)
        this.stopRetry()
        if (this.status === 'offline') this.setState('ready')
        if (!this.dirty) this.setSync('saved')
      } catch (error) {
        if (generation !== this.generation) return
        this.pending = true
        try {
          cache.writeData(bytes, this.base, true)
        } catch {
          // disk full: keep the changes in memory
        }
        this.startRetry()
        if (error instanceof OfflineError) {
          if (this.status === 'ready') this.setState('offline', { key: 'source.offline' })
          this.setSync('pending')
        } else {
          this.log(`save: ${errorText(error)}`)
          this.setSync(error instanceof AuthError ? 'pending' : 'error')
          this.env.message({ key: error instanceof AuthError ? 'status.auth_detail' : 'status.error_detail', params: { name: this.config.name, error: errorText(error) }, error: true })
        }
      }
    })
  }

  /** Load the file list again and pick up changes made on another computer. */
  refresh(quiet = false): Promise<void> {
    if (!this.backend) return this.open()
    return this.serial(async () => {
      const backend = this.backend
      const cache = this.cache
      if (!backend || !cache) return
      const generation = this.generation
      this.loading = true
      this.changed('state')
      try {
        const media = await backend.listMedia()
        const remote = await backend.dataRevision()
        if (generation !== this.generation) return
        this.files = media.map((m) => ({ ...m, source: this.id }))
        cache.writeList(this.files)
        this.thumbs?.resetFailures()
        if (this.status !== 'ready') this.setState('ready')
        if (remote !== null && remote !== this.base) {
          const fresh = await backend.readData()
          const freshData = fresh && generation === this.generation ? this.parseOrRescue(fresh.data, cache) : null
          if (fresh && freshData) {
            const local = this.dirty || this.pending
            this.data = local ? mergeData(this.data, freshData) : freshData
            if (!local) {
              this.base = fresh.revision
              cache.writeData(fresh.data, fresh.revision, false)
            }
            this.changed('data')
          }
        }
        this.changed('media')
        if (this.pending) {
          this.dirty = true
          this.scheduleSave(0)
        }
      } catch (error) {
        if (generation !== this.generation) return
        if (error instanceof OfflineError) {
          if (this.status === 'ready') this.setState('offline', { key: 'source.offline' })
        } else if (error instanceof AuthError) {
          await this.env.hooks.auth.logout(this.id, null).catch(() => undefined)
          this.tokens = null
          this.close()
          this.changed('media')
          this.changed('data')
          this.setState('login', { key: 'source.login_expired', error: true })
        } else {
          this.log(`refresh: ${errorText(error)}`)
          if (!quiet) this.env.message({ key: 'library.refresh_failed', params: { name: this.config.name, error: errorText(error) }, error: true })
        }
      } finally {
        if (generation === this.generation) {
          this.loading = false
          this.changed('state')
        }
      }
    })
  }

  /** Wait for queued saving (at most `ms`). */
  async flush(ms = 15_000): Promise<void> {
    if (this.dirty) void this.save()
    await Promise.race([this.queue, new Promise((resolve) => setTimeout(resolve, ms))])
  }

  // --- files --------------------------------------------------------------
  async upload(source: UploadSource, onProgress: (done: number) => void, signal: AbortSignal): Promise<MediaItem> {
    if (!this.backend) throw new BackendError('source is not open')
    const item = { ...(await this.backend.upload(source, onProgress, signal)), source: this.id }
    this.files = [...this.files.filter((m) => m.id !== item.id), item]
    this.mediaChanged()
    return this.wrap(item)
  }

  async rename(raw: string, name: string): Promise<MediaItem> {
    if (!this.backend) throw new BackendError('source is not open')
    const updated = { ...(await this.backend.rename(raw, name)), source: this.id }
    this.files = this.files.map((m) => (m.id === raw ? updated : m))
    if (updated.id !== raw && this.videoInfo[raw]) {
      this.videoInfo[updated.id] = { ...this.videoInfo[raw], version: updated.version }
      delete this.videoInfo[raw]
    }
    this.mediaChanged()
    return this.wrap(updated)
  }

  /** Move files to the trash; returns the raw ids that were moved. */
  async trash(raws: string[]): Promise<{ done: string[]; error: string }> {
    const done: string[] = []
    let error = ''
    for (const raw of raws) {
      try {
        await this.backend?.trash(raw)
        done.push(raw)
      } catch (e) {
        error = errorText(e)
        this.log(`trash: ${error}`)
      }
    }
    if (done.length) {
      const gone = new Set(done)
      this.files = this.files.filter((m) => !gone.has(m.id))
      this.mediaChanged()
    }
    return { done, error }
  }

  setShared(raw: string, shared: boolean): void {
    this.files = this.files.map((m) => (m.id === raw ? { ...m, shared } : m))
    this.mediaChanged()
  }

  storeThumbnail(raw: string, version: string, thumbnail: Uint8Array | null, info: VideoInfo | null): void {
    const item = this.rawItem(raw)
    if (!item || item.version !== version) return
    if (info && item.kind === 'video' && Number(info.width) > 0 && Number(info.height) > 0) {
      this.videoInfo[raw] = { width: Math.round(info.width), height: Math.round(info.height), duration: Math.round(info.duration) || 0, version }
    }
    if (thumbnail && thumbnail.length && thumbnail.length < 4 * 1024 * 1024) {
      try {
        this.thumbs?.store(item, thumbnail)
      } catch (error) {
        this.log(`thumb: ${errorText(error)}`)
      }
    }
    this.mediaChanged()
  }

  thumbnail(raw: string): Promise<Thumb | null> {
    const item = this.rawItem(raw)
    return item && this.thumbs ? this.thumbs.get(item) : Promise.resolve(null)
  }

  /** File content as a response for the okgram:// protocol and downloads. */
  async openFile(raw: string, range: string | null, signal?: AbortSignal): Promise<Response> {
    const item = this.rawItem(raw)
    const backend = this.backend
    if (!item || !backend) return new Response('Not found', { status: 404 })
    try {
      const upstream = await backend.open(raw, range, signal)
      const headers = new Headers({ 'Content-Type': item.mime, 'Accept-Ranges': 'bytes' })
      for (const name of ['content-length', 'content-range']) {
        const value = upstream.headers.get(name)
        if (value) headers.set(name, value)
      }
      return new Response(upstream.body, { status: upstream.status, headers })
    } catch (error) {
      if (error instanceof OfflineError && this.status === 'ready') this.setState('offline', { key: 'source.offline' })
      return new Response('Unavailable', { status: 503 })
    }
  }

  clearThumbs(): void {
    if (!this.cache || !this.backend) return
    this.cache.clearThumbs()
    this.thumbs = new ThumbService(this.cache.thumbs, this.backend, this.env.hooks.resizeImage)
  }
}
