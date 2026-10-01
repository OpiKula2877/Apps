// Encrypted offline copy of the vault file on the desktop, one folder per Google account.
import { createHash } from 'node:crypto'
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import type { CacheStore, CachedVault } from '../core/repository'

function atomicWrite(path: string, data: Uint8Array): void {
  const tmp = `${path}.tmp`
  const fd = openSync(tmp, 'w')
  try {
    writeSync(fd, data)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(tmp, path)
}

export class LocalCache implements CacheStore {
  readonly folder: string

  constructor(root: string, accountId: string) {
    const digest = createHash('sha256').update(accountId, 'utf8').digest('hex').slice(0, 24)
    this.folder = join(root, digest)
  }

  async read(): Promise<CachedVault | null> {
    try {
      const data = new Uint8Array(readFileSync(join(this.folder, 'vault.okp')))
      const meta = JSON.parse(readFileSync(join(this.folder, 'meta.json'), 'utf8'))
      return { data, baseRevision: meta.base_revision ?? null, pending: Boolean(meta.pending) }
    } catch {
      return null
    }
  }

  async write(data: Uint8Array, baseRevision: string | null, pending: boolean): Promise<void> {
    mkdirSync(this.folder, { recursive: true })
    atomicWrite(join(this.folder, 'vault.okp'), data)
    atomicWrite(join(this.folder, 'meta.json'), Buffer.from(JSON.stringify({ base_revision: baseRevision, pending })))
  }

  async clear(): Promise<void> {
    rmSync(this.folder, { recursive: true, force: true })
  }
}
