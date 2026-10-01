// Desktop paths (same as the Python version) and the settings file.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { defaultSettings, sanitizeSettings } from '../core/settings'
import type { Settings } from '../shared/ipc'

export type DesktopPlatform = 'windows' | 'linux' | 'macos'

export const PLATFORM: DesktopPlatform =
  process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux'

export function configDir(): string {
  if (process.env.OKPASS_CONFIG_DIR) return process.env.OKPASS_CONFIG_DIR
  if (PLATFORM === 'windows') return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'OKpass')
  if (PLATFORM === 'macos') return join(homedir(), 'Library', 'Application Support', 'OKpass')
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'okpass')
}

export function cacheDir(): string {
  if (process.env.OKPASS_CACHE_DIR) return process.env.OKPASS_CACHE_DIR
  if (PLATFORM === 'windows') return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'OKpass', 'cache')
  if (PLATFORM === 'macos') return join(homedir(), 'Library', 'Caches', 'OKpass')
  return join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'okpass')
}

export const clientSecretPath = (): string => join(configDir(), 'client_secret.json')
export const tokenPath = (): string => join(configDir(), 'token.json')
const settingsPath = (): string => join(configDir(), 'settings.json')

export function loadSettings(): Settings {
  try {
    if (!existsSync(settingsPath())) return defaultSettings()
    return sanitizeSettings(JSON.parse(readFileSync(settingsPath(), 'utf8')))
  } catch {
    return defaultSettings()
  }
}

export function saveSettings(settings: Settings): void {
  mkdirSync(configDir(), { recursive: true })
  const tmp = `${settingsPath()}.tmp`
  writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf8')
  renameSync(tmp, settingsPath())
}
