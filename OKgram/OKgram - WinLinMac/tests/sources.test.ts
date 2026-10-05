import { describe, expect, it } from 'vitest'
import { applyOp, emptyData, type DataOp, type LibraryData } from '../src/shared/model'
import { defaultPrefs } from '../src/shared/prefs'
import { aggregateData, joinId, routeOp, splitId } from '../src/shared/sources'
import { sanitizeSettings } from '../src/core/settings'

const T = 1_700_000_000_000

/** Apply a window change to every source's data file, as the controller does. */
function applyAll(parts: Record<string, LibraryData>, op: DataOp, now: number): Record<string, LibraryData> {
  const merged = aggregateData(
    Object.entries(parts).map(([source, data]) => ({ source, data })),
    defaultPrefs()
  )
  const routes = routeOp(op, merged, Object.keys(parts))
  return Object.fromEntries(Object.entries(parts).map(([source, data]) => [source, (routes.get(source) ?? []).reduce((d, o) => applyOp(d, o, now), data)]))
}

const view = (parts: Record<string, LibraryData>) =>
  aggregateData(
    Object.entries(parts).map(([source, data]) => ({ source, data })),
    defaultPrefs()
  )

describe('ids', () => {
  it('joins and splits at the first colon only', () => {
    expect(joinId('local1', 'a/b:c.png')).toBe('local1:a/b:c.png')
    expect(splitId('local1:a/b:c.png')).toEqual(['local1', 'a/b:c.png'])
  })
})

describe('sources joined into one library', () => {
  it('routes stars to the source of each file', () => {
    let parts: Record<string, LibraryData> = { a: emptyData(), b: emptyData() }
    parts = applyAll(parts, { type: 'meta', ids: ['a:1.jpg', 'b:2.jpg'], patch: { star: true } }, T)
    expect(Object.keys(parts.a.items)).toEqual(['1.jpg'])
    expect(Object.keys(parts.b.items)).toEqual(['2.jpg'])
    expect(view(parts).items['b:2.jpg'].star).toBe(true)
  })

  it('keeps every album in every source, each with its own files', () => {
    let parts: Record<string, LibraryData> = { a: emptyData(), b: emptyData() }
    parts = applyAll(parts, { type: 'album.create', id: 'x', name: 'X', parent: null, items: ['a:1.jpg', 'b:2.jpg'] }, T)
    parts = applyAll(parts, { type: 'album.create', id: 'y', name: 'Y', parent: 'x' }, T + 1)
    expect(parts.a.albums.map((al) => [al.id, al.items])).toEqual([
      ['x', ['1.jpg']],
      ['y', []]
    ])
    expect(parts.b.albums.find((al) => al.id === 'y')?.parent).toBe('x')
    parts = applyAll(parts, { type: 'album.update', id: 'x', patch: { name: 'Nové', cover: 'b:2.jpg' } }, T + 2)
    const x = view(parts).albums.find((al) => al.id === 'x')!
    expect(x).toMatchObject({ name: 'Nové', cover: 'b:2.jpg' })
    expect(x.items.sort()).toEqual(['a:1.jpg', 'b:2.jpg'])
    parts = applyAll(parts, { type: 'album.remove', id: 'x', items: ['b:2.jpg'] }, T + 3)
    expect(view(parts).albums.find((al) => al.id === 'x')).toMatchObject({ items: ['a:1.jpg'], cover: null })
  })

  it('gives a newly added source the album records it was missing', () => {
    let parts: Record<string, LibraryData> = { a: emptyData() }
    parts = applyAll(parts, { type: 'album.create', id: 'x', name: 'X', parent: null }, T)
    parts = { ...parts, c: emptyData() }
    parts = applyAll(parts, { type: 'album.add', id: 'x', items: ['c:9.png'] }, T + 1)
    expect(parts.c.albums).toMatchObject([{ id: 'x', name: 'X', items: ['9.png'] }])
    expect(view(parts).albums).toHaveLength(1)
  })

  it('deletes an album everywhere', () => {
    let parts: Record<string, LibraryData> = { a: emptyData(), b: emptyData() }
    parts = applyAll(parts, { type: 'album.create', id: 'x', name: 'X', parent: null, items: ['a:1', 'b:2'] }, T)
    parts = applyAll(parts, { type: 'album.delete', id: 'x' }, T + 1)
    expect(view(parts).albums).toEqual([])
    expect(parts.a.deleted.x).toBe(T + 1)
    expect(parts.b.deleted.x).toBe(T + 1)
  })

  it('takes the newest preferences and user name of all sources', () => {
    let parts: Record<string, LibraryData> = { a: emptyData(), b: emptyData() }
    parts = applyAll(parts, { type: 'prefs', patch: { theme: 'light' } }, T)
    parts.b = applyOp(parts.b, { type: 'prefs', patch: { theme: 'dark' } }, T + 5)
    expect(view(parts).prefs.theme).toBe('dark')
  })
})

describe('settings migration', () => {
  it('turns the old single storage into a source', () => {
    expect(sanitizeSettings({ storage: 'local', local_folder: 'C:\\Fotky\\Rodina' }).sources).toMatchObject([{ id: 'local0', kind: 'local', name: 'Rodina', path: 'C:\\Fotky\\Rodina' }])
    expect(sanitizeSettings({ storage: 'drive', last_account: { id: 'p1', email: 'a@b.cz', name: 'A' } }).sources).toMatchObject([
      { id: 'drive0', kind: 'drive', name: 'a@b.cz', account: { id: 'p1', email: 'a@b.cz' } }
    ])
    expect(sanitizeSettings({}).sources).toEqual([])
    expect(sanitizeSettings({ sources: [{ id: 'bad id!', kind: 'local', path: 'x' }, { id: 'ok', kind: 'local' }] }).sources).toEqual([])
  })
})
