// settings.json of this computer: storage choice, folders, window sizes and a copy of the
// library preferences (so the theme is right even before the library opens).
import type { Bounds, DeviceSettings, Settings } from '../shared/ipc'
import { clamp, defaultPrefs, isRecord, sanitizePrefs } from '../shared/prefs'

export function defaultDevice(): DeviceSettings {
  return {
    storage: null,
    local_folder: null,
    download_folder: null,
    sync_minutes: 5,
    volume: 0.8,
    last_account: {},
    window_bounds: null,
    viewer_bounds: null
  }
}

export function defaultSettings(): Settings {
  return { ...defaultPrefs(), ...defaultDevice() }
}

function bounds(value: unknown): Bounds | null {
  if (!isRecord(value) || !(Number(value.width) > 0) || !(Number(value.height) > 0)) return null
  return {
    x: Number.isFinite(Number(value.x)) ? Number(value.x) : undefined,
    y: Number.isFinite(Number(value.y)) ? Number(value.y) : undefined,
    width: Number(value.width),
    height: Number(value.height),
    maximized: Boolean(value.maximized)
  }
}

const path = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null)

export function sanitizeSettings(raw: unknown): Settings {
  const d = defaultDevice()
  const r = isRecord(raw) ? raw : {}
  const volume = Number(r.volume)
  return {
    ...sanitizePrefs(r),
    storage: r.storage === 'drive' || r.storage === 'local' ? r.storage : null,
    local_folder: path(r.local_folder),
    download_folder: path(r.download_folder),
    sync_minutes: clamp(r.sync_minutes, 0, 120, d.sync_minutes),
    volume: Number.isFinite(volume) ? Math.min(Math.max(volume, 0), 1) : d.volume,
    last_account: isRecord(r.last_account) ? (r.last_account as Settings['last_account']) : {},
    window_bounds: bounds(r.window_bounds),
    viewer_bounds: bounds(r.viewer_bounds)
  }
}
