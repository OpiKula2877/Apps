// Several sources (local folders, Google Drive accounts) shown as one library.
// Every source keeps its own okgram.json with the stars, frames and album entries of its own
// files (ids without the source prefix). Every source also carries the records of all albums,
// so an album can hold files from several sources. The windows see one joined LibraryData
// whose ids are "<source>:<id>"; their changes are split back per source by routeOp().
import type { Prefs } from './ipc'
import { emptyData, type Album, type DataOp, type ItemMeta, type LibraryData } from './model'

export const joinId = (source: string, raw: string): string => `${source}:${raw}`

/** [source id, id inside the source]; source ids never contain ":". */
export function splitId(id: string): [string, string] {
  const at = id.indexOf(':')
  return at < 0 ? ['', id] : [id.slice(0, at), id.slice(at + 1)]
}

export interface SourceData {
  source: string
  data: LibraryData
}

/** One library from the data files of all sources. */
export function aggregateData(parts: SourceData[], fallbackPrefs: Prefs): LibraryData {
  if (!parts.length) return emptyData(fallbackPrefs)
  const deleted: Record<string, number> = {}
  for (const { data } of parts) for (const [id, time] of Object.entries(data.deleted)) deleted[id] = Math.max(deleted[id] ?? 0, time)

  const albums = new Map<string, { base: Album; items: string[]; cover: string | null; coverTime: number }>()
  const items: Record<string, ItemMeta> = {}
  let profile = parts[0].data.profile
  let prefs = parts[0].data.prefs
  let prefsModified = parts[0].data.prefs_modified
  for (const { source, data } of parts) {
    for (const album of data.albums) {
      const files = album.items.map((raw) => joinId(source, raw))
      const cover = album.cover ? joinId(source, album.cover) : null
      const entry = albums.get(album.id)
      if (!entry) {
        albums.set(album.id, { base: album, items: files, cover, coverTime: cover ? album.modified : -1 })
        continue
      }
      if (album.modified > entry.base.modified) entry.base = album
      entry.items.push(...files)
      if (cover && album.modified > entry.coverTime) {
        entry.cover = cover
        entry.coverTime = album.modified
      }
    }
    for (const [raw, meta] of Object.entries(data.items)) items[joinId(source, raw)] = meta
    if (data.profile.modified > profile.modified) profile = data.profile
    if (data.prefs_modified > prefsModified) {
      prefs = data.prefs
      prefsModified = data.prefs_modified
    }
  }
  const joined: Album[] = []
  for (const [id, { base, items: files, cover }] of albums) {
    if (deleted[id] !== undefined && deleted[id] >= base.modified) continue
    joined.push({ ...base, items: [...new Set(files)], cover })
  }
  const ids = new Set(joined.map((a) => a.id))
  for (const album of joined) if (album.parent && !ids.has(album.parent)) album.parent = null
  return { profile, prefs, prefs_modified: prefsModified, albums: joined, items, deleted }
}

function group(ids: string[]): Map<string, string[]> {
  const result = new Map<string, string[]>()
  for (const id of ids) {
    const [source, raw] = splitId(id)
    if (!result.has(source)) result.set(source, [])
    result.get(source)!.push(raw)
  }
  return result
}

/**
 * Split one change made in a window (ids with the source prefix) into the changes of each
 * source's data file (ids without the prefix).
 */
export function routeOp(op: DataOp, merged: LibraryData, sources: string[]): Map<string, DataOp[]> {
  const out = new Map<string, DataOp[]>(sources.map((s) => [s, []]))
  const push = (source: string, change: DataOp): void => void out.get(source)?.push(change)
  const all = (change: DataOp): void => sources.forEach((s) => push(s, change))
  // Album changes need the whole album tree in every source (parents, order).
  const ensureAll = (): void => {
    for (const album of merged.albums) {
      const { items: _items, cover: _cover, ...record } = album
      all({ type: 'album.ensure', album: record })
    }
  }
  switch (op.type) {
    case 'meta':
    case 'rotate':
    case 'forget':
      for (const [source, raws] of group(op.ids)) push(source, { ...op, ids: raws })
      break
    case 'rekey': {
      const [source, from] = splitId(op.from)
      const [target, to] = splitId(op.to)
      if (source === target) push(source, { type: 'rekey', from, to })
      break
    }
    case 'profile':
    case 'prefs':
      all(op)
      break
    case 'album.create': {
      ensureAll()
      const files = group(op.items ?? [])
      for (const source of sources) push(source, { ...op, items: files.get(source) ?? [] })
      break
    }
    case 'album.update': {
      ensureAll()
      const { cover, ...rest } = op.patch
      if (cover === undefined) {
        all(op)
        break
      }
      const [owner, raw] = cover ? splitId(cover) : ['', '']
      for (const source of sources) push(source, { type: 'album.update', id: op.id, patch: { ...rest, cover: source === owner ? raw : null } })
      break
    }
    case 'album.add':
    case 'album.remove':
      ensureAll()
      for (const [source, raws] of group(op.items)) push(source, { ...op, items: raws })
      break
    case 'album.move':
    case 'album.reorder':
    case 'album.duplicate':
    case 'album.delete':
      ensureAll()
      all(op)
      break
    default:
      break
  }
  return out
}
