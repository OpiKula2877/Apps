// HTTP Range header (single range only), used to stream videos so seeking works.

export interface ByteRange {
  start: number
  /** inclusive */
  end: number
}

/** null = no usable Range header (send the whole file); 'invalid' = range outside the file (416). */
export function parseRange(header: string | null, size: number): ByteRange | null | 'invalid' {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.split(',')[0].trim())
  if (!match || (!match[1] && !match[2])) return null
  if (!match[1]) {
    const suffix = Number(match[2])
    if (suffix === 0) return 'invalid'
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }
  const start = Number(match[1])
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
  if (start >= size || start > end) return 'invalid'
  return { start, end }
}
