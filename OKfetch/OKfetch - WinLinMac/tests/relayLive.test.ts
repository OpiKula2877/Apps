// Manual check against the real public Nostr relays (needs the internet, so it is off by default):
//   OKFETCH_LIVE_RELAYS=1 npx vitest run tests/relayLive.test.ts
// Two cores on separate local DHTs (as two devices behind random-port NATs) reach each other only through the
// default relays: contact request, accept, messages both ways and a file.
import createTestnet from 'hyperdht/testnet'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Core } from '../src/core/controller'
import { webSocketFactory } from '../src/core/network/relay/webSocket'
import { DEFAULT_RELAYS } from '../src/core/settings'
import { randomBytes } from '../src/core/sodium'
import { contactChatId } from '../src/shared/model'

const FAST = { memoryKib: 1024, iterations: 1, lanes: 1 }

async function until(check: () => boolean, ms: number): Promise<void> {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error(`timeout: ${check.toString()}`)
    await new Promise((r) => setTimeout(r, 100))
  }
}

describe.runIf(process.env.OKFETCH_LIVE_RELAYS === '1')('public relays', () => {
  it('connects two devices that the DHT cannot connect', async () => {
    const nets = [await createTestnet(3), await createTestnet(3)]
    const dirs = [0, 1].map(() => mkdtempSync(join(tmpdir(), 'okfetch-live-')))
    const relay = { urls: DEFAULT_RELAYS, socket: webSocketFactory, only: true }
    const [phone, desktop] = await Promise.all(
      [0, 1].map((i) => Core.open({ root: dirs[i], bootstrap: nets[i].bootstrap, kdf: FAST, retryMs: 2000, relay }))
    )
    try {
      await until(() => (phone.net.diagnostics().relay?.connected ?? 0) > 0 && (desktop.net.diagnostics().relay?.connected ?? 0) > 0, 20_000)
      console.log('relays', phone.net.diagnostics().relay)

      let t = Date.now()
      await desktop.contacts.setPassword('pc-heslo')
      expect(await phone.contacts.add(desktop.me, 'pc-heslo', 'PC')).toEqual({ ok: true })
      await until(() => desktop.contacts.incoming().some((r) => r.pub === phone.me), 60_000)
      console.log(`request arrived in ${Date.now() - t} ms`)
      expect(desktop.contacts.accept(phone.me, 'Telefon')).toBe(true)
      await until(() => phone.contacts.list().some((c) => c.pub === desktop.me && c.online), 60_000)
      expect(phone.contacts.list()[0].via).toBe('relay')

      t = Date.now()
      const enc = contactChatId(desktop.me, 'enc')
      expect((await phone.messages.send(enc, '<p>přes veřejné relay</p>')).ok).toBe(true)
      await until(() => phone.messages.list(enc)[0]?.status === 'delivered', 30_000)
      console.log(`message delivered in ${Date.now() - t} ms`)
      const back = contactChatId(phone.me, 'enc')
      expect((await desktop.messages.send(back, '<p>odpověď</p>')).ok).toBe(true)
      await until(() => phone.messages.list(enc).some((m) => m.html === '<p>odpověď</p>'), 30_000)

      t = Date.now()
      const source = join(dirs[0], 'fotka.bin')
      const bytes = randomBytes(300_000)
      writeFileSync(source, bytes)
      const sent = await phone.transfers.sendFile(enc, source)
      expect(sent.ok).toBe(true)
      const fileId = (sent as { id: string }).id
      await until(() => desktop.messages.list(back).some((m) => m.id === fileId), 30_000)
      expect(desktop.transfers.accept(back, fileId)).toBe(true)
      await until(() => desktop.messages.list(back).some((m) => m.id === fileId && m.file?.state === 'done'), 90_000)
      console.log(`300 KB file in ${Date.now() - t} ms`)
      const rel = desktop.messages.list(back).find((m) => m.id === fileId)!.file!.rel!
      expect(Buffer.compare(readFileSync(join(desktop.filesRoot, ...rel.split('/'))), bytes)).toBe(0)
    } finally {
      await Promise.all([phone.close(), desktop.close()])
      await Promise.all(nets.map((n) => n.destroy()))
      for (const d of dirs) rmSync(d, { recursive: true, force: true })
    }
  }, 300_000)
})
