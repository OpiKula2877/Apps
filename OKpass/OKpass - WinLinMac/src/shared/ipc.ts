// Contract between the main process and the renderer.
import type { VaultData } from './model'

export type SaveStatus = 'saved' | 'pending' | 'error'
export type SaveState = SaveStatus | 'dirty' | 'saving'

/** Translation key plus parameters; the renderer translates. */
export interface Message {
  key: string
  params?: Record<string, string | number>
  error?: boolean
}

export type Screen =
  | { name: 'loading' }
  | { name: 'login'; needSecret: boolean; busy: boolean; connectError: boolean; message: Message | null }
  | { name: 'key'; email: string; create: boolean; offline: boolean; busy: boolean; biometric: boolean }
  | { name: 'vault'; email: string; vault: VaultData; status: SaveState; online: boolean; session: number }

export interface BackupItem {
  id: string
  name: string
  created: string
}

export interface Settings {
  theme: 'light' | 'dark' | 'opikula' | 'custom'
  custom_colors: Record<string, string>
  custom_flags: Record<string, boolean>
  language: 'cs' | 'en'
  font_size: number
  autolock_minutes: number
  backup_count: number
  last_account: { id?: string; email?: string; name?: string }
  window_bounds: { x?: number; y?: number; width: number; height: number; maximized: boolean } | null
}

export type PlatformName = 'windows' | 'linux' | 'macos' | 'android'

export interface BiometricStatus {
  available: boolean
  enabled: boolean
}

export interface OkpassApi {
  platform: PlatformName
  getScreen(): Promise<Screen>
  onScreen(listener: (screen: Screen) => void): () => void
  onStatus(listener: (status: SaveState) => void): () => void
  onMessage(listener: (message: Message) => void): () => void
  onFlushRequest(listener: () => void): () => void
  flushDone(): void

  chooseClientSecret(): Promise<void>
  login(successText: string): Promise<void>
  retry(): Promise<void>
  submitKey(raw: string): Promise<void>
  /** 'pending' = changes not uploaded yet; call again with force after the user agrees. */
  logout(pending?: VaultData, force?: boolean): Promise<'done' | 'pending'>

  saveVault(vault: VaultData): Promise<SaveStatus>
  lock(pending?: VaultData): Promise<void>
  copyText(text: string): Promise<void>

  getSettings(): Promise<Settings>
  updateSettings(patch: Partial<Settings>): Promise<Settings>
  setDecoy(raw: string): Promise<string | null>
  removeDecoy(): Promise<void>
  isOnline(): Promise<boolean>
  listBackups(): Promise<BackupItem[]>
  restoreBackup(id: string): Promise<boolean>
  exportVault(): Promise<boolean>
  /** Desktop opens a file dialog; the phone passes the bytes the user picked. */
  importVault(data?: Uint8Array): Promise<'ok' | 'cancel' | 'invalid' | 'failed'>

  biometricStatus(): Promise<BiometricStatus>
  /** Switch fingerprint unlock on (for the open vault) or off. */
  setBiometric(on: boolean): Promise<boolean>
  unlockBiometric(): Promise<void>

  windowMinimize(): void
  windowToggleMaximize(): void
  windowClose(): void
  onMaximized(listener: (maximized: boolean) => void): () => void
}
