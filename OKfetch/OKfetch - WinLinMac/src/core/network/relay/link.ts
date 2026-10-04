// A virtual connection through relays, shaped like a Hyperswarm connection (write / 'data' / 'drain' / 'close',
// remotePublicKey), so the peer network uses it the same way. Packets may arrive late, twice or out of order
// (several relays carry each one): they are put back in order; a packet that stays missing closes the link, and
// the core's outbox sends its frames again on the next connection.
import { randomBytes } from '../../sodium'
import { Emitter } from './emitter'

export interface LinkPacket {
  type: 'ping' | 'data' | 'close'
  /** Random id of the sender's side of this link; a new one means the sender started over. */
  stream: Buffer
  seq: number
  /** Ping only: the other side should answer with a ping. */
  reply?: boolean
  data?: Buffer
}

const TYPES = ['ping', 'data', 'close'] as const
const HEADER = 1 + 8 + 4 + 1

export function encodeLinkPayload(packet: LinkPacket): Buffer {
  const head = Buffer.alloc(HEADER)
  head.writeUInt8(TYPES.indexOf(packet.type) + 1, 0)
  Buffer.from(packet.stream).copy(head, 1, 0, 8)
  head.writeUInt32BE(packet.seq >>> 0, 9)
  head.writeUInt8(packet.reply ? 1 : 0, 13)
  return packet.data ? Buffer.concat([head, packet.data]) : head
}

export function decodeLinkPayload(payload: Uint8Array): LinkPacket | null {
  if (payload.length < HEADER) return null
  const raw = Buffer.from(payload)
  const type = TYPES[raw.readUInt8(0) - 1]
  if (!type) return null
  return {
    type,
    stream: Buffer.from(raw.subarray(1, 9)),
    seq: raw.readUInt32BE(9),
    reply: raw.readUInt8(13) === 1,
    data: type === 'data' ? Buffer.from(raw.subarray(HEADER)) : undefined
  }
}

export interface LinkOptions {
  /** This side asked for the link: it pings until the other side answers. */
  active?: boolean
  /** Largest data per packet. */
  chunk?: number
  /** A missing packet closes the link after this long. */
  gapMs?: number
  /** Nothing heard for this long closes the link. */
  idleMs?: number
  keepaliveMs?: number
  /** Pings of the active side before the other side answers. */
  helloDelays?: number[]
  /** The transport's queue is full: write() returns false until 'drain'. */
  busy?: () => boolean
}

// Pings at 0, 2, 6 and 14 s; no answer by 22 s ends the attempt (the peer network tries again later).
const DEFAULTS = { chunk: 16 * 1024, gapMs: 10_000, idleMs: 75_000, keepaliveMs: 25_000, helloDelays: [2000, 4000, 8000, 8000] }
const MAX_BUFFERED = 2048

const unref = (timer: ReturnType<typeof setTimeout>): ReturnType<typeof setTimeout> => {
  ;(timer as { unref?: () => void }).unref?.()
  return timer
}

export class RelayLink extends Emitter {
  readonly remotePublicKey: Buffer
  readonly stream = randomBytes(8)
  remoteStream: Buffer | null = null
  opened = false
  destroyed = false
  private nextSeq = 0
  private expected = 0
  private buffered = new Map<number, Buffer>()
  private gapTimer: ReturnType<typeof setTimeout> | null = null
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null
  private helloTimer: ReturnType<typeof setTimeout> | null = null
  private waitingDrain = false
  private readonly options: Required<Omit<LinkOptions, 'busy' | 'active'>> & Pick<LinkOptions, 'busy' | 'active'>

  constructor(
    remotePublicKey: Uint8Array,
    private readonly send: (payload: Uint8Array) => void,
    options: LinkOptions = {}
  ) {
    super()
    this.remotePublicKey = Buffer.from(remotePublicKey)
    this.options = { ...DEFAULTS, ...options }
    if (options.active) this.hello(0)
  }

