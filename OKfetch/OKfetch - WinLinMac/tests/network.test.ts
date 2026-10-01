import createTestnet from 'hyperdht/testnet'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createIdentity, toIdentifier } from '../src/core/identity'
import { PeerNetwork, type Peer } from '../src/core/network/swarm'
import { FRAME_BLOCK, decodeBlock, parseCtrl, type Ctrl, type Frame } from '../src/core/network/protocol'

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

  async function node(admit: (pub: string) => boolean = () => true): Promise<Node> {
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
      onStatus: () => undefined
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
})
