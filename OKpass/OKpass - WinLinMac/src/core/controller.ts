// Application state: sign-in, storage, session, saving, locking, settings actions.
// Platform specifics (files, sign-in, dialogs, fingerprint) come in through Platform,
// so the same controller runs in the desktop main process and on the phone.
import type { BackupItem, BiometricStatus, Message, SaveState, SaveStatus, Screen, Settings } from '../shared/ipc'
import type { VaultData } from '../shared/model'
import { resolveFlags } from '../shared/theme'
import { concat, equalBytes } from './bytes'
import { AuthError, NoDataError, OfflineError, type Account } from './backend'
import { DEFAULT_PARAMS } from './kdf'
import type { Platform, TokenProvider } from './platform'
import { Repository } from './repository'
import { Session, type Owner } from './session'
import { defaultSettings, sanitizeSettings } from './settings'
import { FormatError, VaultFile } from './vaultFile'
import { applyData, toData } from './vault'

const RETRY_MS = 60_000
const SALT_LEN = 16

const errorText = (error: unknown): string => String((error as Error)?.message ?? error).slice(0, 200)

export class Controller {
  settings: Settings = defaultSettings()
  private screen: Screen = { name: 'loading' }
  private tokens: TokenProvider | null = null
  private account: Account | null = null
  private repo: Repository | null = null
  private session: Session | null = null
  private sessionCounter = 0
  private status: SaveState = 'saved'
  private queue: Promise<unknown> = Promise.resolve()
  private retryTimer: ReturnType<typeof setInterval> | null = null
  private ready: Promise<void> | null = null

  constructor(private readonly platform: Platform) {}

  /** Load the settings once; every public entry point waits for this. */
  init(): Promise<void> {
    this.ready ??= this.platform.loadSettings().then((s) => {
      this.settings = sanitizeSettings(s)
    })
    return this.ready
  }

  // --- helpers -----------------------------------------------------------
  getScreen(): Screen {
    if (this.screen.name === 'vault' && this.session) return this.vaultScreen()
    return this.screen
  }

  private setScreen(screen: Screen): void {
    this.screen = screen
    this.platform.ui.sendScreen(screen)
  }

  private message(key: string, params?: Record<string, string | number>, error = false): void {
    this.platform.ui.sendMessage({ key, params, error })
  }

  private setStatus(status: SaveState): void {
    this.status = status
    this.platform.ui.sendStatus(status)
  }

