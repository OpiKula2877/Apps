// Fallback transport through public Nostr relays: event signing, packet encryption, the virtual link.
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { describe, expect, it } from 'vitest'
import { createIdentity } from '../src/core/identity'
import { RelayLink, decodeLinkPayload, encodeLinkPayload } from '../src/core/network/relay/link'
import { RELAY_KIND, newNostrKey, signEvent } from '../src/core/network/relay/nostr'
import { mailboxTag, openPacket, sealPacket } from '../src/core/network/relay/packet'

describe('nostr events', () => {
  it('signs events the way relays verify them (NIP-01 id and BIP-340 signature)', () => {
    const sk = newNostrKey()
    const event = signEvent(sk, RELAY_KIND, [['p', 'ab'.repeat(32)]], 'hello', 1_700_000_000)
    const serial = JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content])
    expect(event.id).toBe(bytesToHex(sha256(new TextEncoder().encode(serial))))
    expect(schnorr.verify(hexToBytes(event.sig), hexToBytes(event.id), hexToBytes(event.pubkey))).toBe(true)
    expect(event.kind).toBe(RELAY_KIND)
    expect(RELAY_KIND).toBeGreaterThanOrEqual(20000)
    expect(RELAY_KIND).toBeLessThan(30000)
  })
})

describe('relay packets', () => {
  const alice = createIdentity()
  const bob = createIdentity()
  const eve = createIdentity()

  it('only the recipient opens a packet, and it proves who sent it', () => {
    const content = sealPacket(alice, bob.publicKey, Buffer.from('ahoj'))
    expect(content.includes('ahoj')).toBe(false)
    const opened = openPacket(bob, content)
    expect(opened?.payload.toString()).toBe('ahoj')
    expect(Buffer.compare(opened!.from, alice.publicKey)).toBe(0)
    expect(openPacket(eve, content)).toBeNull()
  })

  it('refuses tampered packets and a forged sender', () => {
    const raw = Buffer.from(sealPacket(alice, bob.publicKey, Buffer.from('ahoj')), 'base64')
    const tampered = Buffer.from(raw)
    tampered[tampered.length - 1] ^= 1
    expect(openPacket(bob, tampered.toString('base64'))).toBeNull()
    const forged = Buffer.concat([eve.publicKey, raw.subarray(32)])
    expect(openPacket(bob, forged.toString('base64'))).toBeNull()
    expect(openPacket(bob, 'not base64 at all !!')).toBeNull()
  })

  it('derives a mailbox tag per identity that does not reveal the public key', () => {
    const tag = mailboxTag(bob.publicKey)
    expect(tag).toMatch(/^[0-9a-f]{64}$/)
    expect(tag).not.toBe(bob.publicKey.toString('hex'))
    expect(mailboxTag(bob.publicKey)).toBe(tag)
    expect(mailboxTag(alice.publicKey)).not.toBe(tag)
  })
})

/** Two links wired to each other through a "network" the test controls (drop, reorder, duplicate). */
function pair(options: { chunk?: number; gapMs?: number } = {}) {
  const a = createIdentity()
  const b = createIdentity()
  const queues: { toA: Uint8Array[]; toB: Uint8Array[] } = { toA: [], toB: [] }
  const la = new RelayLink(b.publicKey, (p) => queues.toB.push(p), { ...options, active: true })
  const lb = new RelayLink(a.publicKey, (p) => queues.toA.push(p), options)
  const deliver = (): void => {
    while (queues.toA.length || queues.toB.length) {
      for (const p of queues.toB.splice(0)) lb.receive(p)
      for (const p of queues.toA.splice(0)) la.receive(p)
    }
  }
  return { la, lb, queues, deliver }
}

const collect = (link: RelayLink): Buffer[] => {
  const got: Buffer[] = []
  link.on('data', (d: Buffer) => got.push(Buffer.from(d)))
  return got
}

describe('relay link', () => {
  it('encodes ping, data and close payloads', () => {
    const stream = Buffer.from('0102030405060708', 'hex')
    const back = decodeLinkPayload(encodeLinkPayload({ type: 'data', stream, seq: 42, data: Buffer.from('x') }))
    expect(back).toMatchObject({ type: 'data', seq: 42 })
    expect(back!.data!.toString()).toBe('x')
    expect(decodeLinkPayload(Buffer.from([9, 9]))).toBeNull()
  })

  it('opens on both sides after the active side pings, then carries data both ways in order', () => {
    const { la, lb, deliver } = pair()
    let openA = false
    let openB = false
    la.on('open', () => (openA = true))
    lb.on('open', () => (openB = true))
    deliver()
    expect(openA && openB).toBe(true)
    const gotA = collect(la)
    const gotB = collect(lb)
    la.write(Buffer.from('one'))
    la.write(Buffer.from('two'))
    lb.write(Buffer.from('back'))
    deliver()
    expect(Buffer.concat(gotB).toString()).toBe('onetwo')
    expect(Buffer.concat(gotA).toString()).toBe('back')
  })

  it('splits big writes into chunks and puts them back together', () => {
    const { la, lb, queues, deliver } = pair({ chunk: 1000 })
    deliver()
    const got = collect(lb)
    const big = Buffer.alloc(5500, 7)
    la.write(big)
    expect(queues.toB.length).toBe(6)
    deliver()
    expect(Buffer.compare(Buffer.concat(got), big)).toBe(0)
  })

  it('reorders packets and ignores duplicates (several relays carry the same packet)', () => {
    const { la, lb, queues, deliver } = pair({ chunk: 10 })
    deliver()
    const got = collect(lb)
    la.write(Buffer.from('abcdefghijklmnopqrstuvwxyz0123'))
    const packets = queues.toB.splice(0)
    for (const p of [packets[2], packets[0], packets[0], packets[1], packets[2]]) lb.receive(p)
    deliver()
    expect(Buffer.concat(got).toString()).toBe('abcdefghijklmnopqrstuvwxyz0123')
  })

  it('closes when a packet stays missing (the core resends its frames on the next connection)', async () => {
    const { la, lb, queues, deliver } = pair({ chunk: 10, gapMs: 50 })
    deliver()
    let closed = false
    lb.on('close', () => (closed = true))
    la.write(Buffer.from('abcdefghijklmnopqrstuvwxyz'))
    const packets = queues.toB.splice(0)
    lb.receive(packets[1])
    await new Promise((r) => setTimeout(r, 120))
    expect(closed).toBe(true)
  })

  it('pings a few times, waits after the last ping, then gives up when nobody answers', async () => {
    const sent: Uint8Array[] = []
    const link = new RelayLink(createIdentity().publicKey, (p) => sent.push(p), { active: true, helloDelays: [20, 20, 40] })
    let closed = false
    link.on('close', () => (closed = true))
    await new Promise((r) => setTimeout(r, 70))
    expect(sent.length).toBe(3)
    expect(closed).toBe(false)
    await new Promise((r) => setTimeout(r, 40))
    expect(closed).toBe(true)
    expect(sent.every((p) => decodeLinkPayload(p)?.type === 'ping')).toBe(true)
  })

  it('tells the other side when it closes', () => {
    const { la, lb, deliver } = pair()
    deliver()
    let closed = false
    lb.on('close', () => (closed = true))
    la.destroy()
    deliver()
    expect(closed).toBe(true)
    expect(la.write(Buffer.from('late'))).toBe(false)
  })
})
