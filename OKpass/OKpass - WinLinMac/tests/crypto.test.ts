import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { equalBytes, fromUtf8, utf8 } from '../src/core/bytes'
import { deriveMaster, normalizeKey, slotKeys, validateKey } from '../src/core/kdf'
import { BUCKET, FormatError, VaultFile, assemble, openSlot, sealBody } from '../src/core/vaultFile'

const FAST = { memoryKib: 1024, iterations: 1, lanes: 1 }
const fixture = join(__dirname, 'fixtures')

describe('key handling', () => {
  it('ignores spaces', () => {
    expect(normalizeKey(' ab c\td ')).toBe('abcd')
    expect(validateKey('a b')).toBeNull()
    expect(validateKey('x'.repeat(32) + '   ')).toBeNull()
  })

  it.each([
    ['', 'empty'],
    ['    ', 'empty'],
    ['x'.repeat(33), 'too_long'],
    ['klíč', 'bad_chars']
  ])('rejects %j as %s', (raw, code) => {
    expect(validateKey(raw)).toBe(code)
  })

  it('allows special characters', () => {
    expect(validateKey('Ab9.;-_!?*/`#@')).toBeNull()
  })
})

describe('vault file', () => {
  it('round-trips through bytes', () => {
    const vf = VaultFile.create(FAST)
    expect(equalBytes(VaultFile.parse(vf.toBytes()).toBytes(), vf.toBytes())).toBe(true)
    expect(vf.slotSize).toBe(BUCKET)
  })

  it('rejects garbage', () => {
    expect(() => VaultFile.parse(utf8('hello world'))).toThrow(FormatError)
    expect(() => VaultFile.parse(new Uint8Array(randomBytes(5000)))).toThrow(FormatError)
  })

  it('opens a slot only with its key', async () => {
    const vf = VaultFile.create(FAST)
    const keys = await slotKeys(new Uint8Array(randomBytes(32)))
    const other = await slotKeys(new Uint8Array(randomBytes(32)))
    const sealed = assemble(vf, new Map([[0, await sealBody(keys, vf.aad, utf8('secret data'))]]))
    expect(fromUtf8((await openSlot(keys, sealed.aad, sealed.slots[0]))!)).toBe('secret data')
    expect(await openSlot(other, sealed.aad, sealed.slots[0])).toBeNull()
    expect(await openSlot(keys, sealed.aad, sealed.slots[1])).toBeNull()
  })

  it('keeps both slots the same size when one grows', async () => {
    const vf = VaultFile.create(FAST)
    const keys = await slotKeys(new Uint8Array(randomBytes(32)))
    const big = new Uint8Array(randomBytes(BUCKET * 2))
    const grown = assemble(vf, new Map([[0, await sealBody(keys, vf.aad, big)]]))
    expect(grown.slots[0].length).toBe(BUCKET * 3)
    expect(grown.slots[1].length).toBe(BUCKET * 3)
    expect(equalBytes(grown.slots[1].subarray(0, BUCKET), vf.slots[1])).toBe(true)
    expect(equalBytes((await openSlot(keys, grown.aad, grown.slots[0]))!, big)).toBe(true)
  })
})

describe('compatibility with the Python version', () => {
  it('opens a vault written by Python with the same key', async () => {
    const data = new Uint8Array(readFileSync(join(fixture, 'python-vault.okp')))
    const expected = JSON.parse(readFileSync(join(fixture, 'python-vault.json'), 'utf8'))
    const vf = VaultFile.parse(data)
    expect(vf.params).toEqual(FAST)
    const keys = await slotKeys(await deriveMaster(expected.key, vf.salt, vf.params))
    const opened = (await Promise.all(vf.slots.map((slot) => openSlot(keys, vf.aad, slot)))).filter((p) => p !== null)
    expect(opened).toHaveLength(1)
    const json = JSON.parse(fromUtf8(opened[0]!))
    expect(json.profile.username).toBe('Opi Kula')
    expect(json.documents[0].title).toBe('Plán projektu')
  })
})
