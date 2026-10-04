// The core of the Android app, inside a Bare Kit worklet: the same Core and API handlers as the desktop main
// process, driven by newline-delimited JSON (rpc.ts). The Java host sends `init` first (folders, data key);
// the worklet asks the host back ('host' messages) for what only Android can do: pickers, viewers, sharing.
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { createHandlers, type ApiHost } from '../core/api'
import { relayChanged, relayFromSettings } from '../core/network/relay/config'
import type { RelaySocketFactory } from '../core/network/relay/transport'
import { restoreBackup, writeBackup } from '../core/backup'
import { Core } from '../core/controller'
import type { KdfParams } from '../core/encryption/passwordProof'
import { defaultSettings, sanitizeSettings } from '../core/settings'
import type { KeyProtector } from '../core/state'
import { readJson, writeJson } from '../core/storage/jsonStore'
import type { ApiHandlers, AppStatus, BackupResult, Settings, UiEvent } from '../shared/ipc'
import { PHONE_FILE_BASE, contactChatId, setFileUrlBase } from '../shared/model'
import { createDataKeyProtector } from './keyProtector'
import { outgoingToDelete, outgoingToken } from './outgoing'
import { decodeLine, encodeLine, type RpcMessage } from './rpc'

export interface WorkletIo {
  send(line: string): void
  onLine(listener: (line: string) => void): void
}

export interface InitOptions {
  /** Storage folder (filesDir/okfetch). */
  root: string
  /** Folder of settings.json (filesDir/config). */
  configDir: string
  /** Temporary files such as a backup on its way out (cacheDir). */
  cacheDir: string
  /** 32 random bytes kept wrapped in Android Keystore. */
  dataKey: Uint8Array
  bootstrap?: { host: string; port: number }[]
  kdf?: KdfParams
  retryMs?: number
  /** Tests: relays to use instead of the settings (an empty list turns the fallback off). */
  relayUrls?: string[]
}

export interface WorkletEnv {
  /** How the relay fallback opens WebSockets (bare-ws on the phone); without it the fallback is off. */
  relaySocket?: RelaySocketFactory
}

export interface WorkletHandle {
  close(): Promise<void>
}

const OPEN_TRANSFER = new Set(['offered', 'accepted', 'transferring'])

