// Small formatting helpers for the chat UI.
export function formatTime(ts: number, language: string): string {
  const date = new Date(ts)
  const now = new Date()
  const time = date.toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' })
  return date.toDateString() === now.toDateString() ? time : `${date.toLocaleDateString(language, { day: 'numeric', month: 'numeric' })} ${time}`
}

export function formatDay(ts: number, language: string): string {
  return new Date(ts).toLocaleDateString(language, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`
}

export const initial = (name: string): string => ([...name.trim()][0] ?? '?').toLocaleUpperCase()

export const shortId = (identifier: string): string => `${identifier.slice(0, 4)}…${identifier.slice(-4)}`

export const groupId = (identifier: string): string => identifier.replace(/(.{4})(?=.)/g, '$1 ')

const IMAGE_TYPES = new Set(['image/gif', 'image/png', 'image/jpeg', 'image/webp'])
const IMAGE_EXTENSIONS = /\.(gif|png|jpe?g|webp)$/i

/** Only real image files are previewed in the chat (the name must agree with the type). */
export const isImage = (mime: string, name: string): boolean => IMAGE_TYPES.has(mime) && IMAGE_EXTENSIONS.test(name)
