// Development stand-in for Google Drive that uses a local folder.
// Enabled with `--local-dev <folder>`. A file named OFFLINE in that folder
// simulates a lost connection.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, parse } from 'node:path'
import { OfflineError, type Account, type BackupInfo, type RemoteVault, type StorageBackend } from '../../core/backend'

const md5 = (data: Uint8Array): string => createHash('md5').update(data).digest('hex')

export class LocalFolderBackend implements StorageBackend {
  private readonly folder: string
  private readonly backups: string

  constructor(private readonly root: string) {
    this.folder = join(root, 'OKpass')
    this.backups = join(this.folder, 'backups')
  }

  private check(): void {
    if (existsSync(join(this.root, 'OFFLINE'))) throw new OfflineError('simulated offline mode')
    mkdirSync(this.backups, { recursive: true })
  }

  async account(): Promise<Account> {
    this.check()
    return { id: 'local-dev', email: 'local-dev@okpass', displayName: 'Local Dev' }
  }

  async downloadVault(): Promise<RemoteVault | null> {
    this.check()
    const path = join(this.folder, 'vault.okp')
    if (!existsSync(path)) return null
    const data = new Uint8Array(readFileSync(path))
    return { data, revision: md5(data) }
  }

  async uploadVault(data: Uint8Array): Promise<string> {
    this.check()
    const path = join(this.folder, 'vault.okp')
    writeFileSync(`${path}.tmp`, data)
    renameSync(`${path}.tmp`, path)
    return md5(data)
  }

  async listBackups(): Promise<BackupInfo[]> {
    this.check()
    return readdirSync(this.backups)
      .filter((name) => name.endsWith('.okp'))
      .map((name) => ({ name, stat: statSync(join(this.backups, name)) }))
      .sort((a, b) => Number(b.stat.mtimeMs - a.stat.mtimeMs) || b.name.localeCompare(a.name))
      .map(({ name, stat }) => ({ id: name, name, created: stat.mtime.toISOString() }))
  }

  async createBackup(data: Uint8Array, name: string): Promise<void> {
    this.check()
    let target = join(this.backups, name)
    for (let counter = 1; existsSync(target); counter++) target = join(this.backups, `${parse(name).name}-${counter}.okp`)
    writeFileSync(target, data)
  }

  async downloadBackup(id: string): Promise<Uint8Array> {
    this.check()
    return new Uint8Array(readFileSync(join(this.backups, basename(id))))
  }

  async deleteBackup(id: string): Promise<void> {
    this.check()
    rmSync(join(this.backups, basename(id)), { force: true })
  }
}
