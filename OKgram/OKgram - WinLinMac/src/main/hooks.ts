// What the controller needs from Electron. Passed in as callbacks, so the controller
// and the storage code run in tests without Electron.
import type { ClientSecretResult, LibraryState, Message, Screen, Settings, SourceState, SyncState, Transfer } from '../shared/ipc'
import type { LibraryData } from '../shared/model'
import type { MediaBackend } from '../core/backend'
import type { TokenProvider } from '../core/driveRest'

export interface AuthAdapter {
  hasClientSecret(): Promise<boolean>
  chooseClientSecret(): Promise<ClientSecretResult>
  /** The stored sign-in of a source, or null. adoptLegacy: take over the token from before sources existed. */
  load(source: string, adoptLegacy: boolean): Promise<TokenProvider | null>
  login(source: string, successText: string): Promise<TokenProvider>
  logout(source: string, tokens: TokenProvider | null): Promise<void>
}

export interface UiBridge {
  screen(screen: Screen): void
  library(state: LibraryState): void
  data(data: LibraryData): void
  status(status: SyncState): void
  message(message: Message): void
  transfers(transfers: Transfer[]): void
  settings(settings: Settings): void
  sources(sources: SourceState[]): void
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
  /** Suggested folder for a new local source (Pictures/OKgram). */
  defaultFolder: string
  auth: AuthAdapter
  makeDrive(tokens: TokenProvider): MediaBackend
  makeLocal(folder: string, subfolders: boolean): MediaBackend
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
