import type { OkfetchApi } from '../../shared/ipc'

declare global {
  interface Window {
    /** Set by the Electron preload script. */
    okfetch: OkfetchApi
  }
}

export {}
