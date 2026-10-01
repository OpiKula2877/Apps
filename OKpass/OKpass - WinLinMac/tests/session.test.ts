import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { equalBytes, fromUtf8, utf8 } from '../src/core/bytes'
import { generateVault } from '../src/core/fake'
import { VaultFile } from '../src/core/vaultFile'
import { Session, type Owner } from '../src/core/session'
import { vaultFromJson, vaultToJson, toData } from '../src/core/vault'
import { newDocument, newEntry, setFieldName } from '../src/shared/model'

const FAST = { memoryKib: 1024, iterations: 1, lanes: 1 }
const OWNER: Owner = { name: 'Opi', email: 'opi@example.com' }
const fixtureDir = join(__dirname, 'fixtures')

async function save(session: Session): Promise<VaultFile> {
  const data = await session.encrypt()
  expect(data).not.toBeNull()
  return VaultFile.parse(data!)
}

async function realFile(key = 'Main.Key-1'): Promise<VaultFile> {
  const session = await Session.createNew(key, OWNER, FAST)
  const doc = newDocument('Tajné')
  doc.html = '<p>obsah</p>'
  session.vault.documents.push(doc)
  const entry = newEntry()
  entry.fields[0].value = 'example.com'
  session.vault.passwords.push(entry)
  return save(session)
}

describe('session', () => {
  it('opens real data with the correct key', async () => {
    const s = await Session.unlock(await realFile(), 'Main.Key-1', OWNER)
    expect(s.writes).toBe(true)
    expect(s.vault.username).toBe('Opi')
    expect(s.vault.documents[0].title).toBe('Tajné')
    expect(s.vault.passwords[0].fields[0].value).toBe('example.com')
  })

  it('ignores spaces in the key', async () => {
    const s = await Session.unlock(await realFile(), ' Main.Key -1 ', OWNER)
    expect(s.vault.username).toBe('Opi')
  })

  it('gives stable fake data for a wrong key and never writes', async () => {
    const vf = await realFile()
    const first = await Session.unlock(vf, 'wrong', OWNER)
    const second = await Session.unlock(vf, 'wrong', OWNER)
    expect(first.writes).toBe(false)
    expect(toData(first.vault)).toEqual(toData(second.vault))
    expect(first.vault.documents.length).toBeGreaterThan(0)
    expect(first.vault.passwords.length).toBeGreaterThan(0)
    expect(await first.encrypt()).toBeNull()
    const other = await Session.unlock(vf, 'other-wrong', OWNER)
    expect(toData(other.vault)).not.toEqual(toData(first.vault))
  })

  it('changes both slots on every save', async () => {
    const vf = await realFile()
    const after = await save(await Session.unlock(vf, 'Main.Key-1', OWNER))
    expect(equalBytes(after.slots[0], vf.slots[0])).toBe(false)
    expect(equalBytes(after.slots[1], vf.slots[1])).toBe(false)
    expect(after.slots[0].length).toBe(after.slots[1].length)
  })

  it('opens a separate editable decoy vault', async () => {
    let vf = await realFile()
    let real = await Session.unlock(vf, 'Main.Key-1', OWNER)
    expect(await real.setDecoy('Decoy!')).toBeNull()
    vf = await save(real)
    const decoy = await Session.unlock(vf, 'Decoy!', OWNER)
    expect(decoy.writes).toBe(true)
    expect(decoy.vault.decoySet).toBe(false)
    decoy.vault.username = 'Changed in decoy'
    vf = await save(decoy)
    real = await Session.unlock(vf, 'Main.Key-1', OWNER)
    expect(real.vault.username).toBe('Opi')
    vf = await save(real)
    expect((await Session.unlock(vf, 'Decoy!', OWNER)).vault.username).toBe('Changed in decoy')
  })

  it('never lets a decoy session damage the real slot', async () => {
    let vf = await realFile()
    const real = await Session.unlock(vf, 'Main.Key-1', OWNER)
    await real.setDecoy('Decoy!')
    vf = await save(real)
    let decoy = await Session.unlock(vf, 'Decoy!', OWNER)
    expect(await decoy.setDecoy('Main.Key-1')).toBeNull()
    vf = await save(decoy)
    decoy = await Session.unlock(vf, 'Decoy!', OWNER)
    await decoy.removeDecoy()
    vf = await save(decoy)
    expect((await Session.unlock(vf, 'Main.Key-1', OWNER)).vault.username).toBe('Opi')
  })

  it('refuses the main key as the second key', async () => {
    const real = await Session.unlock(await realFile(), 'Main.Key-1', OWNER)
    expect(await real.setDecoy('Main Key-1'.replace(' ', '.'))).toBe('same_as_main')
  })

  it('turns a removed decoy key into a fake key', async () => {
    let vf = await realFile()
    let real = await Session.unlock(vf, 'Main.Key-1', OWNER)
    await real.setDecoy('Decoy!')
    vf = await save(real)
    real = await Session.unlock(vf, 'Main.Key-1', OWNER)
    await real.removeDecoy()
    vf = await save(real)
    expect((await Session.unlock(vf, 'Decoy!', OWNER)).writes).toBe(false)
    expect((await Session.unlock(vf, 'Main.Key-1', OWNER)).writes).toBe(true)
  })

  it('keeps decoy actions harmless in a fake session', async () => {
    const fake = await Session.unlock(await realFile(), 'nope', OWNER)
    expect(await fake.setDecoy('anything')).toBeNull()
    await fake.removeDecoy()
    expect(await fake.encrypt()).toBeNull()
  })
})

