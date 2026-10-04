// Globals of the Bare runtime and of a Bare Kit worklet (only what the phone core uses).
declare const Bare: {
  readonly argv: string[]
  on(event: 'uncaughtException' | 'unhandledRejection' | 'suspend' | 'resume', listener: (error?: unknown) => void): void
  exit(code?: number): never
}

declare const BareKit: {
  IPC: {
    on(event: 'data', listener: (chunk: Uint8Array) => void): void
    write(data: Uint8Array | string): boolean
  }
}
