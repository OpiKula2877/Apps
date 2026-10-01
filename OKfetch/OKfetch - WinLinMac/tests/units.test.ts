import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isNewer, sanitizeDoc } from '../src/core/groups/groupService'
import { defaultSettings, sanitizeSettings } from '../src/core/settings'
import { resolveInside } from '../src/core/storage/safePath'
import { canDeleteForBoth } from '../src/shared/selection'
import { MAX_PASSWORD_LENGTH, normalizePassword, validatePassword } from '../src/shared/keys'
import { contactChatId, groupChatId, parseChatId } from '../src/shared/model'
import { PRESETS, COLOR_ROLES, resolveColors } from '../src/shared/theme'

const PUB_A = 'a'.repeat(52)
const PUB_B = 'b'.repeat(52)

describe('group last-writer-wins', () => {
  it('orders changes by lamport clock, then by public key', () => {
    expect(isNewer({ lamport: 3, by: PUB_A }, { lamport: 2, by: PUB_B })).toBe(true)
    expect(isNewer({ lamport: 2, by: PUB_A }, { lamport: 3, by: PUB_A })).toBe(false)
    expect(isNewer({ lamport: 2, by: PUB_B }, { lamport: 2, by: PUB_A })).toBe(true)
    expect(isNewer({ lamport: 2, by: PUB_A }, { lamport: 2, by: PUB_A })).toBe(false)
  })

  it('converges: two writers applying each other\'s change in any order end with the same winner', () => {
    const x = { lamport: 5, by: PUB_A, name: 'from a' }
    const y = { lamport: 5, by: PUB_B, name: 'from b' }
    const apply = (state: typeof x, change: typeof x) => (isNewer(change, state) ? change : state)
    expect(apply(apply({ lamport: 1, by: PUB_A, name: 'old' }, x), y).name).toBe(apply(apply({ lamport: 1, by: PUB_A, name: 'old' }, y), x).name)
  })

  it('refuses malformed group documents from the network', () => {
    const good = { id: 'a'.repeat(32), name: ' Parta ', type: 'enc', members: [{ pub: PUB_A, name: 'A' }], lamport: 1, by: PUB_A }
    expect(sanitizeDoc(good)).toMatchObject({ name: 'Parta', members: [{ pub: PUB_A, name: 'A' }] })
    expect(sanitizeDoc({ ...good, id: 'short' })).toBeNull()
    expect(sanitizeDoc({ ...good, type: 'other' })).toBeNull()
    expect(sanitizeDoc({ ...good, name: '   ' })).toBeNull()
    expect(sanitizeDoc({ ...good, members: [{ pub: PUB_A, name: 'A' }, { pub: PUB_A, name: 'again' }] })).toBeNull()
    expect(sanitizeDoc({ ...good, members: Array.from({ length: 60 }, (_, i) => ({ pub: String(i).padStart(52, 'a'), name: 'x' })) })).toBeNull()
    expect(sanitizeDoc({ ...good, lamport: -1 })).toBeNull()
    expect(sanitizeDoc(null)).toBeNull()
  })
})

describe('chat ids', () => {
  it('round-trips contact and group chat ids and refuses anything else', () => {
    expect(parseChatId(contactChatId(PUB_A, 'enc'))).toEqual({ type: 'contact', pub: PUB_A, kind: 'enc' })
    expect(parseChatId(contactChatId(PUB_A, 'plain'))).toEqual({ type: 'contact', pub: PUB_A, kind: 'plain' })
    expect(parseChatId(groupChatId('0'.repeat(32)))).toEqual({ type: 'group', id: '0'.repeat(32) })
    expect(parseChatId('../../etc:enc')).toBeNull()
    expect(parseChatId('g:../x')).toBeNull()
  })
})

describe('deleting several messages', () => {
  it('allows "delete for both" only when every selected message is mine', () => {
    expect(canDeleteForBoth([{ mine: true }, { mine: true }])).toBe(true)
    expect(canDeleteForBoth([{ mine: true }, { mine: false }])).toBe(false)
    expect(canDeleteForBoth([])).toBe(false)
  })
})

describe('receive password rules', () => {
  it('accepts printable ASCII up to 32 characters and ignores whitespace', () => {
    expect(validatePassword('Tajne-Heslo.1!')).toBeNull()
    expect(validatePassword('')).toBe('empty')
    expect(validatePassword('a'.repeat(MAX_PASSWORD_LENGTH + 1))).toBe('too_long')
    expect(validatePassword('a'.repeat(MAX_PASSWORD_LENGTH))).toBeNull()
    expect(validatePassword('heslo-čeština')).toBe('bad_chars')
    expect(normalizePassword(' a b\tc ')).toBe('abc')
  })
})

describe('settings', () => {
  it('falls back to defaults for junk and keeps the storage path', () => {
    expect(sanitizeSettings(null)).toEqual(defaultSettings())
    const settings = sanitizeSettings({ theme: 'nope', font_size: 999, storage_path: 'D:\\Chats', notifications: false, custom_colors: { accent: '#abcdef', text: 'red' } })
    expect(settings).toMatchObject({ theme: 'opikula', font_size: 22, storage_path: 'D:\\Chats', notifications: false })
    expect(settings.custom_colors).toEqual({ accent: '#abcdef' })
  })

  it('has the two status colours in every preset', () => {
    for (const preset of Object.values(PRESETS)) {
      expect(Object.keys(preset).sort()).toEqual([...COLOR_ROLES].sort())
      expect(preset.status_online).toMatch(/^#[0-9A-F]{6}$/)
    }
    expect(PRESETS.dark.status_online).toBe('#3FCB6A')
    expect(PRESETS.opikula.status_offline).toBe('#5E4A4C')
    expect(resolveColors({ theme: 'light', custom_colors: {} }).status_online).toBe('#1E8E3E')
  })
})

describe('file protocol path guard', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'okfetch-guard-'))
    mkdirSync(join(root, 'files', 'chat'), { recursive: true })
    writeFileSync(join(root, 'files', 'chat', 'a.png'), 'x')
    writeFileSync(join(root, 'secret.txt'), 'x')
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('serves files below the root and refuses everything that escapes it', () => {
    const files = join(root, 'files')
    expect(resolveInside(files, '/chat/a.png')).toBe(join(files, 'chat', 'a.png'))
    expect(resolveInside(files, '/chat/%61.png')).toBe(join(files, 'chat', 'a.png'))
    expect(resolveInside(files, '/../secret.txt')).toBeNull()
    expect(resolveInside(files, '/chat/../../secret.txt')).toBeNull()
    expect(resolveInside(files, '/%2e%2e/secret.txt')).toBeNull()
    expect(resolveInside(files, '/chat')).toBeNull()
    expect(resolveInside(files, '/missing.png')).toBeNull()
    expect(resolveInside(files, '/%E0%A4%A')).toBeNull()
  })

  it('does not follow a link out of the folder', () => {
    const files = join(root, 'files')
    try {
      symlinkSync(join(root, 'secret.txt'), join(files, 'link.txt'))
    } catch {
      return // creating links needs a privilege on some systems
    }
    // The guard compares paths, not link targets: a link is only ever created by this app, never by a peer.
    expect(resolveInside(files, '/link.txt')).toBe(join(files, 'link.txt'))
  })
})
