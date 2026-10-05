// Image size (and for JPEG the EXIF orientation and shooting time) read from the first bytes
// of a file, so a folder with thousands of photos can be listed without decoding them.

export interface ImageInfo {
  width: number
  height: number
  /** When the photo was taken (EXIF DateTimeOriginal), camera local time. */
  taken: number | null
}

const ascii = (bytes: Uint8Array, start: number, length: number): string => String.fromCharCode(...bytes.subarray(start, start + length))

function png(b: DataView): ImageInfo | null {
  if (b.byteLength < 24 || b.getUint32(0) !== 0x89504e47) return null
  return { width: b.getUint32(16), height: b.getUint32(20), taken: null }
}

function gif(bytes: Uint8Array, b: DataView): ImageInfo | null {
  if (b.byteLength < 10 || ascii(bytes, 0, 3) !== 'GIF') return null
  return { width: b.getUint16(6, true), height: b.getUint16(8, true), taken: null }
}

function exifTime(text: string): number | null {
  const match = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(text)
  if (!match) return null
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number)
  if (year < 1900) return null
  const time = new Date(year, month - 1, day, hour, minute, second).getTime()
  return Number.isFinite(time) ? time : null
}

/** EXIF block (TIFF header at `start`): orientation from IFD0, DateTimeOriginal from the Exif IFD. */
function exif(bytes: Uint8Array, b: DataView, start: number, end: number): { orientation: number; taken: number | null } {
  const result = { orientation: 1, taken: null as number | null }
  if (start + 8 > end) return result
  const little = ascii(bytes, start, 2) === 'II'
  const u16 = (at: number): number => b.getUint16(at, little)
  const u32 = (at: number): number => b.getUint32(at, little)
  const readIfd = (offset: number, visit: (tag: number, entry: number) => void): void => {
    const at = start + offset
    if (offset < 8 || at + 2 > end) return
    const count = u16(at)
    for (let i = 0; i < count && at + 2 + i * 12 + 12 <= end; i++) visit(u16(at + 2 + i * 12), at + 2 + i * 12)
  }
  let exifIfd = 0
  readIfd(u32(start + 4), (tag, entry) => {
    if (tag === 0x0112) result.orientation = u16(entry + 8)
    if (tag === 0x8769) exifIfd = u32(entry + 8)
  })
  readIfd(exifIfd, (tag, entry) => {
    if (tag !== 0x9003) return
    const at = start + u32(entry + 8)
    if (at + 19 <= end) result.taken = exifTime(ascii(bytes, at, 19))
  })
  return result
}

function jpeg(bytes: Uint8Array, b: DataView): ImageInfo | null {
  if (b.byteLength < 4 || b.getUint16(0) !== 0xffd8) return null
  let at = 2
  let orientation = 1
  let taken: number | null = null
  while (at + 9 < b.byteLength) {
    if (bytes[at] !== 0xff) {
      at++
      continue
    }
    const marker = bytes[at + 1]
    if (marker === 0xff) {
      at++
      continue
    }
    const length = b.getUint16(at + 2)
    if (marker === 0xe1 && ascii(bytes, at + 4, 4) === 'Exif') {
      const info = exif(bytes, b, at + 10, Math.min(at + 2 + length, b.byteLength))
      orientation = info.orientation
      taken = info.taken
    }
    // SOF0–SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the size.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = b.getUint16(at + 5)
      const width = b.getUint16(at + 7)
      // Orientations 5–8 turn the picture by 90°.
      return orientation >= 5 && orientation <= 8 ? { width: height, height: width, taken } : { width, height, taken }
    }
    at += 2 + length
  }
  return null
}

const SVG_NUMBER = /^\s*([\d.]+)\s*(px)?\s*$/

function svg(bytes: Uint8Array): ImageInfo | null {
  const text = new TextDecoder().decode(bytes.subarray(0, 8192))
  const tag = /<svg\b[^>]*>/i.exec(text)?.[0]
  if (!tag) return null
  const attr = (name: string): string | undefined => new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)?.[1]
  const width = SVG_NUMBER.exec(attr('width') ?? '')?.[1]
  const height = SVG_NUMBER.exec(attr('height') ?? '')?.[1]
  if (width && height) return { width: Math.round(Number(width)), height: Math.round(Number(height)), taken: null }
  const box = attr('viewBox')?.trim().split(/[\s,]+/).map(Number)
  if (box && box.length === 4 && box[2] > 0 && box[3] > 0) return { width: Math.round(box[2]), height: Math.round(box[3]), taken: null }
  return null
}

/** EXIF orientation of a JPEG (1 = upright, 2–8 = mirrored or turned). */
export function jpegOrientation(bytes: Uint8Array): number {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return 1
    let at = 2
    while (at + 9 < view.byteLength && bytes[at] === 0xff) {
      const marker = bytes[at + 1]
      const length = view.getUint16(at + 2)
      if (marker === 0xe1 && ascii(bytes, at + 4, 4) === 'Exif') return exif(bytes, view, at + 10, Math.min(at + 2 + length, view.byteLength)).orientation
      if (marker === 0xda) break
      at += 2 + length
    }
  } catch {
    // broken header
  }
  return 1
}

export function readImageInfo(bytes: Uint8Array, ext: string): ImageInfo | null {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    if (ext === 'png') return png(view)
    if (ext === 'gif') return gif(bytes, view)
    if (ext === 'jpg' || ext === 'jpeg') return jpeg(bytes, view)
    if (ext === 'svg') return svg(bytes)
  } catch {
    // truncated or broken file: size unknown
  }
  return null
}
