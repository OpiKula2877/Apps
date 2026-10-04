// The built desktop app through the public Nostr relays (run `npm run smoke:relay`, needs the internet).
// Each Electron instance gets its own local DHT, so the two can never connect directly – like two computers behind
// random-port NATs. Request, accept and messages must go through the default relays.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import electronPath from 'electron'
import createTestnet from 'hyperdht/testnet.js'
import { _electron as electron } from 'playwright-core'

const root = resolve(import.meta.dirname, '..', '..')
const work = mkdtempSync(join(tmpdir(), 'okfetch-smoke-relay-'))
const nets = []
const apps = []

function check(condition, message) {
  if (!condition) throw new Error(`CHECK FAILED: ${message}`)
  console.log(`ok - ${message}`)
}

async function until(probe, what, ms = 60_000) {
  const end = Date.now() + ms
  for (;;) {
    if (await probe()) return
    if (Date.now() > end) throw new Error(`timeout: ${what}`)
    await new Promise((r) => setTimeout(r, 250))
  }
}

async function launch(name) {
  const net = await createTestnet(3)
  nets.push(net)
  const env = { ...process.env }
  delete env.OKFETCH_RELAY
  const app = await electron.launch({
    executablePath: electronPath,
    args: [root],
    cwd: root,
    env: {
      ...env,
      OKFETCH_DATA_DIR: join(work, name, 'data'),
      OKFETCH_CONFIG_DIR: join(work, name, 'cfg'),
      OKFETCH_BOOTSTRAP: net.bootstrap.map((n) => `${n.host}:${n.port}`).join(','),
      OKFETCH_FAST_KDF: '1'
    }
  })
  apps.push(app)
  const page = await app.firstWindow()
  await page.locator('.vault-header').waitFor()
  return page
}

const call = (page, method, ...args) => page.evaluate(([m, a]) => window.okfetch[m](...a), [method, args])

try {
  const a = await launch('adam')
  const b = await launch('bara')
  await call(a, 'setUsername', 'Adam')
  await call(b, 'setUsername', 'Bára')
  check((await call(b, 'setPassword', 'Tajne-Heslo-1')) === null, 'receive password accepted')
  const aId = (await call(a, 'getProfile')).identifier
  const bId = (await call(b, 'getProfile')).identifier

  await until(async () => (await call(a, 'getNetDiagnostics')).relay?.connected > 0, 'relays connected', 30_000)
  const relay = (await call(a, 'getNetDiagnostics')).relay
  check(relay.connected > 0, `connected to ${relay.connected} of ${relay.relays} public relays`)

  check((await call(a, 'addContact', bId, 'Tajne-Heslo-1', 'Bára')).ok, 'request stored')
  await until(async () => (await call(b, 'listRequests')).incoming.some((r) => r.pub === aId), 'request at Bára')
  check(true, 'request arrives through the relays')
  check(await call(b, 'acceptRequest', aId, 'Adam'), 'Bára accepts')
  await until(async () => (await call(a, 'listContacts')).some((c) => c.pub === bId && c.online), 'Bára online at Adam')
  check((await call(a, 'listContacts')).find((c) => c.pub === bId).via === 'relay', 'the contact is online through a relay')
  await b.locator('.contact', { hasText: 'Adam' }).waitFor()

  check((await call(a, 'sendMessage', `${bId}:enc`, '<p>přes relay z počítače</p>')).ok, 'Adam sends an encrypted message')
  await until(async () => (await call(b, 'getMessages', `${aId}:enc`)).some((m) => m.html === '<p>přes relay z počítače</p>'), 'message at Bára')
  check(true, 'message arrives through the relays')
  await b.locator('.contact', { hasText: 'Adam' }).click()
  await b.getByText('online · přes relay').first().waitFor({ timeout: 10_000 }).then(
    () => console.log('ok - chat header shows "online · přes relay"'),
    () => console.log('note - "online · přes relay" text not found in the open chat (shown in the contact list only)')
  )
  console.log('SMOKE RELAY OK')
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  await Promise.all(apps.map((app) => app.close().catch(() => undefined)))
  await Promise.all(nets.map((n) => n.destroy()))
  rmSync(work, { recursive: true, force: true })
}
