// Desktop implementation of Platform. Electron-specific parts (dialogs, clipboard,
// window) come in as callbacks, so tests can build it without Electron.
import { readFileSync, writeFileSync } from 'node:fs'
import { DriveRestBackend } from '../core/driveRest'
import type { KdfParams } from '../core/kdf'
import type { Platform, TokenProvider, UiBridge } from '../core/platform'
import { PLATFORM, cacheDir, loadSettings, saveSettings } from './config'
import { createNodeAuth } from './drive/auth'
import { LocalFolderBackend } from './drive/localBackend'
import { LocalCache } from './localCache'

export interface FileFilter {
  name: string
  extensions: string[]
}

export interface DesktopHooks {
  ui: UiBridge
  /** --local-dev folder; null for Google Drive. */
  devFolder: string | null
  openExternal(url: string): Promise<void>
  pickFile(filters: FileFilter[]): Promise<string | null>
  saveFile(defaultName: string, filters: FileFilter[]): Promise<string | null>
  writeClipboard(text: string): void
  nativeFrameChanged?(native: boolean): void
  kdfParams?: KdfParams
}

const OKP: FileFilter[] = [{ name: 'OKpass', extensions: ['okp'] }]

export function createNodePlatform(hooks: DesktopHooks): Platform {
  return {
    name: PLATFORM,
    ui: hooks.ui,
    devMode: hooks.devFolder !== null,
    loadSettings: async () => loadSettings(),
    saveSettings: async (settings) => saveSettings(settings),
    cacheFor: (accountId) => new LocalCache(cacheDir(), accountId),
    auth: createNodeAuth(hooks.openExternal, () => hooks.pickFile([{ name: 'JSON', extensions: ['json'] }])),
    makeBackend: (tokens: TokenProvider | null) => (hooks.devFolder ? new LocalFolderBackend(hooks.devFolder) : new DriveRestBackend(tokens!)),
    async exportFile(name, data) {
      const path = await hooks.saveFile(name, OKP)
      if (!path) return false
      writeFileSync(path, data)
      return true
    },
    async importFile() {
      const path = await hooks.pickFile(OKP)
      return path ? new Uint8Array(readFileSync(path)) : null
    },
    writeClipboard: async (text) => hooks.writeClipboard(text),
    nativeFrameChanged: hooks.nativeFrameChanged,
    kdfParams: hooks.kdfParams
  }
}
