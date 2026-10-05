// Contract between the main process and the renderer windows.
import type { DataOp, LibraryData } from './model'

export type StorageMode = 'drive' | 'local'
export type MediaKind = 'image' | 'video'
export type SortBy = 'date' | 'name' | 'format' | 'size'
export type SyncState = 'saved' | 'saving' | 'pending' | 'error'
export type PlatformName = 'windows' | 'linux' | 'macos'

/** One photo or video in the library. Times are milliseconds since the epoch. */
export interface MediaItem {
  /** Drive file id, or the path relative to the library folder (with "/"). */
  id: string
  name: string
  /** Lower-case extension without the dot. */
  ext: string
  kind: MediaKind
  mime: string
  size: number
  created: number
  modified: number
  /** When the photo was taken (from the file's metadata), if known. */
  taken: number | null
  width: number | null
  height: number | null
  /** Video length in milliseconds, if known. */
  duration: number | null
  /** Changes whenever the content changes; part of the thumbnail cache key. */
  version: string
  /** Drive only: anyone with the link can open the file. */
  shared: boolean
}

/** Translation key plus parameters; the renderer translates. */
export interface Message {
  key: string
  params?: Record<string, string | number>
  error?: boolean
}

export interface AccountInfo {
  /** Google e-mail (Drive) or the folder path (local). */
  email: string
  name: string
}

export type Screen =
  | { name: 'loading' }
  | {
      name: 'welcome'
      /** Chosen storage, null until the user picks one. */
      mode: StorageMode | null
      needSecret: boolean
      busy: boolean
      connectError: boolean
      message: Message | null
      defaultFolder: string
    }
  | { name: 'library'; mode: StorageMode; account: AccountInfo; session: number }

export interface LibraryState {
  media: MediaItem[]
  online: boolean
  /** The media list is being loaded from storage. */
  loading: boolean
}

export interface Transfer {
  id: string
  name: string
  kind: 'upload' | 'download' | 'zip'
  done: number
  total: number
  state: 'queued' | 'active' | 'done' | 'error' | 'cancelled'
  error?: string
}

export interface Quota {
  used: number
  /** null = unlimited */
  limit: number | null
  /** Bytes taken by the media of this library. */
  library: number
}

export interface Bounds {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}

/** Preferences stored with the library (Google Drive or the local folder), so every computer shares them. */
export interface Prefs {
  theme: 'light' | 'dark' | 'opikula' | 'custom'
  custom_colors: Record<string, string>
  custom_flags: Record<string, boolean>
  language: 'cs' | 'en'
  font_size: number
  /** Thumbnail edge in pixels. */
  thumb_size: number
  view: 'grid' | 'list'
  sort_by: SortBy
  sort_desc: boolean
  album_sort: 'manual' | 'name' | 'date'
  slideshow_seconds: number
  video_autoplay: boolean
  video_loop: boolean
}

/** Settings of this computer only (settings.json). */
export interface DeviceSettings {
  storage: StorageMode | null
  local_folder: string | null
  /** null = ask where to save every time. */
  download_folder: string | null
  /** Background refresh interval; 0 = off. */
  sync_minutes: number
  volume: number
  last_account: { id?: string; email?: string; name?: string }
  window_bounds: Bounds | null
  viewer_bounds: Bounds | null
}

export type Settings = Prefs & DeviceSettings

export interface VideoInfo {
  width: number
  height: number
  duration: number
}

export interface ViewerContext {
  ids: string[]
  index: number
  slideshow: boolean
  /** Bumped on every new request, so the viewer knows to jump. */
  serial: number
}

export type RenameResult = 'ok' | 'invalid' | 'exists' | 'failed'
export type ImportResult = 'ok' | 'cancel' | 'invalid'

export interface OkgramApi {
  platform: PlatformName
  /** This window shows one photo or video (opened from the library). */
  isViewer: boolean

  getScreen(): Promise<Screen>
  onScreen(listener: (screen: Screen) => void): () => void
  onMessage(listener: (message: Message) => void): () => void
  getLibrary(): Promise<LibraryState>
  onLibrary(listener: (state: LibraryState) => void): () => void
  getData(): Promise<LibraryData>
  onData(listener: (data: LibraryData) => void): () => void
  getStatus(): Promise<SyncState>
  onStatus(listener: (status: SyncState) => void): () => void
  getTransfers(): Promise<Transfer[]>
  onTransfers(listener: (transfers: Transfer[]) => void): () => void
  getSettings(): Promise<Settings>
  onSettings(listener: (settings: Settings) => void): () => void
  updateSettings(patch: Partial<Settings>): Promise<Settings>

  // welcome
  chooseMode(mode: StorageMode | null): Promise<void>
  chooseClientSecret(): Promise<void>
  login(successText: string): Promise<void>
  retry(): Promise<void>
  /** Local library: null = the default folder, true = pick one in a dialog. */
  openLocal(folder: string | null | true): Promise<void>
  /** Drive: sign out; local: close the library. 'pending' = unsaved changes, call again with force. */
  leave(force?: boolean): Promise<'done' | 'pending'>

  // library
  refresh(): Promise<void>
  mutate(op: DataOp): Promise<void>
  /** No paths: pick files in a dialog. albumId: also add the new files to that album. */
  upload(paths?: string[], albumId?: string | null): Promise<void>
  pathForFile(file: File): string
  download(ids: string[]): Promise<void>
  downloadZip(ids: string[], name: string): Promise<void>
  cancelTransfer(id: string): Promise<void>
  clearTransfers(): Promise<void>
  rename(id: string, name: string): Promise<RenameResult>
  trash(ids: string[]): Promise<number>
  /** Drive: make the file readable by anyone with the link; returns the link (copied to the clipboard). */
  share(id: string): Promise<string | null>
  unshare(id: string): Promise<boolean>
  copyText(text: string): Promise<void>
  /** Open the file in the system's default app (for videos the built-in player cannot play). */
  openInSystem(id: string): Promise<boolean>
  /** A thumbnail the window made itself (video frame, rotated JPEG) and, for videos, the size and length. */
  storeThumbnail(id: string, version: string, thumbnail: Uint8Array | null, info: VideoInfo | null): Promise<void>
  quota(): Promise<Quota | null>
  cacheSize(): Promise<number>
  clearCache(): Promise<void>
  exportSettings(): Promise<boolean>
  importSettings(): Promise<ImportResult>
  pickDownloadFolder(): Promise<string | null>
  openLogs(): Promise<void>
  log(text: string): void

  // viewer window
  openViewer(ids: string[], index: number, slideshow?: boolean): Promise<void>
  getViewerContext(): Promise<ViewerContext>
  onViewerContext(listener: (context: ViewerContext) => void): () => void

  // window
  windowMinimize(): void
  windowToggleMaximize(): void
  windowClose(): void
  setFullScreen(on: boolean): void
  onMaximized(listener: (maximized: boolean) => void): () => void
  onFullScreen(listener: (fullScreen: boolean) => void): () => void
}
