// What every storage (Google Drive, local folder) provides to the controller.
import type { MediaItem, StorageMode } from '../shared/ipc'

export class OfflineError extends Error {
  name = 'OfflineError'
}

/** The stored login is no longer valid. */
export class AuthError extends Error {
  name = 'AuthError'
}

/** Any other failure reported by the storage. */
export class BackendError extends Error {
  name = 'BackendError'
}

export interface Account {
  id: string
  email: string
  displayName: string
}

export interface RemoteData {
  data: Uint8Array
  revision: string
}

/** A file on this computer that is being added to the library. */
export interface UploadSource {
  path: string
  name: string
  size: number
  mime: string
  /** File date in ms; kept on Drive so sorting by date still works. */
  modified: number
  read(start: number, end: number): Promise<Uint8Array>
}

export interface MediaBackend {
  readonly kind: StorageMode
  account(): Promise<Account>
  listMedia(): Promise<MediaItem[]>
  readData(): Promise<RemoteData | null>
  /** Revision of the data file without downloading it; null = no file yet. */
  dataRevision(): Promise<string | null>
  writeData(data: Uint8Array): Promise<string>
  upload(source: UploadSource, onProgress: (done: number) => void, signal: AbortSignal): Promise<MediaItem>
  rename(id: string, name: string): Promise<MediaItem>
  trash(id: string): Promise<void>
  /** The file content as a streamed response; `range` is an HTTP Range header value. */
  open(id: string, range: string | null, signal?: AbortSignal): Promise<Response>
  /** A small preview made by the storage, or null when it has none. */
  thumbnail(id: string): Promise<Uint8Array | null>
  share(id: string): Promise<string>
  unshare(id: string): Promise<void>
  quota(): Promise<{ used: number; limit: number | null } | null>
  /** Local folder only: the absolute path of a file. */
  localPath?(id: string): string
  /** Local folder only: report outside changes; returns a function that stops watching. */
  watch?(onChange: () => void): () => void
}
