// Helpers for message HTML: plain-text extraction (limits, previews, notifications).

export const OFFLINE_CHAR_LIMIT = 5000

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

export function plainText(html: string): string {
  return html
    .replace(/<\/(p|h1|h2|div)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code: string) => {
      if (code[0] === '#') {
        const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
        return Number.isFinite(point) && point > 0 && point < 0x110000 ? String.fromCodePoint(point) : match
      }
      return ENTITIES[code.toLowerCase()] ?? match
    })
    .replace(/\n+$/, '')
}

export function textLength(html: string): number {
  return [...plainText(html)].length
}

export function isEmptyMessage(html: string): boolean {
  return plainText(html).trim().length === 0
}

export function preview(html: string, max = 120): string {
  const text = plainText(html).replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** Escape text for use inside HTML (used for file names and similar). */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
