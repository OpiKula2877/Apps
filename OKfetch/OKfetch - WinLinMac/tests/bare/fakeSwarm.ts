// In-memory stand-in for Hyperswarm, used only by the Bare test on Windows (where the UDX addon cannot load).
// Swarms in one process find each other by public key; each pair shares one duplex connection.

type Listener = (...args: any[]) => void

class Emitter {
  private listeners = new Map<string, { fn: Listener; once: boolean }[]>()
  on(name: string, fn: Listener): this {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), { fn, once: false }])
    return this
  }
  once(name: string, fn: Listener): this {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), { fn, once: true }])
    return this
  }
  removeListener(name: string, fn: Listener): this {
    this.listeners.set(name, (this.listeners.get(name) ?? []).filter((l) => l.fn !== fn))
    return this
  }
  emit(name: string, ...args: any[]): void {
    const list = this.listeners.get(name) ?? []
    this.listeners.set(name, list.filter((l) => !l.once))
    for (const l of list) l.fn(...args)
  }
}

class FakeConnection extends Emitter {
  other: FakeConnection | null = null
  destroyed = false
  constructor(
    readonly remotePublicKey: Buffer,
    readonly owner: FakeSwarm
  ) {
    super()
  }
  write(data: Uint8Array): boolean {
    if (this.destroyed || !this.other) return false
    const copy = Buffer.from(data)
    const target = this.other
    setTimeout(() => {
      if (!target.destroyed) target.emit('data', copy)
    }, 0)
    return true
  }
  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.owner.forget(this)
    setTimeout(() => this.emit('close'), 0)
    this.other?.destroy()
  }
}

const registry = new Map<string, FakeSwarm>()

export default class FakeSwarm extends Emitter {
  readonly dht = Object.assign(new Emitter(), { online: true })
  readonly peers = new Map<string, { attempts: number }>()
  private wanted = new Set<string>()
  private conns = new Map<string, FakeConnection>()
  private listening = false
  private readonly pub: string
  /** Swarms meet only inside one network (the first bootstrap host), like two separate DHTs. */
  private readonly network: string

  constructor(options: { keyPair: { publicKey: Buffer; secretKey: Buffer }; bootstrap?: { host: string }[] }) {
    super()
    this.pub = Buffer.from(options.keyPair.publicKey).toString('hex')
    this.network = options.bootstrap?.[0]?.host ?? 'default'
  }

  async listen(): Promise<void> {
    this.listening = true
    registry.set(this.pub, this)
    for (const swarm of registry.values()) if (swarm !== this && swarm.network === this.network && swarm.wanted.has(this.pub)) swarm.connect(this)
    for (const pub of this.wanted) this.tryConnect(pub)
  }

  joinPeer(publicKey: Uint8Array): void {
    const pub = Buffer.from(publicKey).toString('hex')
    this.wanted.add(pub)
    this.tryConnect(pub)
  }

  leavePeer(publicKey: Uint8Array): void {
    this.wanted.delete(Buffer.from(publicKey).toString('hex'))
  }

  private tryConnect(pub: string): void {
    const target = registry.get(pub)
    if (target && target.network !== this.network) return
    if (target && target.listening && this.listening) this.connect(target)
  }

  private connect(target: FakeSwarm): void {
    if (this.conns.has(target.pub) || target.conns.has(this.pub)) return
    const mine = new FakeConnection(Buffer.from(target.pub, 'hex'), this)
    const theirs = new FakeConnection(Buffer.from(this.pub, 'hex'), target)
    mine.other = theirs
    theirs.other = mine
    this.conns.set(target.pub, mine)
    target.conns.set(this.pub, theirs)
    setTimeout(() => {
      this.emit('connection', mine)
      target.emit('connection', theirs)
    }, 0)
  }

  forget(conn: FakeConnection): void {
    const pub = conn.remotePublicKey.toString('hex')
    if (this.conns.get(pub) === conn) this.conns.delete(pub)
  }

  async destroy(): Promise<void> {
    this.listening = false
    if (registry.get(this.pub) === this) registry.delete(this.pub)
    for (const conn of [...this.conns.values()]) conn.destroy()
  }
}
