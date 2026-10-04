// The relay fallback: when two devices cannot reach each other directly (both behind NATs with random ports,
// typically mobile data), they exchange encrypted packets through public Nostr relays. No account, no own server.
// Each device listens on its mailbox tag; a packet for a peer is a Nostr event tagged with the peer's mailbox.
// Relays see only mailbox tags, sizes and timing; the content is sealed for the peer (packet.ts).
import { fromIdentifier, toIdentifier, type Identity } from '../../identity'
import { RelayLink, decodeLinkPayload, type LinkOptions } from './link'
import { RELAY_KIND, newNostrKey, signEvent, type NostrEvent } from './nostr'
import { mailboxTag, openPacket, sealPacket } from './packet'

export interface SocketHandlers {
  open(): void
  message(text: string): void
  close(): void
}

export interface RelaySocket {
  send(text: string): void
  close(): void
}

/** Opens a WebSocket to a relay (Node/Electron and Bare have different WebSocket APIs). */
export type RelaySocketFactory = (url: string, handlers: SocketHandlers) => RelaySocket

export interface RelayTransportOptions {
  identity: Identity
  urls: string[]
  socket: RelaySocketFactory
  /** False drops packets from this peer (blocked). */
  admit(pub: string): boolean
  /** A link is open on both sides. */
  onConnection(link: RelayLink): void
  /** Relays used at the same time (the others take over when one keeps failing). */
  maxRelays?: number
  /** Events per second sent to the relays (public relays limit the rate). */
  ratePerSecond?: number
  reconnectMs?: number
  linkOptions?: Partial<LinkOptions>
}

export interface RelayStatus {
  /** Relays in use. */
  relays: number
  /** Of those, connected now. */
  connected: number
  /** Peers reached through a relay right now. */
  links: number
}

const SUBSCRIPTION = 'okfetch'
const QUEUE_BUSY = 48
const QUEUE_LOW = 12
const SEEN_LIMIT = 4096
const FAILED_RETRY_MS = [30_000, 60_000, 120_000, 300_000]

class RelayConnection {
  socket: RelaySocket | null = null
  open = false
  failures = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private closed = false

  constructor(
    readonly url: string,
    private readonly transport: RelayTransport
  ) {}

  connect(): void {
    if (this.closed) return
    let opened = false
    try {
      this.socket = this.transport.socketFactory(this.url, {
        open: () => {
          opened = true
          this.open = true
          this.failures = 0
          this.socket?.send(JSON.stringify(['REQ', SUBSCRIPTION, this.transport.filter()]))
          this.transport.flush()
        },
        message: (text) => this.transport.onRelayMessage(text),
        close: () => {
          this.open = false
          this.socket = null
          if (!opened) this.failures++
          this.schedule()
        }
      })
    } catch {
      this.failures++
      this.schedule()
    }
  }

  private schedule(): void {
    if (this.closed || this.timer) return
    const base = this.transport.reconnectMs
    const delay = Math.min(base * 2 ** Math.min(this.failures, 6), 60_000)
    this.timer = setTimeout(() => {
      this.timer = null
      this.connect()
    }, delay)
    ;(this.timer as { unref?: () => void }).unref?.()
  }

  send(text: string): void {
    if (this.open) this.socket?.send(text)
  }

  close(): void {
    this.closed = true
    if (this.timer) clearTimeout(this.timer)
    this.open = false
    try {
      this.socket?.close()
    } catch {
      // already closed
    }
    this.socket = null
  }
}

export class RelayTransport {
  readonly socketFactory: RelaySocketFactory
  readonly reconnectMs: number
  private readonly connections: RelayConnection[]
  private readonly links = new Map<string, RelayLink>()
  private readonly failed = new Map<string, { count: number; until: number }>()
  private readonly seen = new Set<string>()
  private readonly queue: string[] = []
  private readonly nostrKey = newNostrKey()
  private readonly myTag: string
  private pump: ReturnType<typeof setInterval> | null = null
  private destroyed = false

  constructor(private readonly options: RelayTransportOptions) {
    this.socketFactory = options.socket
    this.reconnectMs = options.reconnectMs ?? 2000
    this.myTag = mailboxTag(options.identity.publicKey)
    const max = options.maxRelays ?? 3
    this.connections = options.urls.slice(0, Math.max(max, 0)).map((url) => new RelayConnection(url, this))
  }

  filter(): Record<string, unknown> {
    return { kinds: [RELAY_KIND], '#p': [this.myTag], since: Math.floor(Date.now() / 1000) - 30 }
  }

