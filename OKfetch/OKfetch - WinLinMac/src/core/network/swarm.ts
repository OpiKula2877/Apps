// Hyperswarm wrapper: one authenticated, encrypted connection per peer public key.
// The transport (Noise) proves the remote public key, so identity needs no extra handshake.
import Hyperswarm from 'hyperswarm'
import type { NetStatus } from '../../shared/model'
import { fromIdentifier, toIdentifier, type Identity } from '../identity'
import { Presence } from './presence'
import { FRAME_CTRL, FrameDecoder, encodeBlock, encodeCtrl, type Ctrl, type Frame } from './protocol'

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
}

const noop = (): void => undefined

export class Peer {
  closed = false
  /** We already sent our profile (`hello`) on this connection. */
  greeted = false
  constructor(
    readonly pub: string,
    private conn: any
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

  constructor(private options: NetworkOptions) {
    this.swarm = new Hyperswarm({
      keyPair: { publicKey: options.identity.publicKey, secretKey: options.identity.secretKey },
      bootstrap: options.bootstrap
    })
    this.swarm.on('connection', (conn: any) => this.accept(conn))
    this.swarm.dht.on('network-update', () => this.refreshStatus())
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

  private accept(conn: any): void {
    const pub = toIdentifier(conn.remotePublicKey)
    conn.on('error', noop)
    if (this.destroyed || !this.options.admit(pub)) {
      conn.destroy()
      return
    }
    const previous = this.peers.get(pub)
    if (previous) previous.close()
    const peer = new Peer(pub, conn)
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
    this.swarm.joinPeer(fromIdentifier(pub))
  }

  undial(pub: string): void {
    this.wanted.delete(pub)
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
      const info = this.swarm.peers.get(fromIdentifier(pub).toString('hex'))
      if (info) info.attempts = 0
      this.swarm.joinPeer(fromIdentifier(pub))
    }
  }

  peer(pub: string): Peer | undefined {
    const peer = this.peers.get(pub)
    return peer && !peer.closed ? peer : undefined
  }

  isOnline(pub: string): boolean {
    return this.presence.isOnline(pub)
  }

  async destroy(): Promise<void> {
    this.destroyed = true
    if (this.timer) clearInterval(this.timer)
    for (const peer of this.peers.values()) peer.close()
    await this.swarm.destroy()
  }
}

export { FRAME_CTRL }
