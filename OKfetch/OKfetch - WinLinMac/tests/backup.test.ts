// Backup and restore of the storage folder (password-encrypted .okfb file).
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { restoreBackup, writeArchive, writeBackup } from '../src/core/backup'
import { randomBytes } from '../src/core/sodium'
import type { KeyProtector } from '../src/core/state'
import { createDataKeyProtector } from '../src/mobile/keyProtector'

const FAST = { memoryKib: 1024, iterations: 1, lanes: 1 }
const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'okfetch-backup-'))
  dirs.push(dir)
  return dir
}

function write(path: string, data: string | Uint8Array): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, data)
}

/** A storage folder like the core leaves it, with secrets protected by `protector`. */
function sampleRoot(protector: KeyProtector): string {
  const root = join(tempDir(), 'okfetch')
  write(join(root, 'identity.json'), JSON.stringify({ publicKey: 'ab'.repeat(32), secretBlob: protector.protect('identity-secret') }))
  write(join(root, 'profile.json'), JSON.stringify({ username: 'Pepa', avatar: null, kBlob: protector.protect('k-secret'), lamport: 4 }))
  write(join(root, 'contacts.json'), JSON.stringify({ contacts: [{ pub: 'x'.repeat(52), name: 'Bee', keyBlob: protector.protect('contact-key') }], incoming: [], outgoing: [] }))
  write(join(root, 'groups.json'), JSON.stringify([{ id: 'g1', keyBlob: null }]))
  write(join(root, 'chats', 'xx_enc', 'messages.jsonl'), '{"k":"m","id":"1","html":"tajna zprava"}\n')
  write(join(root, 'files', 'xx_enc', '1_obrazek.png'), randomBytes(200_000))
  write(join(root, 'outgoing', 'photo.jpg'), 'not in the backup')
  write(join(root, 'profile.json.tmp'), 'half-written')
  return root
}

