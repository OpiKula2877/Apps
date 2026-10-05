import { STRINGS } from './strings'

export type Language = 'cs' | 'en'
export type Translate = (key: string, params?: Record<string, string | number>) => string

export function translator(language: Language): Translate {
  return (key, params) => {
    const entry = STRINGS[key]
    if (!entry) return key
    const text = entry[language] || entry.cs
    return params ? text.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match)) : text
  }
}

const UNITS = ['B', 'kB', 'MB', 'GB', 'TB']

export function formatSize(bytes: number, language: Language): string {
  let value = bytes
  let unit = 0
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000
    unit++
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1
  return `${value.toLocaleString(language === 'cs' ? 'cs-CZ' : 'en-GB', { maximumFractionDigits: digits, minimumFractionDigits: digits })} ${UNITS[unit]}`
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return '–:––'
  const total = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = String(total % 60).padStart(2, '0')
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`
}

export function formatDate(ms: number, language: Language, withTime = true): string {
  if (!ms) return '–'
  return new Date(ms).toLocaleString(language === 'cs' ? 'cs-CZ' : 'en-GB', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {})
  })
}
