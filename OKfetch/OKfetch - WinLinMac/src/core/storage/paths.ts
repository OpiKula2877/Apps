// Where OKfetch keeps its data. Settings live outside the storage folder so the folder can be moved.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type DesktopPlatform = 'windows' | 'linux' | 'macos'

export const PLATFORM: DesktopPlatform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux'

/** Settings folder (theme, window, storage path). */
export function configDir(): string {
  if (process.env.OKFETCH_CONFIG_DIR) return process.env.OKFETCH_CONFIG_DIR
  if (PLATFORM === 'windows') return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'OKfetch')
  if (PLATFORM === 'macos') return join(homedir(), 'Library', 'Application Support', 'OKfetch-config')
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'okfetch')
}

/** Default storage folder: C:\OKfetch, ~/.local/share/okfetch or ~/Library/Application Support/OKfetch. */
export function defaultDataDir(): string {
  if (process.env.OKFETCH_DATA_DIR) return process.env.OKFETCH_DATA_DIR
  if (PLATFORM === 'windows') return 'C:\\OKfetch'
  if (PLATFORM === 'macos') return join(homedir(), 'Library', 'Application Support', 'OKfetch')
  return join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'okfetch')
}

/** True when the folder can be created and written to. */
export function isWritable(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true })
    const probe = join(dir, `.write-test-${process.pid}`)
    writeFileSync(probe, 'x')
    rmSync(probe)
    return true
  } catch {
    return false
  }
}

export { chatDirName, safeFileName } from './names'
