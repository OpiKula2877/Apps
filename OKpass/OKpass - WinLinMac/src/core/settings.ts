// Local, non-secret settings: defaults and validation (same keys as the Python version).
import type { Settings } from '../shared/ipc'

export const THEMES = ['light', 'dark', 'opikula', 'custom'] as const

export function defaultSettings(): Settings {
  return {
    theme: 'opikula',
    custom_colors: {},
    custom_flags: {},
    language: 'cs',
    font_size: 11,
    autolock_minutes: 15,
    backup_count: 10,
    last_account: {},
    window_bounds: null
  }
}

const clamp = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = Math.round(Number(value))
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export function sanitizeSettings(raw: unknown): Settings {
  const d = defaultSettings()
  const r = isRecord(raw) ? raw : {}
  const bounds = isRecord(r.window_bounds) ? r.window_bounds : null
  return {
    theme: THEMES.includes(r.theme as Settings['theme']) ? (r.theme as Settings['theme']) : d.theme,
    custom_colors: isRecord(r.custom_colors)
      ? (Object.fromEntries(Object.entries(r.custom_colors).filter(([, v]) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v))) as Record<string, string>)
      : {},
    custom_flags: isRecord(r.custom_flags) ? Object.fromEntries(Object.entries(r.custom_flags).map(([k, v]) => [k, Boolean(v)])) : {},
    language: r.language === 'en' ? 'en' : 'cs',
    font_size: clamp(r.font_size, 8, 22, d.font_size),
    autolock_minutes: clamp(r.autolock_minutes, 0, 240, d.autolock_minutes),
    backup_count: clamp(r.backup_count, 0, 50, d.backup_count),
    last_account: isRecord(r.last_account) ? (r.last_account as Settings['last_account']) : {},
    window_bounds:
      bounds && Number(bounds.width) > 0 && Number(bounds.height) > 0
        ? {
            x: Number.isFinite(Number(bounds.x)) ? Number(bounds.x) : undefined,
            y: Number.isFinite(Number(bounds.y)) ? Number(bounds.y) : undefined,
            width: Number(bounds.width),
            height: Number(bounds.height),
            maximized: Boolean(bounds.maximized)
          }
        : null
  }
}
