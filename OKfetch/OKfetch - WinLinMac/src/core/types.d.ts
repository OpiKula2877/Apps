// Ambient types for packages that ship none.
declare module 'sodium-universal' {
  const sodium: any
  export default sodium
}
declare module 'z32' {
  export function encode(buf: Uint8Array): string
  export function decode(str: string): Buffer
}
declare module 'hyperswarm' {
  const Hyperswarm: any
  export default Hyperswarm
}
declare module 'hyperdht/testnet' {
  const createTestnet: (size?: number, opts?: unknown) => Promise<{ bootstrap: { host: string; port: number }[]; nodes: any[]; destroy(): Promise<void> }>
  export default createTestnet
}
