import { describe, expect, it } from 'vitest'
import { albumPath, applyOp, childAlbums, descendants, emptyData, mergeData, metaOf, sanitizeData, serializeData, type LibraryData } from '../src/shared/model'

const T = 1_700_000_000_000

function withAlbums(): LibraryData {
  let data = emptyData()
  data = applyOp(data, { type: 'album.create', id: 'a', name: 'Rodina', parent: null, items: ['x', 'y'] }, T)
  data = applyOp(data, { type: 'album.create', id: 'b', name: 'Léto', parent: 'a', icon: 'sun', color: 'yellow' }, T + 1)
  data = applyOp(data, { type: 'album.create', id: 'c', name: 'Práce', parent: null }, T + 2)
  return data
}

describe('applyOp', () => {
  it('sets stars and colour frames per file', () => {
    let data = applyOp(emptyData(), { type: 'meta', ids: ['x', 'y'], patch: { star: true, color: 'red' } }, T)
    expect(metaOf(data, 'x')).toMatchObject({ star: true, color: 'red', rotation: 0, modified: T })
    data = applyOp(data, { type: 'meta', ids: ['x'], patch: { color: null } }, T + 1)
    expect(metaOf(data, 'x')).toMatchObject({ star: true, color: null })
    expect(metaOf(data, 'y').color).toBe('red')
    // unknown colours are dropped
    data = applyOp(data, { type: 'meta', ids: ['y'], patch: { color: 'pink' as never } }, T + 2)
    expect(metaOf(data, 'y').color).toBeNull()
  })

  it('rotates in both directions and wraps around', () => {
    let data = applyOp(emptyData(), { type: 'rotate', ids: ['x'], by: -90 }, T)
    expect(metaOf(data, 'x').rotation).toBe(270)
    data = applyOp(data, { type: 'rotate', ids: ['x'], by: 90 }, T)
    data = applyOp(data, { type: 'rotate', ids: ['x'], by: 90 }, T)
    expect(metaOf(data, 'x').rotation).toBe(90)
  })

  it('creates nested albums with order, icon and colour', () => {
    const data = withAlbums()
    expect(data.albums.map((a) => [a.id, a.parent, a.order])).toEqual([
      ['a', null, 0],
      ['b', 'a', 0],
      ['c', null, 1]
    ])
    expect(data.albums[1]).toMatchObject({ icon: 'sun', color: 'yellow' })
    expect(childAlbums(data.albums, null, 'name').map((a) => a.name)).toEqual(['Práce', 'Rodina'])
    expect(albumPath(data.albums, 'b').map((a) => a.id)).toEqual(['a', 'b'])
  })

  it('adds files once and removes them (and the cover)', () => {
    let data = withAlbums()
    data = applyOp(data, { type: 'album.add', id: 'a', items: ['y', 'z', 'z'] }, T + 5)
    expect(data.albums[0].items).toEqual(['x', 'y', 'z'])
    data = applyOp(data, { type: 'album.update', id: 'a', patch: { cover: 'y' } }, T + 6)
    data = applyOp(data, { type: 'album.remove', id: 'a', items: ['y'] }, T + 7)
    expect(data.albums[0]).toMatchObject({ items: ['x', 'z'], cover: null, modified: T + 7 })
  })

  it('does not move an album into itself or below itself', () => {
    const data = withAlbums()
    expect(applyOp(data, { type: 'album.move', id: 'a', parent: 'b' })).toBe(data)
    expect(applyOp(data, { type: 'album.move', id: 'a', parent: 'a' })).toBe(data)
    const moved = applyOp(data, { type: 'album.move', id: 'c', parent: 'a' }, T + 9)
    expect(moved.albums.find((a) => a.id === 'c')).toMatchObject({ parent: 'a', order: 1 })
  })

  it('reorders, duplicates right after the original and deletes with sub-albums', () => {
    let data = withAlbums()
    data = applyOp(data, { type: 'album.reorder', ids: ['c', 'a'] }, T + 3)
    expect(childAlbums(data.albums, null, 'manual').map((a) => a.id)).toEqual(['c', 'a'])
    data = applyOp(data, { type: 'album.duplicate', id: 'c', newId: 'c2', name: 'Práce (kopie)' }, T + 4)
    expect(childAlbums(data.albums, null, 'manual').map((a) => a.id)).toEqual(['c', 'c2', 'a'])
    expect(descendants(data.albums, 'a')).toEqual(new Set(['a', 'b']))
    data = applyOp(data, { type: 'album.delete', id: 'a' }, T + 5)
    expect(data.albums.map((a) => a.id).sort()).toEqual(['c', 'c2'])
    expect(data.deleted).toEqual({ a: T + 5, b: T + 5 })
  })

  it('forgets deleted files and follows renamed ones', () => {
    let data = withAlbums()
    data = applyOp(data, { type: 'meta', ids: ['x'], patch: { star: true } }, T)
    data = applyOp(data, { type: 'rekey', from: 'x', to: 'sub/x2.jpg' }, T + 1)
    expect(data.items['sub/x2.jpg'].star).toBe(true)
    expect(data.items.x).toBeUndefined()
    expect(data.albums[0].items).toEqual(['sub/x2.jpg', 'y'])
    data = applyOp(data, { type: 'forget', ids: ['y'] }, T + 2)
    expect(data.albums[0].items).toEqual(['sub/x2.jpg'])
  })

  it('keeps the user name short and the preferences valid', () => {
    let data = applyOp(emptyData(), { type: 'profile', username: `  ${'a'.repeat(80)} ` }, T)
    expect(data.profile.username).toHaveLength(64)
    data = applyOp(data, { type: 'prefs', patch: { thumb_size: 9999, theme: 'dark' } }, T)
    expect(data.prefs).toMatchObject({ thumb_size: 320, theme: 'dark' })
    expect(data.prefs_modified).toBe(T)
  })
})

