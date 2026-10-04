// Hyperswarm wrapper: one authenticated, encrypted connection per peer public key.
// The transport (Noise) proves the remote public key, so identity needs no extra handshake.
// When the DHT cannot connect two peers (both behind NATs with random ports, typically mobile data), the relay
// fallback carries the same frames through public Nostr relays; a direct connection always wins over it.
import Hyperswarm from 'hyperswarm'
import type { NetDiagnostics, NetStatus, ProbeResult } from '../../shared/model'
import { fromIdentifier, toIdentifier, type Identity } from '../identity'
import { Presence } from './presence'
import { FRAME_CTRL, FrameDecoder, encodeBlock, encodeCtrl, type Ctrl, type Frame } from './protocol'
import type { LinkOptions } from './relay/link'
import { RelayTransport, type RelaySocketFactory } from './relay/transport'

export interface RelayConfig {
  urls: string[]
  socket: RelaySocketFactory
  /** How long a direct attempt gets before the relay is tried too. */
  afterMs?: number
  /** Skip direct connections (diagnostics and tests). */
  only?: boolean
  reconnectMs?: number
  linkOptions?: Partial<LinkOptions>
}

export interface NetworkOptions {
  identity: Identity
  /** DHT bootstrap nodes; default = the public HyperDHT. Tests pass a local testnet. */
  bootstrap?: { host: string; port: number }[]
  /** Return false to drop a connection right away (blocked peers). */
  admit: (pub: string) => boolean
  onOpen: (peer: Peer) => void
  onFrame: (peer: Peer, frame: Frame) => void
  onClose: (peer: Peer) => void
  onStatus: (status: NetStatus) => void
  /** How often offline peers that we want are dialled again. */
  retryMs?: number
  /** Fallback through public relays; null or missing = direct connections only. */
  relay?: RelayConfig | null
}

export type Via = 'direct' | 'relay'

const noop = (): void => undefined

export class Peer {
  closed = false
  /** We already sent our profile (`hello`) on this connection. */
  greeted = false
  constructor(
    readonly pub: string,
    private conn: any,
    readonly via: Via = 'direct'
  ) {}

  /** Queue a control frame. Returns false when the connection is gone. */
  send(message: Ctrl): boolean {
    if (this.closed) return false
    this.conn.write(encodeCtrl(message))
    return true
  }

  /** Write a file block and wait while the connection buffer is full (backpressure). */
  async sendBlock(fileId: string, index: number, data: Uint8Array): Promise<boolean> {
    if (this.closed) return false
    const ok = this.conn.write(encodeBlock(fileId, index, data))
    if (ok) return true
    return new Promise<boolean>((resolve) => {
      const done = (value: boolean) => {
        this.conn.removeListener('drain', onDrain)
        this.conn.removeListener('close', onClose)
        resolve(value)
      }
      const onDrain = () => done(true)
      const onClose = () => done(false)
      this.conn.once('drain', onDrain)
      this.conn.once('close', onClose)
    })
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.conn.destroy()
  }
}

export class PeerNetwork {
  readonly presence = new Presence()
  status: NetStatus = 'connecting'
  private swarm: any
  private peers = new Map<string, Peer>()
  private wanted = new Set<string>()
  private timer: NodeJS.Timeout | null = null
  private destroyed = false
  private relay: RelayTransport | null = null
  private relayConfig: RelayConfig | null = null
  private relayTimers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(private options: NetworkOptions) {
    this.swarm = new Hyperswarm({
      keyPair: { publicKey: options.identity.publicKey, secretKey: options.identity.secretKey },
      bootstrap: options.bootstrap
    })
    this.swarm.on('connection', (conn: any) => this.accept(conn, 'direct'))
    this.swarm.dht.on('network-update', () => this.refreshStatus())
    this.setRelay(options.relay ?? null)
  }

  /** Turn the relay fallback on (with these relays) or off; takes effect right away. */
  setRelay(config: RelayConfig | null): void {
    this.relay?.destroy()
    for (const timer of this.relayTimers.values()) clearTimeout(timer)
    this.relayTimers.clear()
    this.relay = null
    this.relayConfig = config && config.urls.length ? config : null
    if (!this.relayConfig || this.destroyed) return
    this.relay = new RelayTransport({
      identity: this.options.identity,
      urls: this.relayConfig.urls,
      socket: this.relayConfig.socket,
      reconnectMs: this.relayConfig.reconnectMs,
      linkOptions: this.relayConfig.linkOptions,
      admit: (pub) => !this.destroyed && this.options.admit(pub),
      onConnection: (link) => this.accept(link, 'relay')
    })
    this.relay.start()
    for (const pub of this.wanted) if (!this.peer(pub)) this.scheduleRelay(pub)
  }

  /** Give the direct connection a head start, then try the relay too. */
  private scheduleRelay(pub: string): void {
    if (!this.relay || this.relayTimers.has(pub) || this.peer(pub)) return
    const delay = this.relayConfig?.only ? 0 : (this.relayConfig?.afterMs ?? 8000)
    const timer = setTimeout(() => {
      this.relayTimers.delete(pub)
      if (this.wanted.has(pub) && !this.peer(pub)) this.relay?.connect(pub)
    }, delay)
    ;(timer as { unref?: () => void }).unref?.()
    this.relayTimers.set(pub, timer)
  }

  async start(): Promise<void> {
    await this.swarm.listen()
    this.refreshStatus()
    this.timer = setInterval(() => this.redial(), this.options.retryMs ?? 20_000)
    this.timer.unref?.()
  }

