import { describe, expect, it } from 'vitest'
import { jpegOrientation, readImageInfo } from '../src/core/imageSize'

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}

/** Minimal JPEG: EXIF (orientation + DateTimeOriginal, little endian) and an SOF0 block. */
function jpeg(width: number, height: number, orientation: number, taken: string): Uint8Array {
  const tiff: number[] = []
  const u16 = (v: number): void => void tiff.push(v & 0xff, v >> 8)
  const u32 = (v: number): void => void tiff.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24)
  tiff.push(0x49, 0x49) // "II"
  u16(42)
  u32(8) // IFD0 at 8
  u16(2) // two entries
  u16(0x0112), u16(3), u32(1), u16(orientation), u16(0)
  u16(0x8769), u16(4), u32(1), u32(38) // Exif IFD at 38
  u32(0) // next IFD
  // offset 38: Exif IFD
  u16(1)
  u16(0x9003), u16(2), u32(20), u32(56) // string at 56
  u32(0)
  // offset 56: the date
  for (const c of `${taken}\0`) tiff.push(c.charCodeAt(0))
  const exif = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]
  const app1 = [0xff, 0xe1, (exif.length + 2) >> 8, (exif.length + 2) & 0xff, ...exif]
  const sof = [0xff, 0xc0, 0, 17, 8, height >> 8, height & 0xff, width >> 8, width & 0xff, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]
  return new Uint8Array([0xff, 0xd8, ...app1, ...sof, 0xff, 0xd9])
}

describe('readImageInfo', () => {
  it('reads PNG and GIF sizes', () => {
    expect(readImageInfo(png(640, 480), 'png')).toEqual({ width: 640, height: 480, taken: null })
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x20, 0x03, 0x58, 0x02])
    expect(readImageInfo(gif, 'gif')).toEqual({ width: 800, height: 600, taken: null })
  })

  it('reads JPEG size, turns it by the EXIF orientation and finds the shooting time', () => {
    const upright = readImageInfo(jpeg(4000, 3000, 1, '2024:07:31 18:02:11'), 'jpg')
    expect(upright).toMatchObject({ width: 4000, height: 3000 })
    expect(new Date(upright!.taken!).getFullYear()).toBe(2024)
    expect(new Date(upright!.taken!).getHours()).toBe(18)
    expect(readImageInfo(jpeg(4000, 3000, 6, '2024:07:31 18:02:11'), 'jpeg')).toMatchObject({ width: 3000, height: 4000 })
    expect(jpegOrientation(jpeg(10, 10, 6, '2024:07:31 18:02:11'))).toBe(6)
    expect(jpegOrientation(jpeg(10, 10, 1, '0000:00:00 00:00:00'))).toBe(1)
    expect(readImageInfo(jpeg(10, 10, 1, '0000:00:00 00:00:00'), 'jpg')?.taken).toBeNull()
  })

  it('reads SVG width/height or viewBox', () => {
    const enc = (s: string) => new TextEncoder().encode(s)
    expect(readImageInfo(enc('<?xml version="1.0"?><svg xmlns="x" width="120px" height="80">'), 'svg')).toMatchObject({ width: 120, height: 80 })
    expect(readImageInfo(enc('<svg viewBox="0 0 24 12"><path/></svg>'), 'svg')).toMatchObject({ width: 24, height: 12 })
    expect(readImageInfo(enc('<svg width="100%">'), 'svg')).toBeNull()
  })

  it('does not throw on broken files', () => {
    expect(readImageInfo(new Uint8Array([0xff, 0xd8, 0xff]), 'jpg')).toBeNull()
    expect(readImageInfo(new Uint8Array(0), 'png')).toBeNull()
  })
})
