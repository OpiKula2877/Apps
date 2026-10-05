import type { OkgramApi } from '../../shared/ipc'

declare global {
  interface Window {
    /** Set by the Electron preload script. */
    okgram?: OkgramApi
  }
}

export {}