  private refreshStatus(): void {
    if (this.destroyed) return
    const status: NetStatus = this.swarm.dht.online ? 'online' : this.status === 'connecting' ? 'connecting' : 'offline'
    if (status !== this.status) {
      this.status = status
      this.options.onStatus(status)
    }
  }

  private accept(conn: any, via: Via): void {
    const pub = toIdentifier(conn.remotePublicKey)
    conn.on('error', noop)
    if (this.destroyed || !this.options.admit(pub)) {
      conn.destroy()
      return
    }
    const previous = this.peers.get(pub)
    // A relay link never replaces a working direct connection; a direct connection replaces anything.
    if (via === 'relay' && previous && !previous.closed && previous.via === 'direct') {
      conn.destroy()
      return
    }
    if (previous) previous.close()
    const peer = new Peer(pub, conn, via)
    this.peers.set(pub, peer)
    const decoder = new FrameDecoder()
    conn.on('data', (chunk: Buffer) => {
      let frames: Frame[]
      try {
        frames = decoder.push(chunk)
      } catch {
        peer.close()
        return
      }
      for (const frame of frames) {
        if (peer.closed) break
        try {
          this.options.onFrame(peer, frame)
        } catch (error) {
          console.error('[okfetch] frame handler failed', error)
        }
      }
    })
    conn.on('close', () => {
      peer.closed = true
      if (this.peers.get(pub) === peer) {
        this.peers.delete(pub)
        this.presence.set(pub, false)
      }
      this.options.onClose(peer)
    })
    this.presence.set(pub, true)
    this.options.onOpen(peer)
  }

  /** Keep trying to reach this peer (contacts, group members, request targets). */
  dial(pub: string): void {
    this.wanted.add(pub)
    if (this.peers.has(pub) || this.destroyed) return
    if (!this.relayConfig?.only) this.swarm.joinPeer(fromIdentifier(pub))
    this.scheduleRelay(pub)
  }

  undial(pub: string): void {
    this.wanted.delete(pub)
    const timer = this.relayTimers.get(pub)
    if (timer) clearTimeout(timer)
    this.relayTimers.delete(pub)
    this.relay?.disconnect(pub)
    try {
      this.swarm.leavePeer(fromIdentifier(pub))
    } catch {
      // not known to the swarm
    }
    this.peers.get(pub)?.close()
  }

  /** Hyperswarm gives up on an explicit peer after a few failed attempts; start over for peers that are still offline. */
  private redial(): void {
    for (const pub of this.wanted) {
      if (this.peers.has(pub)) continue
      if (!this.relayConfig?.only) {
        const info = this.swarm.peers.get(fromIdentifier(pub).toString('hex'))
        if (info) info.attempts = 0
        this.swarm.joinPeer(fromIdentifier(pub))
      }
      this.scheduleRelay(pub)
    }
  }

  peer(pub: string): Peer | undefined {
    const peer = this.peers.get(pub)
    return peer && !peer.closed ? peer : undefined
  }

  isOnline(pub: string): boolean {
    return this.presence.isOnline(pub)
  }

  /** The state of this node as the DHT sees it (for the diagnostics screen). */
  diagnostics(): NetDiagnostics {
    const dht = this.swarm.dht
    let localAddresses: string[] = []
    try {
      const socket = dht.io?.serverSocket
      if (socket) {
        localAddresses = socket.udx
          .networkInterfaces()
          .filter((n: { family: number; internal: boolean }) => n.family === 4 && !n.internal)
          .map((n: { host: string }) => n.host)
      }
    } catch {
      // interfaces not readable here
    }
    return {
      status: this.status,
      host: dht.host ?? null,
      port: dht.port ?? null,
      firewalled: Boolean(dht.firewalled),
      randomized: Boolean(dht.randomized),
      localAddresses,
      connections: [...this.peers.values()].filter((p) => !p.closed).length,
      relay: this.relay ? this.relay.status() : null
    }
  }

  /**
   * Try to open a connection to a peer and report how it went: the DHT error code tells why two devices
   * cannot reach each other. An existing connection is not touched; a test connection is closed at once.
   */
  probe(pub: string, timeoutMs = 20_000): Promise<ProbeResult> {
    const connected = this.peer(pub)
    if (connected) return Promise.resolve({ ok: true, code: 'CONNECTED', ms: 0, via: connected.via })
    const started = Date.now()
    const socket = this.swarm.dht.connect(fromIdentifier(pub), {
      keyPair: { publicKey: this.options.identity.publicKey, secretKey: this.options.identity.secretKey }
    })
    return new Promise<ProbeResult>((resolve) => {
      const finish = (result: Omit<ProbeResult, 'ms'>): void => {
        clearTimeout(timer)
        socket.removeAllListeners?.('open')
        socket.on('error', noop)
        socket.destroy()
        resolve({ ...result, ms: Date.now() - started })
      }
      const timer = setTimeout(() => finish({ ok: false, code: 'TIMEOUT' }), timeoutMs)
      socket.once('open', () => finish({ ok: true, code: null }))
      socket.once('error', (error: { code?: string; message?: string }) => finish({ ok: false, code: error?.code ?? String(error?.message ?? 'ERROR') }))
    })
  }

  async destroy(): Promise<void> {
    this.destroyed = true
    if (this.timer) clearInterval(this.timer)
    for (const timer of this.relayTimers.values()) clearTimeout(timer)
    this.relay?.destroy()
    for (const peer of this.peers.values()) peer.close()
    await this.swarm.destroy()
  }
}

export { FRAME_CTRL }
