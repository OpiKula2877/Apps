// What the controller needs from the platform it runs on (desktop main process or the phone).
import type { Message, PlatformName, SaveState, Screen, Settings } from '../shared/ipc'
import type { StorageBackend } from './backend'
import type { KdfParams } from './kdf'
import type { CacheStore } from './repository'

export interface UiBridge {
  sendScreen(screen: Screen): void
  sendStatus(status: SaveState): void
  sendMessage(message: Message): void
}

export interface TokenProvider {
  /** A valid access token, refreshed when needed. Throws AuthError or OfflineError. */
  getToken(): Promise<string>
  /** Forget the current access token (after Google answered 401). */
  invalidate(): void
}

export type ClientSecretResult = 'ok' | 'cancel' | 'invalid' | 'wrong_type'

export interface AuthAdapter {
  /** The desktop needs the user's OAuth client file; the phone does not. */
  needsClientSecret: boolean
  hasClientSecret(): Promise<boolean>
  chooseClientSecret(): Promise<ClientSecretResult>
  /** The stored sign-in, or null when the user has to sign in. */
  load(): Promise<TokenProvider | null>
  login(successText: string): Promise<TokenProvider>
  logout(tokens: TokenProvider | null): Promise<void>
}

export interface BiometricAdapter {
  available(): Promise<boolean>
  enabled(): Promise<boolean>
  /** Encrypt the secret with a key that only a fingerprint unlocks. */
  store(secret: Uint8Array): Promise<boolean>
  /** Ask for the fingerprint; null when cancelled or failed. */
  unlock(): Promise<Uint8Array | null>
  clear(): Promise<void>
}

export interface Platform {
  name: PlatformName
  ui: UiBridge
  /** Development mode: local storage instead of Google Drive, no sign-in. */
  devMode: boolean
  loadSettings(): Promise<Settings>
  saveSettings(settings: Settings): Promise<void>
  cacheFor(accountId: string): CacheStore
  auth: AuthAdapter
  makeBackend(tokens: TokenProvider | null): StorageBackend
  exportFile(name: string, data: Uint8Array): Promise<boolean>
  /** Let the user pick a file; null when cancelled. */
  importFile(): Promise<Uint8Array | null>
  writeClipboard(text: string): Promise<void>
  nativeFrameChanged?(native: boolean): void
  biometric?: BiometricAdapter
  kdfParams?: KdfParams
}
