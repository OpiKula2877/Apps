import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { equalBytes, utf8 } from '../src/core/bytes'
import { VaultFile, FormatError } from '../src/core/vaultFile'
import { BACKUP_INTERVAL, NoDataError, Repository } from '../src/core/repository'
import { LocalFolderBackend } from '../src/main/drive/localBackend'
import { LocalCache } from '../src/main/localCache'

const FAST = { memoryKib: 1024, iterations: 1, lanes: 1 }
const file = (): Uint8Array => VaultFile.create(FAST).toBytes()
const same = (a: Uint8Array | null | undefined, b: Uint8Array): boolean => Boolean(a) && equalBytes(a!, b)

let root: string
let backend: LocalFolderBackend
let clock: { now: number }
let backups: { count: number }

const make = (): Repository =>
  new Repository(backend, new LocalCache(join(root, 'cache'), 'account-1'), () => backups.count, () => clock.now)

function offline(on = true): void {
  const flag = join(root, 'drive', 'OFFLINE')
  if (on) {
    mkdirSync(join(root, 'drive'), { recursive: true })
    writeFileSync(flag, '')
  } else {
    rmSync(flag)
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'okpass-repo-'))
  backend = new LocalFolderBackend(join(root, 'drive'))
  clock = { now: 1_000_000 }
  backups = { count: 3 }
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('repository', () => {
  it('has no vault on the first run', async () => {
    expect(await make().load()).toBeNull()
  })

  it('saves and loads again', async () => {
    const repo = make()
    await repo.load()
    const data = file()
    expect(await repo.save(data)).toBe('saved')
    expect(same(await make().load(), data)).toBe(true)
  })

  it('keeps offline saves pending and uploads them later', async () => {
    const repo = make()
    await repo.load()
    offline()
    const data = file()
    expect(await repo.save(data)).toBe('pending')
    expect(repo.pending).toBe(true)
    expect(repo.online).toBe(false)
    offline(false)
    expect(await repo.retry()).toBe('saved')
    expect(same((await backend.downloadVault())?.data, data)).toBe(true)
  })

  it('uses the cache when starting offline', async () => {
    const repo = make()
    await repo.load()
    const data = file()
    await repo.save(data)
    offline()
    const again = make()
    expect(same(await again.load(), data)).toBe(true)
    expect(again.online).toBe(false)
  })

  it('fails when offline without a cache', async () => {
    offline()
    await expect(make().load()).rejects.toBeInstanceOf(NoDataError)
  })

  it('uploads pending changes on the next start', async () => {
    const repo = make()
    await repo.load()
    await repo.save(file())
    offline()
    const newer = file()
    await repo.save(newer)
    offline(false)
    expect(same(await make().load(), newer)).toBe(true)
    expect(same((await backend.downloadVault())?.data, newer)).toBe(true)
  })

  it('keeps local changes on conflict and backs up the remote file', async () => {
    const repo = make()
    await repo.load()
    await repo.save(file())
    offline()
    const local = file()
    await repo.save(local)
    offline(false)
    await backend.uploadVault(file())
    expect(same(await make().load(), local)).toBe(true)
    expect((await backend.listBackups()).some((b) => b.name.includes('conflict'))).toBe(true)
  })

  it('throttles and prunes backups', async () => {
    const repo = make()
    await repo.load()
    await repo.save(file())
    expect(await backend.listBackups()).toEqual([])
    for (let i = 0; i < 5; i++) {
      await repo.save(file())
      clock.now += BACKUP_INTERVAL
    }
    expect(await backend.listBackups()).toHaveLength(3)
    await repo.save(file())
    await repo.save(file())
    expect((await backend.listBackups()).length).toBeLessThanOrEqual(3)
  })

  it('makes no backups when the count is 0', async () => {
    backups.count = 0
    const repo = make()
    await repo.load()
    await repo.save(file())
    await repo.save(file())
    expect(await backend.listBackups()).toEqual([])
  })

  it('validates and backs up on replace', async () => {
    const repo = make()
    await repo.load()
    await repo.save(file())
    await expect(repo.replace(utf8('not a vault'))).rejects.toBeInstanceOf(FormatError)
    const other = file()
    expect(await repo.replace(other)).toBe('saved')
    expect(same((await backend.downloadVault())?.data, other)).toBe(true)
    expect(await backend.listBackups()).toHaveLength(1)
  })

  it('restores the newest backup', async () => {
    const repo = make()
    await repo.load()
    const first = file()
    await repo.save(first)
    await repo.save(file())
    const [newest] = await repo.listBackups()
    expect(await repo.restoreBackup(newest.id)).toBe('saved')
    expect(same((await backend.downloadVault())?.data, first)).toBe(true)
  })
})
