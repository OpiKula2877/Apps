// Keeps the encrypted vault file in sync between remote storage and the local cache.
import type { SaveStatus } from '../shared/ipc'
import { NoDataError, OfflineError, type BackupInfo, type StorageBackend } from './backend'
import { VaultFile } from './vaultFile'

export interface CachedVault {
  data: Uint8Array
  /** Remote revision the data was based on. */
  baseRevision: string | null
  /** True when the data still has to be uploaded. */
  pending: boolean
}

/** Encrypted offline copy of the vault for one account. */
export interface CacheStore {
  read(): Promise<CachedVault | null>
  write(data: Uint8Array, baseRevision: string | null, pending: boolean): Promise<void>
  clear(): Promise<void>
}

export { NoDataError }

export const BACKUP_INTERVAL = 30 * 60

export function backupName(suffix = ''): string {
  const d = new Date()
  const two = (n: number) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`
  return `vault-${stamp}${suffix ? `-${suffix}` : ''}.okp`
}

export class Repository {
  current: Uint8Array | null = null
  online = false
  pending = false
  lastError = ''
  private revision: string | null = null
  private remoteBytes: Uint8Array | null = null
  private lastBackup: number | null = null

  constructor(
    readonly backend: StorageBackend,
    private readonly cache: CacheStore,
    private readonly backupCount: () => number,
    private readonly clock: () => number = () => Date.now() / 1000
  ) {}

  /** Newest vault file, or null when no vault exists yet. Throws NoDataError offline without a cache. */
  async load(): Promise<Uint8Array | null> {
    this.lastBackup = null
    const cached = await this.cache.read()
    let remote
    try {
      remote = await this.backend.downloadVault()
      this.online = true
    } catch (error) {
      if (!(error instanceof OfflineError)) throw error
      this.online = false
      if (cached === null) throw new NoDataError('offline without a local copy')
      this.current = cached.data
      this.pending = cached.pending
      this.revision = cached.baseRevision
      return this.current
    }

    this.remoteBytes = remote?.data ?? null
    this.revision = remote?.revision ?? null
    if (cached !== null && (cached.pending || remote === null)) {
      if (remote !== null && remote.revision !== cached.baseRevision) {
        // Changed elsewhere while local edits waited: keep local, back up remote.
        try {
          await this.safeBackup(remote.data, backupName('conflict'))
        } catch {
          // offline again: the upload below reports it
        }
      }
      this.current = cached.data
      this.pending = true
      await this.flush()
      return this.current
    }
    if (remote === null) {
      this.current = null
      this.pending = false
      return null
    }
    this.current = remote.data
    this.pending = false
    await this.cache.write(remote.data, remote.revision, false)
    return this.current
  }

  async save(data: Uint8Array): Promise<SaveStatus> {
    this.current = data
    this.pending = true
    await this.cache.write(data, this.revision, true)
    return this.flush()
  }

  async retry(): Promise<SaveStatus> {
    if (!this.pending) return 'saved'
    return this.flush()
  }

  private async flush(forceBackup = false): Promise<SaveStatus> {
    try {
      if (this.remoteBytes !== null && (forceBackup || this.backupDue())) {
        await this.safeBackup(this.remoteBytes, backupName())
      }
      const revision = await this.backend.uploadVault(this.current!)
      this.online = true
      this.pending = false
      this.revision = revision
      this.remoteBytes = this.current
      await this.cache.write(this.current!, revision, false)
      return 'saved'
    } catch (error) {
      if (error instanceof OfflineError) {
        this.online = false
        return 'pending'
      }
      this.lastError = String(error)
      return 'error'
    }
  }

  // --- backups -----------------------------------------------------------
  private backupDue(): boolean {
    if (this.backupCount() <= 0) return false
    return this.lastBackup === null || this.clock() - this.lastBackup >= BACKUP_INTERVAL
  }

  private async safeBackup(data: Uint8Array, name: string): Promise<void> {
    if (this.backupCount() <= 0) return
    try {
      await this.backend.createBackup(data, name)
      this.lastBackup = this.clock()
      const keep = this.backupCount()
      for (const old of (await this.backend.listBackups()).slice(keep)) await this.backend.deleteBackup(old.id)
    } catch (error) {
      if (error instanceof OfflineError) throw error
      this.lastError = String(error)
    }
  }

  listBackups(): Promise<BackupInfo[]> {
    return this.backend.listBackups()
  }

  async restoreBackup(id: string): Promise<SaveStatus> {
    return this.replace(await this.backend.downloadBackup(id))
  }

  /** Replace the whole vault file (restore / import). The old one is backed up first. */
  async replace(data: Uint8Array): Promise<SaveStatus> {
    VaultFile.parse(data)
    this.current = data
    this.pending = true
    await this.cache.write(data, this.revision, true)
    return this.flush(true)
  }

  async clearLocal(): Promise<void> {
    await this.cache.clear()
    this.current = null
  }
}