describe('fake data', () => {
  it('is deterministic per seed', () => {
    const seed = new Uint8Array(randomBytes(32))
    expect(toData(generateVault(seed, '', ''))).toEqual(toData(generateVault(seed, '', '')))
    expect(toData(generateVault(new Uint8Array(randomBytes(32)), '', ''))).not.toEqual(toData(generateVault(seed, '', '')))
  })

  it('matches the account owner', () => {
    const vault = generateVault(new Uint8Array(randomBytes(32)), 'Opi Kula', 'opi.kula@gmail.com')
    expect(vault.username).toBe('Opi Kula')
  })

  it('only uses past dates', () => {
    for (let i = 0; i < 50; i++) {
      const v = generateVault(new Uint8Array(randomBytes(32)), '', '')
      const stamps = [...v.documents.map((d) => d.modified), ...v.passwords.map((p) => p.modified)]
      expect(Math.max(...stamps)).toBeLessThan(1767225600)
    }
  })
})

describe('renaming default fields', () => {
  it('stores a custom label and clears back to the default', () => {
    const entry = newEntry()
    const renamed = setFieldName(entry.fields[2], 'PIN karty')
    expect(renamed.name).toBe('PIN karty')
    expect(renamed.kind).toBe('password')
    expect(setFieldName(renamed, '   ').name).toBeNull()
    expect(setFieldName({ ...entry.fields[0], kind: 'custom' }, '').name).toBe('')
  })

  it('survives a JSON round trip', () => {
    const vault = vaultFromJson(utf8(JSON.stringify({ passwords: [{ fields: [{ kind: 'title', name: 'Web', value: 'a.cz' }] }] })))
    const fields = vault.passwords[0].fields
    expect(fields.map((f) => f.kind)).toEqual(['title', 'username', 'password'])
    expect(fields[0].name).toBe('Web')
    expect(vaultFromJson(vaultToJson(vault)).passwords[0].fields[0].name).toBe('Web')
  })
})

describe('vault written by the Python version', () => {
  const data = new Uint8Array(readFileSync(join(fixtureDir, 'python-vault.okp')))
  const expected = JSON.parse(readFileSync(join(fixtureDir, 'python-vault.json'), 'utf8'))
  const owner: Owner = { name: 'Opi Kula', email: 'opi@example.com' }

  it('opens the real content', async () => {
    const s = await Session.unlock(VaultFile.parse(data), expected.key, owner)
    expect(s.writes).toBe(true)
    const json = JSON.parse(fromUtf8(vaultToJson(s.vault)))
    delete json.partner
    expect(json).toEqual(expected.real)
  })

  it('opens the decoy and survives a save from this version', async () => {
    const real = await Session.unlock(VaultFile.parse(data), expected.key, owner)
    const vf = await save(real)
    const decoy = await Session.unlock(vf, expected.decoy_key, owner)
    expect(decoy.writes).toBe(true)
    expect(decoy.vault.username).toBe(expected.decoy_username)
    expect(decoy.vault.documents.map((d) => d.title)).toEqual(expected.decoy_documents)
    expect((await Session.unlock(vf, expected.wrong_key, owner)).writes).toBe(false)
  })
})
