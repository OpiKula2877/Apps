// Settings file (outside the storage folder, so the storage can be moved) and the storage location.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defaultSettings, sanitizeSettings } from '../core/settings'
import { configDir, defaultDataDir } from '../core/storage/paths'
import type { Settings } from '../shared/ipc'

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

/** Storage folder: environment override (tests), then the user's choice, then the default of the system. */
export function storageRoot(settings: Settings): string {
  return process.env.OKFETCH_DATA_DIR || settings.storage_path || defaultDataDir()
}

/** Local DHT bootstrap for tests: OKFETCH_BOOTSTRAP="127.0.0.1:49737,127.0.0.1:49738". */
export function bootstrapFromEnv(): { host: string; port: number }[] | undefined {
  const raw = process.env.OKFETCH_BOOTSTRAP
  if (!raw) return undefined
  const nodes = raw.split(',').map((entry) => {
    const [host, port] = entry.trim().split(':')
    return { host, port: Number(port) }
  })
  return nodes.filter((n) => n.host && Number.isFinite(n.port))
}