describe('mergeData', () => {
  it('keeps the newer change of every album and file', () => {
    const base = withAlbums()
    const here = applyOp(applyOp(base, { type: 'album.update', id: 'a', patch: { name: 'Rodina 2026' } }, T + 10), { type: 'meta', ids: ['x'], patch: { star: true } }, T + 10)
    const there = applyOp(applyOp(base, { type: 'album.update', id: 'c', patch: { icon: 'briefcase' } }, T + 20), { type: 'meta', ids: ['x'], patch: { color: 'blue' } }, T + 20)
    const merged = mergeData(here, there, T + 30)
    expect(merged.albums.find((a) => a.id === 'a')?.name).toBe('Rodina 2026')
    expect(merged.albums.find((a) => a.id === 'c')?.icon).toBe('briefcase')
    // the whole file entry is newer on the other side
    expect(metaOf(merged, 'x')).toMatchObject({ color: 'blue', star: false })
  })

  it('does not bring back deleted albums and frees their children', () => {
    const base = withAlbums()
    const here = applyOp(base, { type: 'album.delete', id: 'c' }, T + 10)
    const there = applyOp(base, { type: 'album.create', id: 'd', name: 'Nové', parent: 'c' }, T + 5)
    const merged = mergeData(here, there, T + 30)
    expect(merged.albums.some((a) => a.id === 'c')).toBe(false)
    expect(merged.albums.find((a) => a.id === 'd')?.parent).toBeNull()
    // an album changed after the deletion stays
    const later = applyOp(base, { type: 'album.update', id: 'c', patch: { name: 'Zpět' } }, T + 50)
    expect(mergeData(here, later, T + 60).albums.find((a) => a.id === 'c')?.name).toBe('Zpět')
  })

  it('takes the newer preferences and user name', () => {
    const a = applyOp(emptyData(), { type: 'prefs', patch: { theme: 'light' } }, T + 1)
    const b = applyOp(applyOp(emptyData(), { type: 'prefs', patch: { theme: 'dark' } }, T + 2), { type: 'profile', username: 'Opi' }, T)
    const merged = mergeData(a, b, T + 3)
    expect(merged.prefs.theme).toBe('dark')
    expect(merged.profile.username).toBe('Opi')
  })
})

describe('sanitizeData', () => {
  it('reads its own output back', () => {
    const data = applyOp(withAlbums(), { type: 'meta', ids: ['x'], patch: { star: true } }, T)
    expect(sanitizeData(JSON.parse(serializeData(data)))).toEqual(data)
  })

  it('drops broken entries, duplicate ids and parent loops', () => {
    const data = sanitizeData({
      albums: [
        { id: 'a', name: 'A', parent: 'b', items: ['x', 1, 'x'] },
        { id: 'b', name: 'B', parent: 'a' },
        { id: 'a', name: 'dup' },
        { name: 'no id' },
        { id: 'c', name: 'C', parent: 'missing', icon: 'nope', color: 'pink' }
      ],
      items: { x: { star: 1, rotation: 45 }, y: 'bad' },
      prefs: { thumb_size: 'big' }
    })
    expect(data.albums.map((a) => a.id)).toEqual(['a', 'b', 'c'])
    expect(data.albums[0].items).toEqual(['x'])
    expect(data.albums.filter((a) => a.parent === null).length).toBeGreaterThanOrEqual(2)
    expect(data.albums[2]).toMatchObject({ parent: null, icon: 'folder', color: null })
    expect(data.items).toEqual({ x: { star: true, color: null, rotation: 0, modified: 0 } })
    expect(data.prefs.thumb_size).toBe(170)
  })
})