describe('backup', () => {
  it('restores everything on another device, with the secrets protected by that device', () => {
    const phoneA = createDataKeyProtector(randomBytes(32))
    const phoneB = createDataKeyProtector(randomBytes(32))
    const root = sampleRoot(phoneA)
    const file = join(tempDir(), 'zaloha.okfb')
    writeBackup(root, phoneA, 'heslo zalohy', file, { withFiles: true, kdf: FAST })

    const target = join(tempDir(), 'okfetch')
    expect(restoreBackup(file, 'heslo zalohy', target, phoneB)).toEqual({ ok: true })

    const identity = JSON.parse(readFileSync(join(target, 'identity.json'), 'utf8'))
    expect(identity.secretBlob.startsWith('dk:')).toBe(true)
    expect(phoneB.unprotect(identity.secretBlob)).toBe('identity-secret')
    const profile = JSON.parse(readFileSync(join(target, 'profile.json'), 'utf8'))
    expect(phoneB.unprotect(profile.kBlob)).toBe('k-secret')
    expect(profile.username).toBe('Pepa')
    const contacts = JSON.parse(readFileSync(join(target, 'contacts.json'), 'utf8'))
    expect(phoneB.unprotect(contacts.contacts[0].keyBlob)).toBe('contact-key')
    expect(JSON.parse(readFileSync(join(target, 'groups.json'), 'utf8'))).toEqual([{ id: 'g1', keyBlob: null }])
    expect(readFileSync(join(target, 'chats', 'xx_enc', 'messages.jsonl'), 'utf8')).toContain('tajna zprava')
    expect(readFileSync(join(target, 'files', 'xx_enc', '1_obrazek.png'))).toEqual(readFileSync(join(root, 'files', 'xx_enc', '1_obrazek.png')))
    expect(existsSync(join(target, 'outgoing'))).toBe(false)
    expect(existsSync(join(target, 'profile.json.tmp'))).toBe(false)
  })

  it('leaves received files out unless asked', () => {
    const protector = createDataKeyProtector(randomBytes(32))
    const root = sampleRoot(protector)
    const file = join(tempDir(), 'zaloha.okfb')
    writeBackup(root, protector, 'pw', file, { withFiles: false, kdf: FAST })
    expect(statSync(file).size).toBeLessThan(50_000)
    const target = join(tempDir(), 'okfetch')
    expect(restoreBackup(file, 'pw', target, protector)).toEqual({ ok: true })
    expect(existsSync(join(target, 'files'))).toBe(false)
    expect(existsSync(join(target, 'chats', 'xx_enc', 'messages.jsonl'))).toBe(true)
  })

  it('keeps secrets and messages unreadable inside the file', () => {
    const protector = createDataKeyProtector(randomBytes(32))
    const root = sampleRoot(protector)
    const file = join(tempDir(), 'zaloha.okfb')
    writeBackup(root, protector, 'pw', file, { withFiles: false, kdf: FAST })
    const raw = readFileSync(file).toString('latin1')
    for (const secret of ['identity-secret', 'contact-key', 'tajna zprava', 'Pepa', 'plain:']) expect(raw.includes(secret)).toBe(false)
  })

  it('replaces the current data, and a wrong password or a damaged file leaves it untouched', () => {
    const protector = createDataKeyProtector(randomBytes(32))
    const file = join(tempDir(), 'zaloha.okfb')
    writeBackup(sampleRoot(protector), protector, 'right', file, { withFiles: false, kdf: FAST })

    const current = join(tempDir(), 'okfetch')
    write(join(current, 'identity.json'), '{"publicKey":"current"}')
    write(join(current, 'chats', 'old', 'messages.jsonl'), 'old chat\n')

    expect(restoreBackup(file, 'wrong', current, protector)).toEqual({ ok: false, error: 'wrong_password' })
    expect(readFileSync(join(current, 'identity.json'), 'utf8')).toBe('{"publicKey":"current"}')

    const cut = join(tempDir(), 'cut.okfb')
    writeFileSync(cut, readFileSync(file))
    truncateSync(cut, statSync(cut).size - 10)
    expect(restoreBackup(cut, 'right', current, protector)).toEqual({ ok: false, error: 'damaged' })
    expect(readFileSync(join(current, 'identity.json'), 'utf8')).toBe('{"publicKey":"current"}')

    const notBackup = join(tempDir(), 'photo.jpg')
    writeFileSync(notBackup, randomBytes(500))
    expect(restoreBackup(notBackup, 'right', current, protector)).toEqual({ ok: false, error: 'damaged' })

    expect(restoreBackup(file, 'right', current, protector)).toEqual({ ok: true })
    expect(existsSync(join(current, 'chats', 'old'))).toBe(false)
    expect(existsSync(join(current, 'chats', 'xx_enc', 'messages.jsonl'))).toBe(true)
  })

  it('refuses entries that would land outside the storage folder', () => {
    const protector = createDataKeyProtector(randomBytes(32))
    const base = tempDir()
    for (const name of ['../evil.txt', '/abs.txt', 'a/../../evil.txt', 'C:\\evil.txt', 'chats\\..\\..\\evil.txt', '']) {
      const file = join(base, 'bad.okfb')
      writeArchive(file, 'pw', FAST, [{ name: 'identity.json', data: Buffer.from('{}') }, { name, data: Buffer.from('x') }])
      const target = join(base, 'restore', 'okfetch')
      expect(restoreBackup(file, 'pw', target, protector)).toEqual({ ok: false, error: 'damaged' })
      expect(existsSync(join(base, 'restore', 'evil.txt'))).toBe(false)
      expect(existsSync(join(base, 'evil.txt'))).toBe(false)
      expect(existsSync(target)).toBe(false)
    }
  })

  it('needs an identity in the backup', () => {
    const protector = createDataKeyProtector(randomBytes(32))
    const file = join(tempDir(), 'empty.okfb')
    writeArchive(file, 'pw', FAST, [{ name: 'profile.json', data: Buffer.from('{}') }])
    expect(restoreBackup(file, 'pw', join(tempDir(), 'okfetch'), protector)).toEqual({ ok: false, error: 'damaged' })
  })
})
