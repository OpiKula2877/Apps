import { describe, expect, it } from 'vitest'
import type { MediaItem } from '../src/shared/ipc'
import { extensionOf, kindOf, validFileName } from '../src/shared/formats'
import { NO_FILTER, albumMedia, filterMedia, smartAlbumMedia, sortMedia, uniqueName } from '../src/shared/library'
import { applyOp, emptyData } from '../src/shared/model'
import { parseRange } from '../src/core/range'

const DAY = 24 * 3600 * 1000
const NOW = 1_800_000_000_000

function item(id: string, patch: Partial<MediaItem> = {}): MediaItem {
  return {
    id,
    name: id,
    ext: extensionOf(id),
    kind: kindOf(id) ?? 'image',
    mime: 'image/jpeg',
    size: 100,
    created: NOW - 100 * DAY,
    modified: NOW - 100 * DAY,
    taken: null,
    width: null,
    height: null,
    duration: null,
    version: '1',
    shared: false,
    ...patch
  }
}

const media = [
  item('Dovolena 10.jpg', { taken: NOW - 5 * DAY, size: 300 }),
  item('dovolena 2.png', { modified: NOW - 2 * DAY, size: 50 }),
  item('Klip.mp4', { created: NOW - 3 * DAY, size: 900 }),
  item('logo.svg', { modified: NOW - 50 * DAY, size: 10 })
]

describe('formats', () => {
  it('knows the supported files', () => {
    expect(kindOf('A.JPEG')).toBe('image')
    expect(kindOf('film.MKV')).toBe('video')
    expect(kindOf('notes.txt')).toBeNull()
    expect(kindOf('.jpg')).toBeNull()
    expect(validFileName('Léto 2026')).toBe(true)
    expect(validFileName('a/b')).toBe(false)
    expect(validFileName('  ')).toBe(false)
  })
})

describe('filter and sort', () => {
  const data = applyOp(applyOp(emptyData(), { type: 'meta', ids: ['Klip.mp4'], patch: { star: true } }), { type: 'meta', ids: ['logo.svg'], patch: { color: 'green' } })

  it('searches all words in the name, case-insensitive', () => {
    expect(filterMedia(media, data, { ...NO_FILTER, query: 'DOVOLENA 1' }).map((m) => m.id)).toEqual(['Dovolena 10.jpg'])
    expect(filterMedia(media, data, { ...NO_FILTER, query: 'dovolena' })).toHaveLength(2)
  })

  it('filters by star, frame colour and kind', () => {
    expect(filterMedia(media, data, { ...NO_FILTER, starOnly: true }).map((m) => m.id)).toEqual(['Klip.mp4'])
    expect(filterMedia(media, data, { ...NO_FILTER, color: 'green' }).map((m) => m.id)).toEqual(['logo.svg'])
    expect(filterMedia(media, data, { ...NO_FILTER, kind: 'video' }).map((m) => m.id)).toEqual(['Klip.mp4'])
  })

  it('sorts by date (taken first), natural name, format and size', () => {
    expect(sortMedia(media, 'date', true).map((m) => m.id)).toEqual(['dovolena 2.png', 'Dovolena 10.jpg', 'logo.svg', 'Klip.mp4'])
    expect(sortMedia(media, 'name', false).map((m) => m.id)).toEqual(['dovolena 2.png', 'Dovolena 10.jpg', 'Klip.mp4', 'logo.svg'])
    expect(sortMedia(media, 'format', false).map((m) => m.ext)).toEqual(['jpg', 'mp4', 'png', 'svg'])
    expect(sortMedia(media, 'size', true)[0].id).toBe('Klip.mp4')
  })

  it('builds smart albums', () => {
    expect(smartAlbumMedia('smart:favorites', media, data).map((m) => m.id)).toEqual(['Klip.mp4'])
    expect(smartAlbumMedia('smart:videos', media, data)).toHaveLength(1)
    expect(smartAlbumMedia('smart:photos', media, data)).toHaveLength(3)
    expect(smartAlbumMedia('smart:recent', media, data, NOW).map((m) => m.id)).toEqual(['Klip.mp4'])
  })

  it('keeps album order and skips missing files', () => {
    expect(albumMedia(['logo.svg', 'gone.jpg', 'Klip.mp4'], media).map((m) => m.id)).toEqual(['logo.svg', 'Klip.mp4'])
  })

  it('finds a free name', () => {
    expect(uniqueName('a.jpg', new Set(['b.jpg']))).toBe('a.jpg')
    expect(uniqueName('A.jpg', new Set(['a.jpg', 'a (2).jpg']))).toBe('A (3).jpg')
  })
})

describe('parseRange', () => {
  it('reads single byte ranges', () => {
    expect(parseRange(null, 100)).toBeNull()
    expect(parseRange('bytes=0-', 100)).toEqual({ start: 0, end: 99 })
    expect(parseRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 })
    expect(parseRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 })
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 })
    expect(parseRange('bytes=100-', 100)).toBe('invalid')
    expect(parseRange('items=1-2', 100)).toBeNull()
  })
})
