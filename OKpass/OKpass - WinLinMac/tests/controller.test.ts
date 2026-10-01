import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Controller } from '../src/core/controller'
import type { BiometricAdapter, UiBridge } from '../src/core/platform'
import { VaultFile } from '../src/core/vaultFile'
import { createNodePlatform } from '../src/main/nodePlatform'
import type { Message, SaveState, Screen } from '../src/shared/ipc'

const FAST = { memoryKib: 1024, iterations: 1, lanes: 1 }

let root: string
let screens: Screen[]
let statuses: SaveState[]
let messages: Message[]
let ui: UiBridge

const last = (): Screen => screens[screens.length - 1]
const vaultScreen = () => {
  const s = last()
  if (s.name !== 'vault') throw new Error(`expected vault screen, got ${s.name}`)
  return s
}

let biometric: BiometricAdapter | undefined

/** Fingerprint stand-in that keeps the secret in memory. */
function fakeBiometric(): BiometricAdapter {
  let stored: Uint8Array | null = null
  return {
    available: async () => true,
    enabled: async () => stored !== null,
    store: async (secret) => ((stored = secret), true),
    unlock: async () => stored,
    clear: async () => void (stored = null)
  }
}

async function started(): Promise<Controller> {
  const platform = createNodePlatform({
      ui,
      devFolder: join(root, 'drive'),
      openExternal: async () => {},
      pickFile: async () => null,
      saveFile: async () => null,
      writeClipboard: () => {},
      kdfParams: FAST
    })
  platform.biometric = biometric
  const c = new Controller(platform)
  await c.start()
  return c
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'okpass-ctl-'))
  process.env.OKPASS_CONFIG_DIR = join(root, 'cfg')
  process.env.OKPASS_CACHE_DIR = join(root, 'cache')
  screens = []
  statuses = []
  messages = []
  biometric = undefined
  ui = {
    sendScreen: (s) => screens.push(s),
    sendStatus: (s) => statuses.push(s),
    sendMessage: (m) => messages.push(m)
  }
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('controller', () => {
  it('creates a vault on the first run and reopens it with the key', async () => {
    const c = await started()
    expect(last()).toMatchObject({ name: 'key', create: true, email: 'local-dev@okpass' })
    await c.submitKey('Main.Key-1')
    const v = vaultScreen()
    expect(v.vault.username).toBe('Local Dev')
    await c.saveVault({ ...v.vault, username: 'Opi', documents: [{ id: 'd1', title: 'Plán', html: '<p>x</p>', created: 1, modified: 2 }] })
    await c.lock()
    expect(last()).toMatchObject({ name: 'key', create: false })
    await c.submitKey('Main.Key-1')
    expect(vaultScreen().vault.username).toBe('Opi')
    expect(vaultScreen().vault.documents[0].title).toBe('Plán')
  })

  it('shows fake data for a wrong key and never writes', async () => {
    const c = await started()
    await c.submitKey('Main.Key-1')
    await c.lock()
    await c.submitKey('wrong')
    const fake = vaultScreen().vault
    expect(fake.documents.length).toBeGreaterThan(0)
    expect(await c.saveVault({ ...fake, username: 'hacked' })).toBe('saved')
    await c.lock()
    await c.submitKey('Main.Key-1')
    expect(vaultScreen().vault.username).toBe('Local Dev')
  })

  it('saves pending while offline and uploads after retry', async () => {
    const c = await started()
    await c.submitKey('Main.Key-1')
    writeFileSync(join(root, 'drive', 'OFFLINE'), '')
    expect(await c.saveVault({ ...vaultScreen().vault, username: 'Offline edit' })).toBe('pending')
    expect(statuses).toContain('pending')
    rmSync(join(root, 'drive', 'OFFLINE'))
    expect(await c.retryNow()).toBe('saved')
  })

  it('shows a connection error when offline without a local copy', async () => {
    mkdirSync(join(root, 'drive'), { recursive: true })
    writeFileSync(join(root, 'drive', 'OFFLINE'), '')
    await started()
    expect(last()).toMatchObject({ name: 'login', connectError: true, message: { key: 'login.offline_no_data' } })
  })

  it('sets a decoy key that opens its own vault', async () => {
    const c = await started()
    await c.submitKey('Main.Key-1')
    expect(await c.setDecoy('Decoy.Key')).toBeNull()
    expect(await c.setDecoy('Main.Key-1')).toBe('same_as_main')
    await c.lock()
    await c.submitKey('Decoy.Key')
    expect(vaultScreen().vault.decoySet).toBe(false)
    await c.lock()
    await c.submitKey('Main.Key-1')
    expect(vaultScreen().vault.decoySet).toBe(true)
  })

  it('asks before logging out with changes that were not uploaded', async () => {
    const c = await started()
    await c.submitKey('Main.Key-1')
    writeFileSync(join(root, 'drive', 'OFFLINE'), '')
    await c.saveVault({ ...vaultScreen().vault, username: 'x' })
    expect(await c.logout()).toBe('pending')
    rmSync(join(root, 'drive', 'OFFLINE'))
    expect(await c.logout(undefined, true)).toBe('done')
  })

  it('keeps renamed default field labels', async () => {
    const c = await started()
    await c.submitKey('Main.Key-1')
    const vault = vaultScreen().vault
    vault.passwords.push({
      id: 'p1', created: 1, modified: 1,
      fields: [
        { id: 'a', kind: 'title', name: 'Web', value: 'a.cz' },
        { id: 'b', kind: 'username', name: null, value: 'me' },
        { id: 'c', kind: 'password', name: 'PIN karty', value: '1234' }
      ]
    })
    await c.saveVault(vault)
    await c.lock()
    await c.submitKey('Main.Key-1')
    const fields = vaultScreen().vault.passwords[0].fields
    expect(fields.map((f) => f.name)).toEqual(['Web', null, 'PIN karty'])
  })

  it('unlocks with the fingerprint the vault it was turned on in', async () => {
    biometric = fakeBiometric()
    const c = await started()
    await c.submitKey('Main.Key-1')
    await c.saveVault({ ...vaultScreen().vault, username: 'Real' })
    expect(await c.setBiometric(true)).toBe(true)
    await c.lock()
    expect(last()).toMatchObject({ name: 'key', biometric: true })
    await c.unlockBiometric()
    expect(vaultScreen().vault.username).toBe('Real')
  })

  it('switches the fingerprint off when the vault file was replaced', async () => {
    biometric = fakeBiometric()
    const c = await started()
    await c.submitKey('Main.Key-1')
    await c.setBiometric(true)
    expect(await c.importVault(VaultFile.create(FAST).toBytes())).toBe('ok')
    await c.unlockBiometric()
    expect(last()).toMatchObject({ name: 'key', biometric: false })
    expect(messages.some((m) => m.key === 'bio.changed')).toBe(true)
    expect(await biometric.enabled()).toBe(false)
  })
})