export function startWorklet(io: WorkletIo, env: WorkletEnv = {}): WorkletHandle {
  let options: InitOptions | null = null
  let protector: KeyProtector | null = null
  let settings: Settings = defaultSettings()
  let core: Core | null = null
  let status: AppStatus = { phase: 'starting' }
  let nextHostId = 0
  let cleanupTimer: ReturnType<typeof setTimeout> | null = null
  const hostCalls = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()

  const send = (message: RpcMessage): void => io.send(encodeLine(message))
  const emit = (event: UiEvent): void => send({ t: 'event', event })

  function setStatus(next: AppStatus): void {
    status = next
    emit({ type: 'app', status })
  }

  /** Ask the Java host; resolves with its answer (null when the user cancelled). */
  function askHost<T>(method: string, ...args: unknown[]): Promise<T> {
    const id = `h${nextHostId++}`
    return new Promise<T>((resolve, reject) => {
      hostCalls.set(id, { resolve: resolve as (value: unknown) => void, reject })
      send({ t: 'host', id, method, args })
    })
  }

  const opts = (): InitOptions => {
    if (!options) throw new Error('not_initialized')
    return options
  }
  const settingsFile = (): string => join(opts().configDir, 'settings.json')
  const outgoingDir = (): string => join(opts().root, 'outgoing')

  function isInside(dir: string, path: string): boolean {
    const rel = relative(resolve(dir), resolve(path))
    return Boolean(rel) && !rel.startsWith('..') && !isAbsolute(rel)
  }

  // --- outgoing copies --------------------------------------------------------------

  function cleanOutgoing(): void {
    const dir = outgoingDir()
    if (!core || !existsSync(dir)) return
    const refs = new Map<string, boolean>()
    for (const contact of core.state.contacts) {
      for (const kind of ['enc', 'plain'] as const) {
        for (const message of core.chatLog(contactChatId(contact.pub, kind)).messages.values()) {
          const file = message.file
          const token = file?.direction === 'out' && file.source ? outgoingToken(file.source) : null
          if (!token || !file) continue
          const open = OPEN_TRANSFER.has(core.transfers.effectiveState(message.id, file.state))
          refs.set(token, (refs.get(token) ?? false) || open)
        }
      }
    }
    const dirs = readdirSync(dir).map((name) => ({ token: String(name), mtimeMs: statSync(join(dir, String(name))).mtimeMs }))
    for (const token of outgoingToDelete(dirs, refs, Date.now())) rmSync(join(dir, token), { recursive: true, force: true })
  }

  function scheduleCleanup(delay = 2000): void {
    if (cleanupTimer) clearTimeout(cleanupTimer)
    cleanupTimer = setTimeout(() => {
      cleanupTimer = null
      try {
        cleanOutgoing()
      } catch (error) {
        console.error('[okfetch] outgoing cleanup failed', error)
      }
    }, delay)
  }

  // --- core life cycle ------------------------------------------------------------------

  function relayConfig() {
    const urls = options?.relayUrls
    return relayFromSettings(urls ? { ...settings, relay_fallback: urls.length > 0, relay_urls: urls } : settings, env.relaySocket ?? null)
  }

  async function startCore(): Promise<void> {
    const o = opts()
    setStatus({ phase: 'starting' })
    try {
      core = await Core.open({ root: o.root, protector: protector!, bootstrap: o.bootstrap, kdf: o.kdf, retryMs: o.retryMs, relay: relayConfig() })
    } catch (error) {
      core = null
      const message = error instanceof Error ? error.message : String(error)
      console.error('[okfetch] cannot start', message)
      setStatus(message.includes('key_unavailable') ? { phase: 'keys' } : { phase: 'storage', path: o.root, error: message })
      return
    }
    core.onEvent((event) => {
      emit(event)
      if (event.type === 'chat' || (event.type === 'transfer' && !OPEN_TRANSFER.has(event.progress.state))) scheduleCleanup()
    })
    setStatus({ phase: 'ready' })
    scheduleCleanup(0)
  }

  async function stopCore(): Promise<void> {
    const running = core
    core = null
    if (cleanupTimer) clearTimeout(cleanupTimer)
    cleanupTimer = null
    await running?.close().catch((error) => console.error('[okfetch] close failed', error))
  }

  async function createBackup(password: string, withFiles: boolean): Promise<BackupResult> {
    if (!password) return { ok: false, error: 'empty_password' }
    const date = new Date().toISOString().slice(0, 10)
    const file = join(opts().cacheDir, 'backup', `OKfetch-zaloha-${date}.okfb`)
    try {
      if (core) {
        core.state.profile.lamport = core.tick()
        core.state.saveProfile()
      }
      writeBackup(opts().root, protector!, password, file, { withFiles, kdf: opts().kdf })
      const saved = await askHost<boolean>('saveDocument', file, `OKfetch-zaloha-${date}.okfb`)
      return saved ? { ok: true } : { ok: false, error: 'cancelled' }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: message.includes('key_unavailable') ? 'key_unavailable' : 'io' }
    } finally {
      rmSync(file, { force: true })
    }
  }

  async function restore(password: string): Promise<BackupResult> {
    const source = await askHost<string | null>('pickDocument')
    if (!source) return { ok: false, error: 'cancelled' }
    try {
      await stopCore()
      return restoreBackup(source, password, opts().root, protector!)
    } finally {
      if (isInside(opts().cacheDir, source)) rmSync(source, { force: true })
      await startCore()
    }
  }

  const host: ApiHost = {
    core() {
      if (!core) throw new Error('core not running')
      return core
    },
    status: () => status,
    protector: () => protector!,
    settings: () => settings,
    updateSettings(patch) {
      const previous = settings
      settings = sanitizeSettings({ ...settings, ...patch })
      if (relayChanged(previous, settings)) core?.setRelay(relayConfig())
      writeJson(settingsFile(), settings)
      emit({ type: 'settings', settings })
      return settings
    },
    pickFolder: async () => null,
    pickFile: (source) => askHost<string | null>('pickFile', source ?? 'file'),
    useStoragePath: async () => ({ ok: false, error: 'unsupported' }),
    openPath: (path) => askHost<void>('openFile', path),
    showItem: (path) => void askHost('shareFile', path),
    openExternal: (url) => askHost<void>('openUrl', url),
    copyText: (text) => void askHost('copyText', text),
    isPrepared: (path) => isInside(outgoingDir(), path) && existsSync(path) && statSync(path).isFile(),
    saveFile: async (path) => Boolean(await askHost<boolean>('saveFile', path)),
    shareFile: (path) => askHost<void>('shareFile', path),
    createBackup,
    restoreBackup: restore,
    async resetData() {
      await stopCore()
      rmSync(opts().root, { recursive: true, force: true })
      await startCore()
    }
  }

  const handlers = createHandlers(host) as Record<string, (...args: unknown[]) => unknown>

  async function init(raw: unknown): Promise<AppStatus> {
    if (options) return status
    const o = raw as InitOptions
    if (!o || typeof o.root !== 'string' || typeof o.configDir !== 'string' || typeof o.cacheDir !== 'string' || !(o.dataKey instanceof Uint8Array)) {
      throw new Error('bad init options')
    }
    options = o
    protector = createDataKeyProtector(o.dataKey)
    setFileUrlBase(PHONE_FILE_BASE)
    mkdirSync(o.configDir, { recursive: true })
    mkdirSync(o.cacheDir, { recursive: true })
    settings = sanitizeSettings(readJson<unknown>(settingsFile(), {}))
    await startCore()
    return status
  }

  async function call(method: string, args: unknown[]): Promise<unknown> {
    if (method === 'init') return init(args[0])
    if (method === 'shutdown') {
      await stopCore()
      return true
    }
    if (!options) throw new Error('not_initialized')
    const handler = handlers[method as keyof ApiHandlers]
    if (typeof handler !== 'function') throw new Error(`unknown method ${method}`)
    return handler(...args)
  }

  io.onLine((line) => {
    const message = decodeLine(line)
    if (!message) return
    if (message.t === 'call') {
      call(message.method, message.args).then(
        (result) => send({ t: 'reply', id: message.id, ok: true, result: result === undefined ? null : result }),
        (error) => send({ t: 'reply', id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) })
      )
    } else if (message.t === 'reply') {
      const waiting = hostCalls.get(message.id)
      hostCalls.delete(message.id)
      if (!waiting) return
      if (message.ok) waiting.resolve(message.result)
      else waiting.reject(new Error(message.error))
    }
  })

  return { close: stopCore }
}