  /** Ping, wait, ping again with longer waits; after the last wait without an answer the link gives up. */
  private hello(attempt: number): void {
    if (this.opened || this.destroyed) return
    const delays = this.options.helloDelays
    if (attempt >= delays.length) {
      this.destroy(false)
      return
    }
    this.packet({ type: 'ping', seq: 0, reply: true })
    this.helloTimer = unref(setTimeout(() => this.hello(attempt + 1), delays[attempt]))
  }

  private packet(packet: Omit<LinkPacket, 'stream'>): void {
    this.send(encodeLinkPayload({ ...packet, stream: this.stream }))
  }

  write(data: Uint8Array): boolean {
    if (this.destroyed) return false
    const buffer = Buffer.from(data)
    for (let offset = 0; offset < buffer.length || offset === 0; offset += this.options.chunk) {
      this.packet({ type: 'data', seq: this.nextSeq++, data: buffer.subarray(offset, offset + this.options.chunk) })
      if (buffer.length === 0) break
    }
    if (this.options.busy?.()) {
      this.waitingDrain = true
      return false
    }
    return true
  }

  /** The transport's queue went down again. */
  drained(): void {
    if (!this.waitingDrain || this.destroyed) return
    this.waitingDrain = false
    this.emit('drain')
  }

  /** A decrypted payload from the remote side (the transport checked that `stream` belongs to this link). */
  receive(payload: Uint8Array): void {
    if (this.destroyed) return
    const packet = decodeLinkPayload(payload)
    if (!packet) return
    if (!this.remoteStream) this.remoteStream = packet.stream
    else if (!this.remoteStream.equals(packet.stream)) return
    this.touch()
    if (packet.type === 'close') {
      this.destroy(false)
      return
    }
    if (!this.opened) {
      this.opened = true
      if (this.helloTimer) clearTimeout(this.helloTimer)
      this.keepaliveTimer = setInterval(() => this.packet({ type: 'ping', seq: 0 }), this.options.keepaliveMs)
      ;(this.keepaliveTimer as { unref?: () => void }).unref?.()
      this.emit('open')
    }
    if (packet.type === 'ping') {
      if (packet.reply) this.packet({ type: 'ping', seq: 0 })
      return
    }
    this.onData(packet.seq, packet.data ?? Buffer.alloc(0))
  }

  private onData(seq: number, data: Buffer): void {
    if (seq < this.expected || this.buffered.has(seq)) return
    if (seq > this.expected) {
      this.buffered.set(seq, data)
      if (this.buffered.size > MAX_BUFFERED) return this.destroy(true)
      if (!this.gapTimer) this.gapTimer = unref(setTimeout(() => this.destroy(true), this.options.gapMs))
      return
    }
    this.deliver(data)
    while (this.buffered.has(this.expected)) {
      const next = this.buffered.get(this.expected)!
      this.buffered.delete(this.expected)
      this.deliver(next)
    }
    if (this.gapTimer) {
      clearTimeout(this.gapTimer)
      this.gapTimer = this.buffered.size ? unref(setTimeout(() => this.destroy(true), this.options.gapMs)) : null
    }
  }

  private deliver(data: Buffer): void {
    this.expected++
    if (data.length && !this.destroyed) this.emit('data', data)
  }

  private touch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = unref(setTimeout(() => this.destroy(false), this.options.idleMs))
  }

  /** Close the link; `notify` tells the other side. */
  destroy(notify = true): void {
    if (this.destroyed) return
    if (notify && this.remoteStream) this.packet({ type: 'close', seq: 0 })
    this.destroyed = true
    for (const timer of [this.gapTimer, this.idleTimer, this.helloTimer]) if (timer) clearTimeout(timer)
    if (this.keepaliveTimer) clearInterval(this.keepaliveTimer)
    this.buffered.clear()
    this.emit('close')
  }
}
