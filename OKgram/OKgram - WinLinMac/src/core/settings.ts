// settings.json of this computer: the sources, folders, window sizes and a copy of the
// library preferences (so the theme is right even before the sources open).
import type { Bounds, DeviceSettings, Settings, SourceConfig } from '../shared/ipc'
import { ALBUM_ICONS, FRAME_COLORS, type AlbumIcon, type FrameColor } from '../shared/model'
import { clamp, defaultPrefs, isRecord, sanitizePrefs } from '../shared/prefs'

/** Source id of a Google account that was signed in before sources existed (keeps its token). */
export const LEGACY_DRIVE_ID = 'drive0'

export function defaultDevice(): DeviceSettings {
  return {
    sources: [],
    download_folder: null,
    sync_minutes: 5,
    volume: 0.8,
    sources_panel: true,
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
const text = (value: unknown): string => (typeof value === 'string' ? value : '')

const folderName = (folder: string): string => folder.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || folder

export function sanitizeSource(raw: unknown): SourceConfig | null {
  if (!isRecord(raw) || !/^[A-Za-z0-9_-]{1,40}$/.test(text(raw.id))) return null
  const kind = raw.kind === 'drive' ? 'drive' : raw.kind === 'local' ? 'local' : null
  if (!kind) return null
  const account = isRecord(raw.account) && text(raw.account.id) ? { id: text(raw.account.id), email: text(raw.account.email), name: text(raw.account.name) } : null
  if (kind === 'local' && !path(raw.path)) return null
  return {
    id: text(raw.id),
    kind,
    name: text(raw.name).trim().slice(0, 60) || (kind === 'local' ? folderName(path(raw.path)!) : account?.email || 'Google Disk'),
    icon: ALBUM_ICONS.includes(raw.icon as AlbumIcon) ? (raw.icon as AlbumIcon) : kind === 'drive' ? 'globe' : 'folder',
    color: FRAME_COLORS.includes(raw.color as FrameColor) ? (raw.color as FrameColor) : null,
    enabled: raw.enabled !== false,
    path: kind === 'local' ? path(raw.path) : null,
    subfolders: raw.subfolders !== false,
    account: kind === 'drive' ? account : null
  }
}

/** Settings from before sources existed: one storage (Drive or a folder) becomes one source. */
function migrate(r: Record<string, unknown>): SourceConfig[] {
  const last = isRecord(r.last_account) ? r.last_account : {}
  if (r.storage === 'local' && path(r.local_folder)) {
    return [sanitizeSource({ id: 'local0', kind: 'local', path: r.local_folder })!]
  }
  if (r.storage === 'drive') {
    const account = text(last.id) ? { id: last.id, email: last.email, name: last.name } : null
    return [sanitizeSource({ id: LEGACY_DRIVE_ID, kind: 'drive', name: text(last.email), account })!]
  }
  return []
}

export function sanitizeSettings(raw: unknown): Settings {
  const d = defaultDevice()
  const r = isRecord(raw) ? raw : {}
  const volume = Number(r.volume)
  const sources: SourceConfig[] = []
  for (const item of Array.isArray(r.sources) ? r.sources : migrate(r)) {
    const source = sanitizeSource(item)
    if (source && !sources.some((s) => s.id === source.id)) sources.push(source)
  }
  return {
    ...sanitizePrefs(r),
    sources,
    download_folder: path(r.download_folder),
    sync_minutes: clamp(r.sync_minutes, 0, 120, d.sync_minutes),
    volume: Number.isFinite(volume) ? Math.min(Math.max(volume, 0), 1) : d.volume,
    sources_panel: r.sources_panel !== false,
    window_bounds: bounds(r.window_bounds),
    viewer_bounds: bounds(r.viewer_bounds)
  }
}
