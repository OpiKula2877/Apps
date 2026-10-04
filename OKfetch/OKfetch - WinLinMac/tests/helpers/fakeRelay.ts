// A tiny Nostr relay for tests (NIP-01 subset): REQ with kinds and #p, EVENT forwarded to matching subscriptions,
// OK replies, CLOSE. Ephemeral like the real thing: nothing is stored.
import { WebSocketServer, type WebSocket } from 'ws'

interface Subscription {
  socket: WebSocket
  id: string
  kinds: number[] | null
  tags: string[] | null
}

export interface FakeRelay {
  url: string
  events: number
  /** Drop every client connection (the clients must reconnect). */
  kick(): void
  close(): Promise<void>
}

export async function startFakeRelay(): Promise<FakeRelay> {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  await new Promise<void>((resolve) => server.once('listening', () => resolve()))
  const subs: Subscription[] = []
  const relay: FakeRelay = {
    url: `ws://127.0.0.1:${(server.address() as { port: number }).port}`,
    events: 0,
    kick() {
      for (const client of server.clients) client.terminate()
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of server.clients) client.terminate()
        server.close(() => resolve())
      })
  }
  server.on('connection', (socket) => {
    socket.on('close', () => {
      for (let i = subs.length - 1; i >= 0; i--) if (subs[i].socket === socket) subs.splice(i, 1)
    })
    socket.on('message', (raw) => {
      let message: unknown[]
      try {
        message = JSON.parse(String(raw))
      } catch {
        return
      }
      if (message[0] === 'REQ') {
        const filter = (message[2] ?? {}) as { kinds?: number[]; '#p'?: string[] }
        subs.push({ socket, id: String(message[1]), kinds: filter.kinds ?? null, tags: filter['#p'] ?? null })
        socket.send(JSON.stringify(['EOSE', message[1]]))
      } else if (message[0] === 'CLOSE') {
        for (let i = subs.length - 1; i >= 0; i--) if (subs[i].socket === socket && subs[i].id === message[1]) subs.splice(i, 1)
      } else if (message[0] === 'EVENT') {
        const event = message[1] as { id: string; kind: number; tags: string[][] }
        relay.events++
        socket.send(JSON.stringify(['OK', event.id, true, '']))
        const p = event.tags.filter((t) => t[0] === 'p').map((t) => t[1])
        for (const sub of subs) {
          if (sub.kinds && !sub.kinds.includes(event.kind)) continue
          if (sub.tags && !p.some((tag) => sub.tags!.includes(tag))) continue
          if (sub.socket.readyState === 1) sub.socket.send(JSON.stringify(['EVENT', sub.id, event]))
        }
      }
    })
  })
  return relay
}
