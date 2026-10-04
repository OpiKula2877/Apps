// The part of bare-ws (installed in mobile-worklet/, bundled only into the phone worklet) that the core uses.
declare module 'bare-ws' {
  class Socket {
    constructor(url: string)
    on(event: 'open' | 'close', listener: () => void): this
    on(event: 'message', listener: (data: Uint8Array, binary: boolean) => void): this
    on(event: 'data', listener: (data: Uint8Array) => void): this
    on(event: 'error', listener: (error: Error) => void): this
    write(data: string | Uint8Array): boolean
    destroy(): void
  }
  const ws: { Socket: typeof Socket }
  export default ws
}
