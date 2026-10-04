import createTestnet from 'hyperdht/testnet'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createIdentity, toIdentifier } from '../src/core/identity'
import { PeerNetwork, type Peer } from '../src/core/network/swarm'
import { FRAME_BLOCK, decodeBlock, parseCtrl, type Ctrl, type Frame } from '../src/core/network/protocol'
import { webSocketFactory } from '../src/core/network/relay/webSocket'
import type { NetworkOptions } from '../src/core/network/swarm'
import { startFakeRelay } from './helpers/fakeRelay'

type Testnet = Awaited<ReturnType<typeof createTestnet>>

interface Node {
  net: PeerNetwork
  pub: string
  ctrl: Ctrl[]
  blocks: number[]
  opened: Peer[]
}

const until = async (check: () => boolean, ms = 15000): Promise<void> => {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('timeout')
    await new Promise((r) => setTimeout(r, 25))
  }
}

describe('peer network', () => {
  let testnet: Testnet
  const nodes: Node[] = []

  beforeAll(async () => {
    testnet = await createTestnet(3)
  })
  afterAll(async () => {
    await Promise.all(nodes.map((n) => n.net.destroy()))
    await testnet.destroy()
  })

  async function node(admit: (pub: string) => boolean = () => true, extra: Partial<NetworkOptions> = {}): Promise<Node> {
    const identity = createIdentity()
    const state: Node = { net: null as never, pub: toIdentifier(identity.publicKey), ctrl: [], blocks: [], opened: [] }
    state.net = new PeerNetwork({
      identity,
      bootstrap: testnet.bootstrap,
      admit,
      retryMs: 500,
      onOpen: (peer) => state.opened.push(peer),
      onFrame: (_peer, frame: Frame) => {
        if (frame.type === FRAME_BLOCK) state.blocks.push(decodeBlock(frame.payload)!.index)
        else {
          const message = parseCtrl(frame)
          if (message) state.ctrl.push(message)
        }
      },
      onClose: () => undefined,
      onStatus: () => undefined,
      ...extra
    })
    await state.net.start()
    nodes.push(state)
    return state
  }

  it('connects by public key, shows presence and exchanges control and block frames with backpressure', async () => {
    const a = await node()
    const b = await node()
    a.net.dial(b.pub)
    await until(() => a.net.isOnline(b.pub) && b.net.isOnline(a.pub))
    expect(a.net.peer(b.pub)!.send({ t: 'typing', chat: 'enc' })).toBe(true)
    await until(() => b.ctrl.length === 1)
    expect(b.ctrl[0]).toEqual({ t: 'typing', chat: 'enc' })

    const fileId = '00112233445566778899aabbccddeeff'
    const chunk = Buffer.alloc(64 * 1024, 7)
    const peer = a.net.peer(b.pub)!
    for (let i = 0; i < 200; i++) expect(await peer.sendBlock(fileId, i, chunk)).toBe(true)
    await until(() => b.blocks.length === 200)
    expect(b.blocks).toEqual([...Array(200).keys()])
  })

  it('reconnects when a peer that was offline comes back', async () => {
    const a = await node()
    const bIdentity = createIdentity()
    const bPub = toIdentifier(bIdentity.publicKey)
    a.net.dial(bPub)
    await new Promise((r) => setTimeout(r, 1500))
    expect(a.net.isOnline(bPub)).toBe(false)

    const b: Node = { net: null as never, pub: bPub, ctrl: [], blocks: [], opened: [] }
    b.net = new PeerNetwork({
      identity: bIdentity,
      bootstrap: testnet.bootstrap,
      admit: () => true,
      retryMs: 500,
      onOpen: (peer) => b.opened.push(peer),
      onFrame: () => undefined,
      onClose: () => undefined,
      onStatus: () => undefined
    })
    nodes.push(b)
    await b.net.start()
    await until(() => a.net.isOnline(bPub), 30000)
  })

  it('drops connections from peers the admit callback refuses', async () => {
    const c = await node((pub) => pub === 'nobody')
    const d = await node()
    d.net.dial(c.pub)
    await new Promise((r) => setTimeout(r, 2500))
    expect(c.net.isOnline(d.pub)).toBe(false)
    expect(c.opened).toHaveLength(0)
  })

  it('falls back to the relay when the DHT cannot connect two peers, and prefers a direct connection', async () => {
    const relay = await startFakeRelay()
    const otherNet = await createTestnet(3)
    try {
      const relayConfig = { urls: [relay.url], socket: webSocketFactory, afterMs: 300, reconnectMs: 100 }
      // Separate DHTs: the peers can never find each other directly, as with two randomized NATs.
      const r1 = await node(() => true, { relay: relayConfig })
      const r2 = await node(() => true, { relay: relayConfig, bootstrap: otherNet.bootstrap })
      r1.net.dial(r2.pub)
      await until(() => r1.net.isOnline(r2.pub) && r2.net.isOnline(r1.pub), 20000)
      expect(r1.net.peer(r2.pub)?.via).toBe('relay')
      expect(r1.net.diagnostics().relay).toMatchObject({ connected: 1, links: 1 })
      r1.net.peer(r2.pub)!.send({ t: 'typing', chat: 'enc' })
      await until(() => r2.ctrl.some((c) => c.t === 'typing'))
      await r1.net.peer(r2.pub)!.sendBlock('0123456789abcdef0123456789abcdef', 0, Buffer.alloc(70_000, 1))
      await until(() => r2.blocks.includes(0))

      // Same DHT: the direct connection wins even with the relay on.
      const d1 = await node(() => true, { relay: relayConfig })
      const d2 = await node(() => true, { relay: relayConfig })
      d1.net.dial(d2.pub)
      await until(() => d1.net.isOnline(d2.pub), 20000)
      expect(d1.net.peer(d2.pub)?.via).toBe('direct')
    } finally {
      await otherNet.destroy()
      await relay.close()
    }
  })

  it('reports its network state for the diagnostics screen', async () => {
    const e = await node()
    const info = e.net.diagnostics()
    expect(info.status).toBe('online')
    expect(typeof info.firewalled).toBe('boolean')
    expect(typeof info.randomized).toBe('boolean')
    expect(Array.isArray(info.localAddresses)).toBe(true)
    expect(info.localAddresses.every((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a))).toBe(true)
    expect(info.connections).toBe(0)
  })

  it('probes a peer: reachable, already connected, or the DHT error code', async () => {
    const f = await node()
    const g = await node()
    const reachable = await f.net.probe(g.pub, 15000)
    expect(reachable).toMatchObject({ ok: true, code: null })
    expect(reachable.ms).toBeGreaterThanOrEqual(0)

    f.net.dial(g.pub)
    await until(() => f.net.isOnline(g.pub), 30000)
    expect(await f.net.probe(g.pub)).toMatchObject({ ok: true, code: 'CONNECTED' })

    const nobody = toIdentifier(createIdentity().publicKey)
    const missing = await f.net.probe(nobody, 15000)
    expect(missing.ok).toBe(false)
    expect(missing.code).toBe('PEER_NOT_FOUND')
  })
})
