// Defaults and validation of the preferences that travel with the library.
import type { Prefs, SortBy } from './ipc'

export const THEMES = ['light', 'dark', 'opikula', 'custom'] as const
export const SORTS: SortBy[] = ['date', 'name', 'format', 'size']
export const THUMB_MIN = 96
export const THUMB_MAX = 320

export function defaultPrefs(): Prefs {
  return {
    theme: 'opikula',
    custom_colors: {},
    custom_flags: {},
    language: 'cs',
    font_size: 11,
    thumb_size: 170,
    view: 'grid',
    sort_by: 'date',
    sort_desc: true,
    album_sort: 'manual',
    slideshow_seconds: 4,
    video_autoplay: true,
    video_loop: false
  }
}

export const PREF_KEYS = Object.keys(defaultPrefs()) as (keyof Prefs)[]

export const clamp = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = Math.round(Number(value))
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export function sanitizePrefs(raw: unknown): Prefs {
  const d = defaultPrefs()
  const r = isRecord(raw) ? raw : {}
  return {
    theme: THEMES.includes(r.theme as Prefs['theme']) ? (r.theme as Prefs['theme']) : d.theme,
    custom_colors: isRecord(r.custom_colors)
      ? (Object.fromEntries(Object.entries(r.custom_colors).filter(([, v]) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v))) as Record<string, string>)
      : {},
    custom_flags: isRecord(r.custom_flags) ? Object.fromEntries(Object.entries(r.custom_flags).map(([k, v]) => [k, Boolean(v)])) : {},
    language: r.language === 'en' ? 'en' : 'cs',
    font_size: clamp(r.font_size, 8, 22, d.font_size),
    thumb_size: clamp(r.thumb_size, THUMB_MIN, THUMB_MAX, d.thumb_size),
    view: r.view === 'list' ? 'list' : 'grid',
    sort_by: SORTS.includes(r.sort_by as SortBy) ? (r.sort_by as SortBy) : d.sort_by,
    sort_desc: typeof r.sort_desc === 'boolean' ? r.sort_desc : d.sort_desc,
    album_sort: r.album_sort === 'name' || r.album_sort === 'date' ? r.album_sort : 'manual',
    slideshow_seconds: clamp(r.slideshow_seconds, 1, 60, d.slideshow_seconds),
    video_autoplay: typeof r.video_autoplay === 'boolean' ? r.video_autoplay : d.video_autoplay,
    video_loop: typeof r.video_loop === 'boolean' ? r.video_loop : d.video_loop
  }
}

/** The preference keys of a settings patch. */
export function pickPrefs(patch: Record<string, unknown>): Partial<Prefs> {
  return Object.fromEntries(Object.entries(patch).filter(([key]) => (PREF_KEYS as string[]).includes(key))) as Partial<Prefs>
}
