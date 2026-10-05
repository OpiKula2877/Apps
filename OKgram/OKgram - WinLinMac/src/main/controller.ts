// Application state in the main process: the sources (local folders, Google Drive accounts)
// joined into one library, changes routed back to each source, uploads, downloads and settings.
// Both windows (library and viewer) show what this controller broadcasts.
import { createWriteStream, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { open as openFile, readdir, rm, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { once } from 'node:events'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { randomBytes } from 'node:crypto'
import { Zip, ZipPassThrough } from 'fflate'
import type {
  AddSourceResult,
  ClientSecretResult,
  ImportResult,
  LibraryState,
  MediaItem,
  Message,
  Prefs,
  Quota,
  RenameResult,
  Screen,
  Settings,
  SourceConfig,
  SourceDraft,
  SourceState,
  SyncState,
  VideoInfo
} from '../shared/ipc'
import { kindOf, mimeOf, validFileName } from '../shared/formats'
import { uniqueName } from '../shared/library'
import { emptyData, type DataOp, type LibraryData } from '../shared/model'
import { PREF_KEYS, isRecord, pickPrefs, sanitizePrefs } from '../shared/prefs'
import { aggregateData, joinId, routeOp, splitId } from '../shared/sources'
import { resolveFlags } from '../shared/theme'
import { BackendError, type Account, type UploadSource } from '../core/backend'
import { errorText, isAbort } from '../core/errors'
import { sanitizeSettings, sanitizeSource } from '../core/settings'
import type { Hooks } from './hooks'
import { SourceSession, type SourceEnv } from './source'
import type { Thumb } from './thumbs'
import { Transfers, type TransferHandle } from './transfers'

const MAX_DROP_FILES = 5000
const BROADCAST_MS = 60

function prefsOf(settings: Settings): Prefs {
  return sanitizePrefs(settings)
}

function samePrefs(a: Prefs, b: Prefs): boolean {
  return PREF_KEYS.every((key) => JSON.stringify(a[key]) === JSON.stringify(b[key]))
}

const newSourceId = (kind: 'local' | 'drive'): string => `${kind}${randomBytes(5).toString('hex')}`
const samePath = (a: string, b: string): boolean => (process.platform === 'linux' ? resolve(a) === resolve(b) : resolve(a).toLowerCase() === resolve(b).toLowerCase())

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
  private readonly sessions = new Map<string, SourceSession>()
  private merged: LibraryData
  private work: Promise<unknown> = Promise.resolve()
  private libraryTimer: ReturnType<typeof setTimeout> | null = null
  private stateTimer: ReturnType<typeof setTimeout> | null = null
  private readonly env: SourceEnv

  constructor(private readonly hooks: Hooks) {
    this.settings = sanitizeSettings(hooks.loadSettings())
    this.transfers = new Transfers((list) => hooks.ui.transfers(list))
    this.merged = emptyData(prefsOf(this.settings))
    this.env = {
      hooks,
      prefs: () => prefsOf(this.settings),
      syncMinutes: () => this.settings.sync_minutes,
      changed: (_source, what) => this.sourceChanged(what),
      account: (source, account) => this.rememberAccount(source, account),
      message: (message) => hooks.ui.message(message)
    }
  }

  // --- state for the windows ---------------------------------------------
  getScreen(): Screen {
    return this.screen
  }

  getLibrary(): LibraryState {
    const sessions = [...this.sessions.values()]
    return { media: sessions.flatMap((s) => s.items()), loading: sessions.some((s) => s.loading) }
  }

  getData(): LibraryData {
    return this.merged
  }

  getStatus(): SyncState {
    const states = [...this.sessions.values()].map((s) => s.sync)
    for (const state of ['error', 'pending', 'saving'] as const) if (states.includes(state)) return state
    return 'saved'
  }

  getSettings(): Settings {
    return this.settings
  }

  getSources(): SourceState[] {
    return this.settings.sources.map((config) => this.sessions.get(config.id)?.state() ?? { ...config, status: 'connecting', sync: 'saved', loading: false, count: 0, message: null })
  }

  private message(key: string, params?: Message['params'], error = false): void {
    this.hooks.ui.message({ key, params, error })
  }

  private saveSettingsFile(): void {
    try {
      this.hooks.saveSettings(this.settings)
    } catch (error) {
      this.hooks.log(`[settings] ${errorText(error)}`)
    }
  }

  private loadedSessions(): SourceSession[] {
    return [...this.sessions.values()].filter((s) => s.loaded)
  }

  /** A source reported a change: rebuild the joined data and tell the windows (batched). */
  private sourceChanged(what: 'media' | 'data' | 'state'): void {
    if (what === 'data') {
      this.merged = aggregateData(
        this.loadedSessions().map((s) => ({ source: s.id, data: s.data })),
        prefsOf(this.settings)
      )
      this.adoptPrefs()
      this.hooks.ui.data(this.merged)
      return
    }
    if (what === 'media') {
      this.libraryTimer ??= setTimeout(() => {
        this.libraryTimer = null
        this.hooks.ui.library(this.getLibrary())
      }, BROADCAST_MS)
      return
    }
    this.stateTimer ??= setTimeout(() => {
      this.stateTimer = null
      this.hooks.ui.sources(this.getSources())
      this.hooks.ui.status(this.getStatus())
      this.hooks.ui.library(this.getLibrary())
    }, BROADCAST_MS)
  }

  /** Take the preferences stored with the library (another computer may have changed them). */
  private adoptPrefs(): void {
    if (!this.merged.prefs_modified || samePrefs(this.merged.prefs, prefsOf(this.settings))) return
    const before = resolveFlags(this.settings).native_titlebar
    this.settings = { ...this.settings, ...this.merged.prefs }
    this.saveSettingsFile()
    this.hooks.ui.settings(this.settings)
    const after = resolveFlags(this.settings).native_titlebar
    if (before !== after) this.hooks.nativeFrameChanged?.(after)
  }

  private rememberAccount(source: string, account: Account): void {
    const config = this.settings.sources.find((s) => s.id === source)
    if (!config || (config.account?.id === account.id && config.account.email === account.email && config.account.name === account.displayName)) return
    this.setConfig({ ...config, account: { id: account.id, email: account.email, name: account.displayName } })
  }

  private setConfig(config: SourceConfig): void {
    this.settings = { ...this.settings, sources: this.settings.sources.map((s) => (s.id === config.id ? config : s)) }
    const session = this.sessions.get(config.id)
    if (session) session.config = config
    this.saveSettingsFile()
    this.hooks.ui.settings(this.settings)
    this.hooks.ui.sources(this.getSources())
  }

  /** Uploads, downloads and ZIP exports run one after another. */
  private background(work: () => Promise<void>): void {
    this.work = this.work.then(work, work).catch((error) => this.hooks.log(`[transfer] ${errorText(error)}`))
  }

  /** The source and the file for a joined id. */
  private locate(id: string): { session: SourceSession; raw: string; item: MediaItem } | null {
    const [source, raw] = splitId(id)
    const session = this.sessions.get(source)
    const item = session?.rawItem(raw)
    return session && item ? { session, raw, item: session.wrap(item) } : null
  }

  item(id: string): MediaItem | undefined {
    return this.locate(id)?.item
  }

  // --- start --------------------------------------------------------------
  async start(): Promise<void> {
    this.saveSettingsFile()
    for (const config of this.settings.sources) this.sessions.set(config.id, new SourceSession(config, this.env))
    this.screen = { name: 'library', session: 1 }
    this.hooks.ui.screen(this.screen)
    this.hooks.ui.sources(this.getSources())
    await Promise.all([...this.sessions.values()].map((s) => s.open()))
  }

  // --- sources ------------------------------------------------------------
  defaultFolder(): string {
    return this.hooks.defaultFolder
  }

  pickFolder(defaultPath?: string | null): Promise<string | null> {
    return this.hooks.pickFolder('OKgram', defaultPath ?? this.hooks.defaultFolder)
  }

  hasClientSecret(): Promise<boolean> {
    return this.hooks.auth.hasClientSecret()
  }

  chooseClientSecret(): Promise<ClientSecretResult> {
    return this.hooks.auth.chooseClientSecret()
  }

  private addSession(config: SourceConfig, session: SourceSession): void {
    this.settings = { ...this.settings, sources: [...this.settings.sources, config] }
    this.sessions.set(config.id, session)
    this.saveSettingsFile()
    this.hooks.ui.settings(this.settings)
    this.hooks.ui.sources(this.getSources())
  }

  private folderTaken(path: string, except?: string): boolean {
    return this.settings.sources.some((s) => s.kind === 'local' && s.id !== except && s.path !== null && samePath(s.path, path))
  }

  async addLocalSource(draft: SourceDraft): Promise<AddSourceResult> {
    const path = draft.path?.trim()
    if (!path) return { ok: false, error: { key: 'source.no_folder', error: true } }
    if (this.folderTaken(path)) return { ok: false, error: { key: 'source.duplicate_folder', error: true } }
    const config = sanitizeSource({ ...draft, id: newSourceId('local'), kind: 'local', path, enabled: true })
    if (!config) return { ok: false, error: { key: 'source.no_folder', error: true } }
    const session = new SourceSession(config, this.env)
    await session.open()
    if (session.status === 'error') {
      session.close()
      return { ok: false, error: session.message }
    }
    this.addSession(config, session)
    this.sourceChanged('data')
    this.sourceChanged('media')
    return { ok: true, id: config.id }
  }

  async addDriveSource(draft: SourceDraft, successText: string): Promise<AddSourceResult> {
    if (!(await this.hooks.auth.hasClientSecret())) return { ok: false, error: { key: 'login.need_secret', error: true } }
    const id = newSourceId('drive')
    let tokens
    try {
      tokens = await this.hooks.auth.login(id, successText)
    } catch (error) {
      this.hooks.log(`[login] ${errorText(error)}`)
      return { ok: false, error: { key: 'login.failed', error: true } }
    }
    let account: Account
    try {
      account = await this.hooks.makeDrive(tokens).account()
    } catch (error) {
      await this.hooks.auth.logout(id, null).catch(() => undefined)
      return { ok: false, error: { key: 'source.connect_failed', params: { error: errorText(error) }, error: true } }
    }
    if (this.settings.sources.some((s) => s.kind === 'drive' && s.account?.id === account.id)) {
      // Forget only the new copy of the token: revoking it would sign out the existing source too.
      await this.hooks.auth.logout(id, null).catch(() => undefined)
      return { ok: false, error: { key: 'source.duplicate_account', params: { email: account.email }, error: true } }
    }
    const config = sanitizeSource({
      ...draft,
      id,
      kind: 'drive',
      name: draft.name?.trim() || account.email,
      enabled: true,
      account: { id: account.id, email: account.email, name: account.displayName }
    })!
    const session = new SourceSession(config, this.env)
    session.tokens = tokens
    this.addSession(config, session)
    await session.open()
    return { ok: true, id }
  }

  async updateSource(id: string, patch: Partial<SourceDraft & { enabled: boolean }>): Promise<AddSourceResult> {
    const old = this.settings.sources.find((s) => s.id === id)
    const session = this.sessions.get(id)
    if (!old || !session) return { ok: false, error: null }
    if (old.kind === 'local' && patch.path && this.folderTaken(patch.path, id)) return { ok: false, error: { key: 'source.duplicate_folder', error: true } }
    const config = sanitizeSource({ ...old, ...patch })
    if (!config) return { ok: false, error: { key: 'source.no_folder', error: true } }
    const reopen = old.kind === 'local' && (config.path !== old.path || config.subfolders !== old.subfolders)
    if (reopen) await session.flush()
    this.setConfig(config)
    if (reopen) {
      await session.open()
      this.sourceChanged('data')
      this.sourceChanged('media')
    }
    return { ok: true, id }
  }

  async reconnectSource(id: string, successText: string): Promise<AddSourceResult> {
    const session = this.sessions.get(id)
    if (!session || session.config.kind !== 'drive') return { ok: false, error: null }
    let tokens
    try {
      tokens = await this.hooks.auth.login(id, successText)
    } catch {
      return { ok: false, error: { key: 'login.failed', error: true } }
    }
    try {
      const account = await this.hooks.makeDrive(tokens).account()
      const expected = session.config.account?.id
      if (expected && account.id !== expected) {
        await this.hooks.auth.logout(id, null).catch(() => undefined)
        return { ok: false, error: { key: 'source.other_account', params: { email: session.config.account?.email ?? '' }, error: true } }
      }
    } catch {
      // offline right after signing in: open() reports it
    }
    session.tokens = tokens
    await session.open()
    return { ok: true, id }
  }

  /** Drive: sign out of the account and drop its offline copy. Local: forget the folder (the files stay). */
  async removeSource(id: string, force = false): Promise<'done' | 'pending'> {
    const session = this.sessions.get(id)
    if (!session) return 'done'
    await session.flush()
    if (session.isPending && session.loaded && !force) return 'pending'
    const cache = session.cache
    const tokens = session.tokens
    session.close()
    this.sessions.delete(id)
    if (session.config.kind === 'drive') {
      await this.hooks.auth.logout(id, tokens).catch(() => undefined)
      cache?.clear()
    }
    this.settings = { ...this.settings, sources: this.settings.sources.filter((s) => s.id !== id) }
    this.saveSettingsFile()
    this.hooks.ui.settings(this.settings)
    this.sourceChanged('data')
    this.sourceChanged('state')
    return 'done'
  }

  // --- library ------------------------------------------------------------
  refresh(): Promise<void> {
    return Promise.all([...this.sessions.values()].map((s) => (s.status === 'login' ? undefined : s.refresh()))).then(() => undefined)
  }

  mutate(op: DataOp): void {
    if (!op || typeof op !== 'object') return
    const sessions = this.loadedSessions()
    if (!sessions.length) return
    const routes = routeOp(
      op,
      this.merged,
      sessions.map((s) => s.id)
    )
    for (const session of sessions) session.apply(routes.get(session.id) ?? [])
  }

  /** Upload into one source; albumId: also add the new files to that album. */
  async upload(sourceId: string, paths?: string[], albumId: string | null = null): Promise<void> {
    const session = this.sessions.get(sourceId)
    if (!session?.loaded) return this.message('upload.no_source', undefined, true)
    const picked = paths?.length ? paths : await this.hooks.pickFiles()
    if (!picked.length) return
    const files = await collectFiles(picked)
    if (!files.length) return this.message('upload.unsupported', undefined, true)
    const jobs = files.map((file) => ({ file, handle: this.transfers.add('upload', file.name, file.size) }))
    this.background(async () => {
      const added: string[] = []
      for (const { file, handle } of jobs) {
        if (handle.signal.aborted || !this.sessions.has(sourceId)) {
          handle.fail('cancelled')
          continue
        }
        handle.start()
        try {
          const item = await session.upload(fileSource(file.path, file.name, file.size, file.modified), handle.progress, handle.signal)
          handle.finish()
          added.push(item.id)
        } catch (error) {
          handle.fail(errorText(error))
          if (!isAbort(error)) this.hooks.log(`[upload] ${file.name}: ${errorText(error)}`)
        }
      }
      if (albumId && added.length) this.mutate({ type: 'album.add', id: albumId, items: added })
      if (added.length) this.message('upload.done', { count: added.length, name: session.config.name })
      if (added.length < jobs.length && jobs.some((j) => !j.handle.signal.aborted)) this.message('upload.some_failed', undefined, true)
    })
  }

  private async saveTo(id: string, target: string, handle: TransferHandle): Promise<void> {
    const found = this.locate(id)
    if (!found) throw new BackendError('file is gone')
    handle.start()
    try {
      const response = await found.session.openFile(found.raw, null, handle.signal)
      if (!response.ok || !response.body) throw new BackendError(`HTTP ${response.status}`)
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
    if (!items.length) return
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
          await this.saveTo(item.id, single ?? join(target!, name), handle)
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
    const items = ids.map((id) => this.locate(id)).filter((m): m is NonNullable<typeof m> => Boolean(m))
    if (!items.length) return
    const safe = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || 'OKgram'
    const target = await this.hooks.pickSaveFile(`${safe}.zip`, [{ name: 'ZIP', extensions: ['zip'] }])
    if (!target) return
    const handle = this.transfers.add('zip', basename(target), items.reduce((sum, m) => sum + m.item.size, 0))
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
        for (const { session, raw, item } of items) {
          handle.signal.throwIfAborted()
          const entryName = uniqueName(item.name, names)
          names.add(entryName.toLowerCase())
          const entry = new ZipPassThrough(entryName)
          entry.mtime = new Date(item.modified || Date.now())
          zip.add(entry)
          const response = await session.openFile(raw, null, handle.signal)
          if (!response.ok) throw new BackendError(`HTTP ${response.status}`)
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
    const found = this.locate(id)
    if (!found?.session.backend) return 'failed'
    const { session, raw, item } = found
    const clean = stem.trim().replace(new RegExp(`\\.${item.ext}$`, 'i'), '')
    const name = `${clean}.${item.ext}`
    if (!clean || !validFileName(name)) return 'invalid'
    if (name === item.name) return 'ok'
    const local = session.config.kind === 'local'
    const folder = (rawId: string): string => (local ? dirname(rawId) : '')
    const taken = session
      .items()
      .some((m) => m.id !== id && folder(splitId(m.id)[1]) === folder(raw) && m.name.toLowerCase() === name.toLowerCase())
    if (taken) return 'exists'
    try {
      const updated = await session.rename(raw, name)
      if (updated.id !== id) this.mutate({ type: 'rekey', from: id, to: updated.id })
      return 'ok'
    } catch (error) {
      if (error instanceof BackendError && error.message === 'exists') return 'exists'
      this.hooks.log(`[rename] ${errorText(error)}`)
      return 'failed'
    }
  }

  async trash(ids: string[]): Promise<number> {
    const bySource = new Map<SourceSession, string[]>()
    for (const id of ids) {
      const found = this.locate(id)
      if (!found) continue
      if (!bySource.has(found.session)) bySource.set(found.session, [])
      bySource.get(found.session)!.push(found.raw)
    }
    const gone: string[] = []
    let lastError = ''
    for (const [session, raws] of bySource) {
      const { done, error } = await session.trash(raws)
      gone.push(...done.map((raw) => joinId(session.id, raw)))
      if (error) lastError = error
    }
    if (gone.length) this.mutate({ type: 'forget', ids: gone })
    if (gone.length < ids.length) this.message('trash.failed', { error: lastError }, true)
    return gone.length
  }

  /** Drive: anyone with the link can view the file. Local: the file's path. Copied to the clipboard. */
  async share(id: string): Promise<string | null> {
    const found = this.locate(id)
    const backend = found?.session.backend
    if (!found || !backend) return null
    try {
      const link = backend.kind === 'local' ? backend.localPath!(found.raw) : await backend.share(found.raw)
      this.hooks.writeClipboard(link)
      if (backend.kind === 'drive') found.session.setShared(found.raw, true)
      return link
    } catch (error) {
      this.hooks.log(`[share] ${errorText(error)}`)
      this.message('share.failed', { error: errorText(error) }, true)
      return null
    }
  }

  async unshare(id: string): Promise<boolean> {
    const found = this.locate(id)
    const backend = found?.session.backend
    if (!found || !backend || backend.kind !== 'drive') return false
    try {
      await backend.unshare(found.raw)
      found.session.setShared(found.raw, false)
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
    const found = this.locate(id)
    const backend = found?.session.backend
    if (!found || !backend) return false
    let path: string
    if (backend.kind === 'local') path = backend.localPath!(found.raw)
    else {
      const folder = join(this.hooks.tempDir, 'okgram-open')
      mkdirSync(folder, { recursive: true })
      path = join(folder, found.item.name)
      const handle = this.transfers.add('download', found.item.name, found.item.size)
      try {
        const current = statSync(path, { throwIfNoEntry: false })
        if (current?.size === found.item.size) handle.finish()
        else await this.saveTo(id, path, handle)
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
    const [source, raw] = splitId(id)
    this.sessions.get(source)?.storeThumbnail(raw, version, thumbnail, info)
  }

  /** Thumbnail for the okgram://thumb/ protocol. */
  thumbnail(id: string): Promise<Thumb | null> {
    const [source, raw] = splitId(id)
    return this.sessions.get(source)?.thumbnail(raw) ?? Promise.resolve(null)
  }

  /** File content for the okgram://media/ protocol. */
  openMedia(id: string, range: string | null, signal?: AbortSignal): Promise<Response> {
    const [source, raw] = splitId(id)
    const session = this.sessions.get(source)
    return session ? session.openFile(raw, range, signal) : Promise.resolve(new Response('Not found', { status: 404 }))
  }

  async quota(): Promise<Quota[]> {
    const result: Quota[] = []
    for (const session of this.loadedSessions()) {
      const library = session.items().reduce((sum, m) => sum + m.size, 0)
      try {
        const quota = await session.backend!.quota()
        if (quota) result.push({ source: session.id, ...quota, library })
      } catch {
        result.push({ source: session.id, used: 0, limit: null, library })
      }
    }
    return result
  }

  cacheSize(): number {
    return [...this.sessions.values()].reduce((sum, s) => sum + (s.cache?.size() ?? 0), 0)
  }

  clearCache(): void {
    for (const session of this.sessions.values()) session.clearThumbs()
    this.message('settings.cache_cleared')
  }

  // --- settings -----------------------------------------------------------
  async updateSettings(patch: Partial<Settings>): Promise<Settings> {
    const before = this.settings
    // Sources change only through their own calls.
    const { sources: _ignored, ...rest } = patch
    this.settings = sanitizeSettings({ ...this.settings, ...rest, sources: this.settings.sources })
    this.saveSettingsFile()
    const keys = Object.keys(pickPrefs(rest)) as (keyof Prefs)[]
    if (keys.length) {
      const prefs = prefsOf(this.settings)
      this.mutate({ type: 'prefs', patch: Object.fromEntries(keys.map((key) => [key, prefs[key]])) as Partial<Prefs> })
    }
    if (resolveFlags(before).native_titlebar !== resolveFlags(this.settings).native_titlebar) this.hooks.nativeFrameChanged?.(resolveFlags(this.settings).native_titlebar)
    if (before.sync_minutes !== this.settings.sync_minutes) for (const session of this.sessions.values()) session.startSync()
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

  /** Save every source now and wait for it. */
  async flush(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((s) => s.flush()))
  }

  /** Before the app quits: send unsaved changes of every source (at most 15 s together). */
  async shutdown(): Promise<void> {
    this.transfers.cancelAll()
    await Promise.race([Promise.all([...this.sessions.values()].map((s) => s.flush())), new Promise((resolve) => setTimeout(resolve, 15_000))])
    for (const session of this.sessions.values()) session.close()
  }
}
