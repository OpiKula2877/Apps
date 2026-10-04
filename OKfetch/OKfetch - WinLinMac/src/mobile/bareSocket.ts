// Relay sockets on the phone: bare-ws (a stream) behind the small socket interface of the relay transport.
// bare-ws is loaded on first use: if its native parts cannot load, the core still runs (only the relay is missing).
import type BareWs from 'bare-ws'
import type { RelaySocketFactory } from '../core/network/relay/transport'

let ws: typeof BareWs | null = null

/** True when bare-ws (and its TLS addon) can be loaded here. */
export function bareSocketsAvailable(): boolean {
  try {
    ws ??= require('bare-ws') as typeof BareWs
    return true
  } catch {
    return false
  }
}

export const bareSocketFactory: RelaySocketFactory = (url, handlers) => {
  ws ??= require('bare-ws') as typeof BareWs
  const socket = new ws.Socket(url)
  let closed = false
  const close = (): void => {
    if (closed) return
    closed = true
    handlers.close()
  }
  socket.on('open', () => handlers.open())
  socket.on('message', (data: Uint8Array) => handlers.message(Buffer.from(data).toString('utf8')))
  // Reading keeps the stream flowing (and opens it).
  socket.on('data', () => undefined)
  socket.on('close', close)
  socket.on('error', close)
  return {
    send: (text) => {
      if (!closed) socket.write(text)
    },
    close: () => {
      closed = true
      socket.destroy()
    }
  }
}
