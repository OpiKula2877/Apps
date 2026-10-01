// Interface every remote storage (Google Drive, local dev folder) implements.

export class OfflineError extends Error {
  name = 'OfflineError'
}

/** The stored login is no longer valid. */
export class AuthError extends Error {
  name = 'AuthError'
}

/** Any other failure reported by the remote storage. */
export class BackendError extends Error {
  name = 'BackendError'
}

/** Neither the remote storage nor the local cache can provide the vault. */
export class NoDataError extends Error {
  name = 'NoDataError'
}

export interface Account {
  id: string
  email: string
  displayName: string
}

export interface RemoteVault {
  data: Uint8Array
  revision: string
}

export interface BackupInfo {
  id: string
  name: string
  /** ISO 8601 */
  created: string
}

export interface StorageBackend {
  account(): Promise<Account>
  downloadVault(): Promise<RemoteVault | null>
  uploadVault(data: Uint8Array): Promise<string>
  listBackups(): Promise<BackupInfo[]>
  createBackup(data: Uint8Array, name: string): Promise<void>
  downloadBackup(id: string): Promise<Uint8Array>
  deleteBackup(id: string): Promise<void>
}
