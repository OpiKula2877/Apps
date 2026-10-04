// The relay transport over a local Nostr relay: links open on both sides, carry data, survive a relay restart.
import { afterEach, describe, expect, it } from 'vitest'
import { createIdentity, toIdentifier, type Identity } from '../src/core/identity'
import type { RelayLink } from '../src/core/network/relay/link'
import { RelayTransport } from '../src/core/network/relay/transport'
import { webSocketFactory } from '../src/core/network/relay/webSocket'
import { startFakeRelay, type FakeRelay } from './helpers/fakeRelay'

const until = async (check: () => boolean, ms = 10000): Promise<void> => {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('timeout')
    await new Promise((r) => setTimeout(r, 20))
  }
}

const relays: FakeRelay[] = []
const transports: RelayTransport[] = []

afterEach(async () => {
  for (const t of transports.splice(0)) t.destroy()
  for (const r of relays.splice(0)) await r.close()
})

async function relay(): Promise<FakeRelay> {
  const r = await startFakeRelay()
  relays.push(r)
  return r
}

function node(urls: string[], admit: (pub: string) => boolean = () => true) {
  const identity: Identity = createIdentity()
  const links: RelayLink[] = []
  const transport = new RelayTransport({
    identity,
    urls,
    socket: webSocketFactory,
    admit,
    onConnection: (link) => links.push(link),
    linkOptions: { helloDelays: [300, 300, 300, 300] },
    reconnectMs: 100
  })
  transports.push(transport)
  transport.start()
  return { identity, pub: toIdentifier(identity.publicKey), transport, links }
}

describe('relay transport', () => {
  it('opens a link on both sides through the relay and carries data both ways', async () => {
    const r = await relay()
    const a = node([r.url])
    const b = node([r.url])
    await until(() => a.transport.status().connected === 1 && b.transport.status().connected === 1)
    a.transport.connect(b.pub)
    await until(() => a.links.length === 1 && b.links.length === 1)
    expect(a.links[0].remotePublicKey.equals(b.identity.publicKey)).toBe(true)
    expect(b.links[0].remotePublicKey.equals(a.identity.publicKey)).toBe(true)
    const gotB: Buffer[] = []
    const gotA: Buffer[] = []
    b.links[0].on('data', (d: Buffer) => gotB.push(d))
    a.links[0].on('data', (d: Buffer) => gotA.push(d))
    const big = Buffer.alloc(100_000, 3)
    a.links[0].write(Buffer.from('ahoj'))
    a.links[0].write(big)
    b.links[0].write(Buffer.from('zpet'))
    await until(() => Buffer.concat(gotB).length === 4 + big.length && Buffer.concat(gotA).length === 4)
    expect(Buffer.concat(gotB).subarray(0, 4).toString()).toBe('ahoj')
    expect(Buffer.concat(gotA).toString()).toBe('zpet')
  })

  it('uses several relays and drops the duplicate copies', async () => {
    const r1 = await relay()
    const r2 = await relay()
    const a = node([r1.url, r2.url])
    const b = node([r1.url, r2.url])
    await until(() => a.transport.status().connected === 2 && b.transport.status().connected === 2)
    a.transport.connect(b.pub)
    await until(() => a.links.length === 1 && b.links.length === 1)
    const got: Buffer[] = []
    b.links[0].on('data', (d: Buffer) => got.push(d))
    for (let i = 0; i < 20; i++) a.links[0].write(Buffer.from(`m${i};`))
    await until(() => Buffer.concat(got).toString().endsWith('m19;'))
    expect(Buffer.concat(got).toString()).toBe(Array.from({ length: 20 }, (_, i) => `m${i};`).join(''))
    expect(r1.events).toBeGreaterThan(0)
    expect(r2.events).toBeGreaterThan(0)
  })

  it('refuses peers the admit callback rejects', async () => {
    const r = await relay()
    const a = node([r.url])
    const b = node([r.url], () => false)
    await until(() => a.transport.status().connected === 1 && b.transport.status().connected === 1)
    a.transport.connect(b.pub)
    await new Promise((resolve) => setTimeout(resolve, 600))
    expect(b.links).toHaveLength(0)
    expect(a.links).toHaveLength(0)
  })

  it('reconnects to a relay that dropped the connection', async () => {
    const r = await relay()
    const a = node([r.url])
    const b = node([r.url])
    await until(() => a.transport.status().connected === 1 && b.transport.status().connected === 1)
    r.kick()
    await until(() => a.transport.status().connected === 0)
    await until(() => a.transport.status().connected === 1 && b.transport.status().connected === 1)
    a.transport.connect(b.pub)
    await until(() => a.links.length === 1 && b.links.length === 1)
  })

  it('closes the link on both sides', async () => {
    const r = await relay()
    const a = node([r.url])
    const b = node([r.url])
    await until(() => a.transport.status().connected === 1 && b.transport.status().connected === 1)
    a.transport.connect(b.pub)
    await until(() => a.links.length === 1 && b.links.length === 1)
    let closed = false
    b.links[0].on('close', () => (closed = true))
    a.transport.disconnect(b.pub)
    await until(() => closed)
  })
})
