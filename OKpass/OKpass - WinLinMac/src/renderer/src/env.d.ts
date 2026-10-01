import type { OkpassApi } from '../../shared/ipc'

declare global {
  /** SHA-1 of the Android signing certificate (set at build time). */
  const __SIGNING_SHA1__: string

  interface Window {
    /** Set by the Electron preload script; missing on the phone. */
    okpass?: OkpassApi
    /** Phone build in a browser (tests): press the Android back button. */
    __okpassBack?: () => boolean
  }
}

export {}