  /** Run storage work strictly one after another. */
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work)
    this.queue = run.catch(() => undefined)
    return run
  }

  /** Wait until all queued storage work is finished. */
  idle(): Promise<unknown> {
    return this.queue
  }

  private async saveSettings(): Promise<void> {
    await this.platform.saveSettings(this.settings)
  }

  private login(needSecret: boolean, message: Message | null = null, connectError = false, busy = false): void {
    this.setScreen({ name: 'login', needSecret, busy, connectError, message })
  }

  private busy(key: string): void {
    this.login(false, { key }, false, true)
  }

  private async needSecret(): Promise<boolean> {
    return this.platform.auth.needsClientSecret && !(await this.platform.auth.hasClientSecret())
  }

  private async keyScreen(create: boolean, busy = false): Promise<void> {
    const biometric = !create && this.platform.biometric ? await this.platform.biometric.enabled().catch(() => false) : false
    this.setScreen({ name: 'key', email: this.account?.email ?? '', create, offline: !this.repo?.online, busy, biometric })
  }

  private vaultScreen(): Screen {
    return {
      name: 'vault',
      email: this.account?.email ?? '',
      vault: toData(this.session!.vault),
      status: this.status,
      online: Boolean(this.repo?.online),
      session: this.sessionCounter
    }
  }

  private owner(): Owner {
    return { name: this.account?.displayName ?? '', email: this.account?.email ?? '' }
  }

  private startRetry(): void {
    this.retryTimer ??= setInterval(() => void this.retryNow(), RETRY_MS)
  }

  private stopRetry(): void {
    if (this.retryTimer) clearInterval(this.retryTimer)
    this.retryTimer = null
  }

  // --- start & sign-in ---------------------------------------------------
  async start(): Promise<void> {
    await this.init()
    if (this.platform.devMode) return this.openStorage()
    return this.begin()
  }

  async begin(): Promise<void> {
    if (await this.needSecret()) return this.login(true)
    this.busy('login.checking')
    try {
      this.tokens = await this.platform.auth.load()
    } catch {
      this.tokens = null
    }
    if (this.tokens === null) return this.login(false)
    return this.openStorage()
  }

  async chooseClientSecret(): Promise<void> {
    const result = await this.platform.auth.chooseClientSecret()
    if (result === 'cancel') return
    if (result !== 'ok') return this.login(true, { key: `login.secret_${result}`, error: true })
    this.login(false, { key: 'login.secret_ok' })
  }

  async signIn(successText: string): Promise<void> {
    this.busy('login.waiting_browser')
    try {
      this.tokens = await this.platform.auth.login(successText)
    } catch {
      return this.login(await this.needSecret(), { key: 'login.failed', error: true })
    }
    return this.openStorage()
  }

  async retry(): Promise<void> {
    return this.platform.devMode || this.tokens ? this.openStorage() : this.begin()
  }

  // --- storage -----------------------------------------------------------
  async openStorage(): Promise<void> {
    await this.init()
    this.busy('login.connecting')
    try {
      const backend = this.platform.makeBackend(this.tokens)
      let account: Account
      try {
        account = await backend.account()
      } catch (error) {
        if (!(error instanceof OfflineError)) throw error
        const last = this.settings.last_account
        if (!last.id) throw new NoDataError('offline without a known account')
        account = { id: last.id, email: last.email ?? '', displayName: last.name ?? '' }
      }
      const repo = new Repository(backend, this.platform.cacheFor(account.id), () => this.settings.backup_count)
      const data = await repo.load()
      if (data !== null) VaultFile.parse(data)
      this.account = account
      this.repo = repo
      this.settings = { ...this.settings, last_account: { id: account.id, email: account.email, name: account.displayName } }
      await this.saveSettings()
      if (repo.pending) this.startRetry()
      await this.keyScreen(data === null)
    } catch (error) {
      if (error instanceof AuthError) {
        await this.platform.auth.logout(null).catch(() => undefined)
        this.tokens = null
        this.login(await this.needSecret(), { key: 'login.expired', error: true })
      } else if (error instanceof NoDataError) {
        this.login(false, { key: 'login.offline_no_data', error: true }, true)
      } else if (error instanceof FormatError) {
        this.login(false, { key: 'login.bad_file', error: true }, true)
      } else {
        this.login(false, { key: 'login.connect_failed', params: { error: errorText(error) }, error: true }, true)
      }
    }
  }

  // --- key & session -----------------------------------------------------
  async submitKey(raw: string): Promise<void> {
    if (this.screen.name !== 'key' || !this.repo) return
    const create = this.repo.current === null
    await this.keyScreen(create, true)
    const params = this.platform.kdfParams ?? DEFAULT_PARAMS
    try {
      const session = create
        ? await Session.createNew(raw, this.owner(), params)
        : await Session.unlock(VaultFile.parse(this.repo.current!), raw, this.owner())
      await this.openSession(session, create)
    } catch (error) {
      await this.keyScreen(create)
      this.message('key.unlock_error', { error: errorText(error) }, true)
    }
  }

  async unlockBiometric(): Promise<void> {
    const bio = this.platform.biometric
    if (this.screen.name !== 'key' || !this.repo?.current || !bio) return
    const secret = await bio.unlock()
    if (!secret || secret.length !== SALT_LEN + 32) {
      if (secret) await bio.clear()
      return
    }
    const file = VaultFile.parse(this.repo.current)
    if (!equalBytes(secret.subarray(0, SALT_LEN), file.salt)) {
      // The vault file was replaced (import / restore): the stored secret no longer fits.
      await bio.clear()
      await this.keyScreen(false)
      return this.message('bio.changed', undefined, true)
    }
    await this.keyScreen(false, true)
    try {
      await this.openSession(await Session.unlockWithMaster(file, secret.slice(SALT_LEN), this.owner()), false)
    } catch (error) {
      await this.keyScreen(false)
      this.message('key.unlock_error', { error: errorText(error) }, true)
    }
  }

  private async openSession(session: Session, created: boolean): Promise<void> {
    this.session = session
    this.sessionCounter++
    this.status = this.repo?.pending ? 'pending' : 'saved'
    this.setScreen(this.vaultScreen())
    if (created) await this.persist()
  }

  private closeSession(): void {
    this.session?.close()
    this.session = null
  }

  // --- saving ------------------------------------------------------------
  saveVault(data: VaultData): Promise<SaveStatus> {
    if (!this.session) return Promise.resolve('saved')
    applyData(this.session.vault, data)
    return this.persist()
  }

  private persist(): Promise<SaveStatus> {
    const session = this.session
    const repo = this.repo
    return this.serial(async () => {
      if (!session || !repo || session !== this.session) return 'saved' as SaveStatus
      const bytes = await session.encrypt()
      const status: SaveStatus = bytes === null ? 'saved' : await repo.save(bytes)
      this.setStatus(status)
      if (status === 'pending') this.startRetry()
      else if (status === 'saved' && !repo.pending) this.stopRetry()
      if (status === 'error') this.message('status.error_detail', undefined, true)
      return status
    })
  }

  retryNow(): Promise<SaveStatus> {
    const repo = this.repo
    return this.serial(async () => {
      if (!repo || !repo.pending) {
        this.stopRetry()
        return 'saved' as SaveStatus
      }
      const status = await repo.retry()
      if (status === 'saved') {
        this.stopRetry()
        this.message('status.synced')
      }
      if (this.session) this.setStatus(status)
      return status
    })
  }

  // --- lock & sign-out ---------------------------------------------------
  async lock(pending?: VaultData): Promise<void> {
    if (!this.session) return
    if (pending) await this.saveVault(pending)
    await this.idle()
    this.closeSession()
    await this.keyScreen(false)
  }

  async logout(pending?: VaultData, force = false): Promise<'done' | 'pending'> {
    if (this.session && pending) await this.saveVault(pending)
    await this.idle()
    if (this.repo?.pending && !force) return 'pending'
    this.closeSession()
    this.stopRetry()
    this.busy('login.logging_out')
    const tokens = this.tokens
    const repo = this.repo
    try {
      if (!this.platform.devMode) await this.platform.auth.logout(tokens)
      await repo?.clearLocal()
      await this.platform.biometric?.clear()
    } catch {
      // nothing else to clean up
    }
    this.tokens = null
    this.account = null
    this.repo = null
    this.settings = { ...this.settings, last_account: {} }
    await this.saveSettings()
    if (this.platform.devMode) await this.openStorage()
    else this.login(await this.needSecret(), { key: 'login.logged_out' })
    return 'done'
  }

  // --- settings ----------------------------------------------------------
  async getSettings(): Promise<Settings> {
    await this.init()
    return this.settings
  }

  async updateSettings(patch: Partial<Settings>): Promise<Settings> {
    await this.init()
    const before = resolveFlags(this.settings).native_titlebar
    this.settings = sanitizeSettings({ ...this.settings, ...patch })
    await this.saveSettings()
    const after = resolveFlags(this.settings).native_titlebar
    if (before !== after) this.platform.nativeFrameChanged?.(after)
    return this.settings
  }

  async setDecoy(raw: string): Promise<string | null> {
    if (!this.session) return null
    const error = await this.session.setDecoy(raw)
    if (error) return error
    await this.persist()
    return null
  }

  async removeDecoy(): Promise<void> {
    if (!this.session) return
    await this.session.removeDecoy()
    await this.persist()
  }

  isOnline(): boolean {
    return Boolean(this.repo?.online)
  }

  copyText(text: string): Promise<void> {
    return this.platform.writeClipboard(text)
  }

  // --- fingerprint -------------------------------------------------------
  async biometricStatus(): Promise<BiometricStatus> {
    const bio = this.platform.biometric
    if (!bio) return { available: false, enabled: false }
    const [available, enabled] = await Promise.all([bio.available().catch(() => false), bio.enabled().catch(() => false)])
    return { available, enabled }
  }

  /** Bind the fingerprint to the vault that is open now (or switch it off). */
  async setBiometric(on: boolean): Promise<boolean> {
    const bio = this.platform.biometric
    if (!bio) return false
    if (!on) {
      await bio.clear()
      return true
    }
    const master = this.session?.master
    if (!master || !this.session) return false
    return bio.store(concat(this.session.file.salt, master))
  }

  // --- backups, import & export -----------------------------------------
  async listBackups(): Promise<BackupItem[]> {
    const repo = this.repo
    if (!repo) return []
    return this.serial(() => repo.listBackups())
  }

  private async replaceWith(work: (repo: Repository) => Promise<SaveStatus>): Promise<boolean> {
    const repo = this.repo
    if (!repo) return false
    try {
      await this.serial(() => work(repo))
    } catch (error) {
      this.message('backups.restore_failed', { error: errorText(error) }, true)
      return false
    }
    this.closeSession()
    await this.keyScreen(false)
    this.message('backups.restored')
    return true
  }

  restoreBackup(id: string): Promise<boolean> {
    return this.replaceWith((repo) => repo.restoreBackup(id))
  }

  async exportVault(): Promise<boolean> {
    await this.idle()
    const data = this.repo?.current
    if (!data) return false
    const d = new Date()
    const two = (n: number) => String(n).padStart(2, '0')
    const name = `OKpass-${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}.okp`
    try {
      if (!(await this.platform.exportFile(name, data))) return false
    } catch (error) {
      this.message('settings.export_failed', { error: errorText(error) }, true)
      return false
    }
    this.message('settings.exported')
    return true
  }

  async importVault(picked?: Uint8Array): Promise<'ok' | 'cancel' | 'invalid' | 'failed'> {
    const data = picked ?? (await this.platform.importFile())
    if (!data) return 'cancel'
    try {
      VaultFile.parse(data)
    } catch {
      return 'invalid'
    }
    return (await this.replaceWith((repo) => repo.replace(data))) ? 'ok' : 'failed'
  }

  async shutdown(): Promise<void> {
    this.stopRetry()
    await Promise.race([this.idle(), new Promise((resolve) => setTimeout(resolve, 15_000))])
  }
}