  start(): void {
    for (const connection of this.connections) connection.connect()
    const perTick = Math.max(1, Math.round((this.options.ratePerSecond ?? 20) / 10))
    this.pump = setInterval(() => this.flush(perTick), 100)
    ;(this.pump as { unref?: () => void }).unref?.()
  }

  status(): RelayStatus {
    return {
      relays: this.connections.length,
      connected: this.connections.filter((c) => c.open).length,
      links: [...this.links.values()].filter((l) => l.opened && !l.destroyed).length
    }
  }

  /** Try to reach a peer through the relays (does nothing while a link exists or after recent failures). */
  connect(pub: string): void {
    if (this.destroyed) return
    const current = this.links.get(pub)
    if (current && !current.destroyed) return
    const failure = this.failed.get(pub)
    if (failure && Date.now() < failure.until) return
    this.createLink(pub, true)
  }

  disconnect(pub: string): void {
    this.failed.delete(pub)
    this.links.get(pub)?.destroy(true)
  }

  isLinked(pub: string): boolean {
    const link = this.links.get(pub)
    return Boolean(link && link.opened && !link.destroyed)
  }

  private createLink(pub: string, active: boolean): RelayLink {
    const remote = fromIdentifier(pub)
    const link = new RelayLink(remote, (payload) => this.enqueue(remote, payload), {
      ...this.options.linkOptions,
      active,
      busy: () => this.queue.length > QUEUE_BUSY
    })
    this.links.set(pub, link)
    link.once('open', () => {
      this.failed.delete(pub)
      this.options.onConnection(link)
    })
    link.once('close', () => {
      if (this.links.get(pub) === link) this.links.delete(pub)
      if (!link.opened && active) {
        const count = (this.failed.get(pub)?.count ?? 0) + 1
        this.failed.set(pub, { count, until: Date.now() + FAILED_RETRY_MS[Math.min(count - 1, FAILED_RETRY_MS.length - 1)] })
      }
    })
    return link
  }

  private enqueue(to: Uint8Array, payload: Uint8Array): void {
    if (this.destroyed) return
    const event = signEvent(this.nostrKey, RELAY_KIND, [['p', mailboxTag(to)]], sealPacket(this.options.identity, to, payload))
    this.queue.push(JSON.stringify(['EVENT', event]))
  }

  /** Send queued events to every connected relay, a few per tick (relays limit the rate). */
  flush(limit = Infinity): void {
    if (!this.connections.some((c) => c.open)) return
    let sent = 0
    while (this.queue.length && sent < limit) {
      const text = this.queue.shift()!
      for (const connection of this.connections) connection.send(text)
      sent++
    }
    if (this.queue.length <= QUEUE_LOW) for (const link of this.links.values()) link.drained()
  }

  onRelayMessage(text: string): void {
    if (this.destroyed) return
    let message: unknown
    try {
      message = JSON.parse(text)
    } catch {
      return
    }
    if (!Array.isArray(message) || message[0] !== 'EVENT' || message[1] !== SUBSCRIPTION) return
    const event = message[2] as NostrEvent | undefined
    if (!event || typeof event.id !== 'string' || event.kind !== RELAY_KIND || typeof event.content !== 'string') return
    // The same event arrives from every relay: handle it once.
    if (this.seen.has(event.id)) return
    this.seen.add(event.id)
    if (this.seen.size > SEEN_LIMIT) this.seen.delete(this.seen.values().next().value as string)
    if (!event.tags?.some((t) => t[0] === 'p' && t[1] === this.myTag)) return
    const opened = openPacket(this.options.identity, event.content)
    if (!opened) return
    const pub = toIdentifier(opened.from)
    const packet = decodeLinkPayload(opened.payload)
    if (!packet) return
    let link = this.links.get(pub)
    // A new stream from the other side means it started over: the old link is finished.
    if (link && !link.destroyed && link.remoteStream && !link.remoteStream.equals(packet.stream)) {
      link.destroy(false)
      link = undefined
    }
    if (!link || link.destroyed) {
      if (packet.type === 'close') return
      if (!this.options.admit(pub)) return
      link = this.createLink(pub, false)
    }
    link.receive(opened.payload)
  }

  destroy(): void {
    if (this.destroyed) return
    for (const link of [...this.links.values()]) link.destroy(true)
    this.flush()
    this.destroyed = true
    if (this.pump) clearInterval(this.pump)
    for (const connection of this.connections) connection.close()
    this.links.clear()
    this.queue.length = 0
  }
}
