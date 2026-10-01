// Colour palettes and visual toggles (same values as the Python version).
import type { Settings } from './ipc'

export const COLOR_ROLES = [
  'background',
  'surface',
  'titlebar',
  'titlebar_text',
  'text',
  'text_muted',
  'input',
  'border',
  'accent',
  'accent_text',
  'danger',
  'success'
] as const
export type ColorRole = (typeof COLOR_ROLES)[number]
export type Palette = Record<ColorRole, string>

export const FLAG_NAMES = ['titlebar_border', 'window_border', 'rounded', 'tab_underline', 'list_separators', 'native_titlebar'] as const
export type FlagName = (typeof FLAG_NAMES)[number]
export type Flags = Record<FlagName, boolean>

export const PRESETS: Record<'light' | 'dark' | 'opikula', Palette> = {
  light: {
    background: '#F4F4F6', surface: '#FFFFFF', titlebar: '#E7E7EB', titlebar_text: '#1C1C1E', text: '#1C1C1E',
    text_muted: '#6B6B73', input: '#FFFFFF', border: '#D0D0D7', accent: '#2F6FEB', accent_text: '#FFFFFF',
    danger: '#D93025', success: '#1E8E3E'
  },
  dark: {
    background: '#1B1B1F', surface: '#232328', titlebar: '#141417', titlebar_text: '#E8E8EC', text: '#E8E8EC',
    text_muted: '#9A9AA3', input: '#2B2B31', border: '#3A3A42', accent: '#4C8DFF', accent_text: '#FFFFFF',
    danger: '#FF5C5C', success: '#3FCB6A'
  },
  opikula: {
    background: '#0E0A0A', surface: '#170D0E', titlebar: '#1F0508', titlebar_text: '#F5E9E9', text: '#F2E6E6',
    text_muted: '#A88A8C', input: '#1E1112', border: '#4A1218', accent: '#C8102E', accent_text: '#FFFFFF',
    danger: '#FF3B4E', success: '#4CC77A'
  }
}

export const DEFAULT_FLAGS: Flags = {
  titlebar_border: true,
  window_border: true,
  rounded: true,
  tab_underline: true,
  list_separators: false,
  native_titlebar: false
}

const HEX = /^#[0-9a-fA-F]{6}$/

export function resolveColors(settings: Pick<Settings, 'theme' | 'custom_colors'>): Palette {
  if (settings.theme !== 'custom') return { ...PRESETS[settings.theme] }
  const colors = { ...PRESETS.opikula }
  for (const role of COLOR_ROLES) {
    const value = settings.custom_colors[role]
    if (value && HEX.test(value)) colors[role] = value.toUpperCase()
  }
  return colors
}

export function resolveFlags(settings: Pick<Settings, 'theme' | 'custom_flags'>): Flags {
  const flags = { ...DEFAULT_FLAGS }
  if (settings.theme === 'custom') {
    for (const name of FLAG_NAMES) if (name in settings.custom_flags) flags[name] = Boolean(settings.custom_flags[name])
  }
  return flags
}

/** Blend two #RRGGBB colours (ratio 0 = a, 1 = b). */
export function mix(a: string, b: string, ratio: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16))
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16))
  return `#${pa.map((v, i) => Math.round(v + (pb[i] - v) * ratio).toString(16).padStart(2, '0')).join('')}`
}

export function lightness(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 2
}
