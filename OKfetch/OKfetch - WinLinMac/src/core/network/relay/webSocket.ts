// Relay sockets with the standard WebSocket API (Node 22+ / Electron main). The phone uses bare-ws instead.
import type { RelaySocketFactory } from './transport'

export const webSocketFactory: RelaySocketFactory = (url, handlers) => {
  const socket = new WebSocket(url)
  let closed = false
  const close = (): void => {
    if (closed) return
    closed = true
    handlers.close()
  }
  socket.onopen = () => handlers.open()
  socket.onmessage = (event) => handlers.message(typeof event.data === 'string' ? event.data : String(event.data))
  socket.onclose = close
  socket.onerror = close
  return {
    send: (text) => socket.send(text),
    close: () => {
      closed = true
      socket.close()
    }
  }
}
