// What the controller needs from Electron. Passed in as callbacks, so the controller
// and the storage code run in tests without Electron.
import type { Message, LibraryState, Screen, Settings, SyncState, Transfer } from '../shared/ipc'
import type { LibraryData } from '../shared/model'
import type { MediaBackend } from '../core/backend'
import type { TokenProvider } from '../core/driveRest'

export type ClientSecretResult = 'ok' | 'cancel' | 'invalid' | 'wrong_type'

export interface AuthAdapter {
  hasClientSecret(): Promise<boolean>
  chooseClientSecret(): Promise<ClientSecretResult>
  /** The stored sign-in, or null when the user has to sign in. */
  load(): Promise<TokenProvider | null>
  login(successText: string): Promise<TokenProvider>
  logout(tokens: TokenProvider | null): Promise<void>
}

export interface UiBridge {
  screen(screen: Screen): void
  library(state: LibraryState): void
  data(data: LibraryData): void
  status(status: SyncState): void
  message(message: Message): void
  transfers(transfers: Transfer[]): void
  settings(settings: Settings): void
}

export interface FileFilter {
  name: string
  extensions: string[]
}

export interface Hooks {
  ui: UiBridge
  loadSettings(): Settings
  saveSettings(settings: Settings): void
  cacheRoot: string
  /** Suggested local library folder (Pictures/OKgram). */
  defaultFolder: string
  auth: AuthAdapter
  makeDrive(tokens: TokenProvider): MediaBackend
  makeLocal(folder: string): MediaBackend
  pickFiles(): Promise<string[]>
  pickFolder(title: string, defaultPath?: string): Promise<string | null>
  pickSaveFile(defaultName: string, filters: FileFilter[]): Promise<string | null>
  pickOpenFile(filters: FileFilter[]): Promise<string | null>
  writeClipboard(text: string): void
  /** Open with the system's default app; resolves to an error text or ''. */
  openPath(path: string): Promise<string>
  tempDir: string
  /** Decode PNG/JPEG and scale it down to fit `max` pixels; JPEG bytes, or null when it cannot. */
  resizeImage(bytes: Uint8Array, max: number): Uint8Array | null
  nativeFrameChanged?(native: boolean): void
  log(text: string): void
}
