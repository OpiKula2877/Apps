// The library data file (okgram.json): user name, preferences, albums, stars, colour frames.
// Every change is a DataOp applied by applyOp(); two copies of the file are joined by mergeData().
// Times are milliseconds since the epoch.
import type { Prefs } from './ipc'
import { defaultPrefs, isRecord, sanitizePrefs } from './prefs'

export const DATA_FILE = 'okgram.json'
export const DATA_FORMAT = 1

export const FRAME_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'] as const
export type FrameColor = (typeof FRAME_COLORS)[number]
export const FRAME_HEX: Record<FrameColor, string> = {
  red: '#E5484D',
  orange: '#F76B15',
  yellow: '#E2B203',
  green: '#30A46C',
  blue: '#3E8EF7',
  purple: '#9A5CD0',
  gray: '#8B8D98'
}

export const ALBUM_ICONS = [
  'folder', 'image', 'camera', 'heart', 'star', 'home', 'users', 'user',
  'map', 'globe', 'sun', 'moon', 'mountain', 'gift', 'music', 'film',
  'book', 'briefcase', 'coffee', 'flag', 'award', 'smile', 'umbrella', 'zap'
] as const
export type AlbumIcon = (typeof ALBUM_ICONS)[number]

export interface Album {
  id: string
  name: string
  icon: AlbumIcon
  /** null = text colour */
  color: FrameColor | null
  /** Parent album, null = top level. */
  parent: string | null
  /** Media id shown as the album cover; null = the first item. */
  cover: string | null
  /** Media ids in the order they were added. One file can be in many albums. */
  items: string[]
  /** Position among the siblings (manual sorting). */
  order: number
  created: number
  modified: number
}

export interface ItemMeta {
  star: boolean
  color: FrameColor | null
  /** Clockwise view rotation in degrees; the file itself is not changed. */
  rotation: 0 | 90 | 180 | 270
  modified: number
}

export interface LibraryData {
  profile: { username: string; modified: number }
  prefs: Prefs
  prefs_modified: number
  albums: Album[]
  items: Record<string, ItemMeta>
  /** Deleted album ids → time of deletion (so a merge does not bring them back). */
  deleted: Record<string, number>
}

export type MetaPatch = Partial<Pick<ItemMeta, 'star' | 'color'>>

export type DataOp =
  | { type: 'meta'; ids: string[]; patch: MetaPatch }
  | { type: 'rotate'; ids: string[]; by: 90 | -90 }
  | { type: 'profile'; username: string }
  | { type: 'prefs'; patch: Partial<Prefs> }
  | { type: 'album.create'; id: string; name: string; parent: string | null; icon?: AlbumIcon; color?: FrameColor | null; items?: string[] }
  | { type: 'album.update'; id: string; patch: Partial<Pick<Album, 'name' | 'icon' | 'color' | 'cover'>> }
  | { type: 'album.move'; id: string; parent: string | null }
  | { type: 'album.reorder'; ids: string[] }
  | { type: 'album.add'; id: string; items: string[] }
  | { type: 'album.remove'; id: string; items: string[] }
  | { type: 'album.duplicate'; id: string; newId: string; name: string }
  | { type: 'album.delete'; id: string }
  /** Files were deleted: drop their metadata and album entries. */
  | { type: 'forget'; ids: string[] }
  /** A local file was renamed: its id (the path) changed. */
  | { type: 'rekey'; from: string; to: string }
  /** Copy an album's record (without files) into a source that does not have it yet. */
  | { type: 'album.ensure'; album: Omit<Album, 'items' | 'cover'> }

const ROTATIONS = [0, 90, 180, 270] as const
/** Tombstones older than this are dropped. */
const TOMBSTONE_MS = 180 * 24 * 3600 * 1000

export function emptyData(prefs: Prefs = defaultPrefs()): LibraryData {
  return { profile: { username: '', modified: 0 }, prefs: { ...prefs }, prefs_modified: 0, albums: [], items: {}, deleted: {} }
}

export function newId(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, '')
}

export const DEFAULT_META: Omit<ItemMeta, 'modified'> = { star: false, color: null, rotation: 0 }

export function metaOf(data: LibraryData, id: string): ItemMeta {
  return data.items[id] ?? { ...DEFAULT_META, modified: 0 }
}

/** The album and every album below it. */
export function descendants(albums: Album[], id: string): Set<string> {
  const result = new Set([id])
  let grown = true
  while (grown) {
    grown = false
    for (const album of albums) {
      if (album.parent && result.has(album.parent) && !result.has(album.id)) {
        result.add(album.id)
        grown = true
      }
    }
  }
  return result
}

/** Albums from the top level down to this one. */
export function albumPath(albums: Album[], id: string): Album[] {
  const byId = new Map(albums.map((a) => [a.id, a]))
  const path: Album[] = []
  let current = byId.get(id)
  while (current && path.length < 64) {
    path.unshift(current)
    current = current.parent ? byId.get(current.parent) : undefined
  }
  return path
}

export function sortAlbums(albums: Album[], mode: Prefs['album_sort']): Album[] {
  const list = [...albums]
  if (mode === 'name') return list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
  if (mode === 'date') return list.sort((a, b) => b.created - a.created)
  return list.sort((a, b) => a.order - b.order || a.created - b.created)
}

export function childAlbums(albums: Album[], parent: string | null, mode: Prefs['album_sort']): Album[] {
  return sortAlbums(
    albums.filter((a) => a.parent === parent),
    mode
  )
}

const nextOrder = (albums: Album[], parent: string | null): number =>
  albums.filter((a) => a.parent === parent).reduce((max, a) => Math.max(max, a.order + 1), 0)

const unique = (ids: string[]): string[] => [...new Set(ids)]

function setMeta(data: LibraryData, ids: string[], now: number, change: (meta: ItemMeta) => Partial<ItemMeta>): LibraryData {
  const items = { ...data.items }
  for (const id of ids) {
    const meta = metaOf(data, id)
    items[id] = { ...meta, ...change(meta), modified: now }
  }
  return { ...data, items }
}

function mapAlbums(data: LibraryData, change: (album: Album) => Album): LibraryData {
  return { ...data, albums: data.albums.map(change) }
}

/** Apply one change. Returns a new object; the input is not modified. Unknown album ids are ignored. */
export function applyOp(data: LibraryData, op: DataOp, now = Date.now()): LibraryData {
  const touch = (album: Album, patch: Partial<Album>): Album => ({ ...album, ...patch, modified: now })
  switch (op.type) {
    case 'meta':
      return setMeta(data, op.ids, now, () => {
        const patch: Partial<ItemMeta> = {}
        if (op.patch.star !== undefined) patch.star = Boolean(op.patch.star)
        if (op.patch.color !== undefined) patch.color = op.patch.color && FRAME_COLORS.includes(op.patch.color) ? op.patch.color : null
        return patch
      })
    case 'rotate':
      return setMeta(data, op.ids, now, (meta) => ({ rotation: ROTATIONS[(((meta.rotation + op.by) % 360) + 360) % 360 / 90] }))
    case 'profile':
      return { ...data, profile: { username: op.username.trim().slice(0, 64), modified: now } }
    case 'prefs':
      return { ...data, prefs: sanitizePrefs({ ...data.prefs, ...op.patch }), prefs_modified: now }
    case 'album.ensure':
      if (data.albums.some((a) => a.id === op.album.id)) return data
      return { ...data, albums: [...data.albums, { ...op.album, items: [], cover: null }] }
    case 'album.create': {
      if (data.albums.some((a) => a.id === op.id)) return data
      const parent = op.parent && data.albums.some((a) => a.id === op.parent) ? op.parent : null
      const album: Album = {
        id: op.id,
        name: op.name.trim().slice(0, 100) || '…',
        icon: op.icon && ALBUM_ICONS.includes(op.icon) ? op.icon : 'folder',
        color: op.color && FRAME_COLORS.includes(op.color) ? op.color : null,
        parent,
        cover: null,
        items: unique(op.items ?? []),
        order: nextOrder(data.albums, parent),
        created: now,
        modified: now
      }
      return { ...data, albums: [...data.albums, album] }
    }
    case 'album.update':
      return mapAlbums(data, (a) => {
        if (a.id !== op.id) return a
        const patch: Partial<Album> = {}
        if (op.patch.name !== undefined) patch.name = op.patch.name.trim().slice(0, 100) || a.name
        if (op.patch.icon !== undefined && ALBUM_ICONS.includes(op.patch.icon)) patch.icon = op.patch.icon
        if (op.patch.color !== undefined) patch.color = op.patch.color && FRAME_COLORS.includes(op.patch.color) ? op.patch.color : null
        if (op.patch.cover !== undefined) patch.cover = op.patch.cover
        return touch(a, patch)
      })
    case 'album.move': {
      if (op.parent !== null && (descendants(data.albums, op.id).has(op.parent) || !data.albums.some((a) => a.id === op.parent))) return data
      const order = nextOrder(data.albums, op.parent)
      return mapAlbums(data, (a) => (a.id === op.id && a.parent !== op.parent ? touch(a, { parent: op.parent, order }) : a))
    }
    case 'album.reorder': {
      const position = new Map(op.ids.map((id, index) => [id, index]))
      return mapAlbums(data, (a) => (position.has(a.id) && a.order !== position.get(a.id) ? touch(a, { order: position.get(a.id)! }) : a))
    }
    case 'album.add':
      return mapAlbums(data, (a) => (a.id === op.id ? touch(a, { items: unique([...a.items, ...op.items]) }) : a))
    case 'album.remove': {
      const gone = new Set(op.items)
      return mapAlbums(data, (a) =>
        a.id === op.id ? touch(a, { items: a.items.filter((id) => !gone.has(id)), cover: a.cover && gone.has(a.cover) ? null : a.cover }) : a
      )
    }
    case 'album.duplicate': {
      const source = data.albums.find((a) => a.id === op.id)
      if (!source || data.albums.some((a) => a.id === op.newId)) return data
      const copy: Album = { ...source, id: op.newId, name: op.name.trim().slice(0, 100) || source.name, items: [...source.items], order: source.order + 0.5, created: now, modified: now }
      const albums = [...data.albums, copy]
      // Renumber the siblings so the copy sits right after the original.
      const siblings = sortAlbums(albums.filter((a) => a.parent === source.parent), 'manual').map((a) => a.id)
      return applyOp({ ...data, albums }, { type: 'album.reorder', ids: siblings }, now)
    }
    case 'album.delete': {
      const gone = descendants(data.albums, op.id)
      if (!data.albums.some((a) => a.id === op.id)) return data
      const deleted = { ...data.deleted }
      for (const id of gone) deleted[id] = now
      return { ...data, albums: data.albums.filter((a) => !gone.has(a.id)), deleted }
    }
    case 'forget': {
      const gone = new Set(op.ids)
      const items = { ...data.items }
      for (const id of op.ids) delete items[id]
      const albums = data.albums.map((a) =>
        a.items.some((id) => gone.has(id)) || (a.cover && gone.has(a.cover))
          ? touch(a, { items: a.items.filter((id) => !gone.has(id)), cover: a.cover && gone.has(a.cover) ? null : a.cover })
          : a
      )
      return { ...data, items, albums }
    }
    case 'rekey': {
      if (op.from === op.to) return data
      const items = { ...data.items }
      if (items[op.from]) {
        items[op.to] = { ...items[op.from], modified: now }
        delete items[op.from]
      }
      const swap = (id: string): string => (id === op.from ? op.to : id)
      const albums = data.albums.map((a) =>
        a.items.includes(op.from) || a.cover === op.from ? touch(a, { items: unique(a.items.map(swap)), cover: a.cover ? swap(a.cover) : null }) : a
      )
      return { ...data, items, albums }
    }
    default:
      // An unknown operation (e.g. from a newer version) changes nothing.
      return data
  }
}

/**
 * Join two copies of the data file (e.g. this computer and Google Drive after another
 * computer saved). For every album, item and setting the newer change wins.
 */
export function mergeData(a: LibraryData, b: LibraryData, now = Date.now()): LibraryData {
  const deleted: Record<string, number> = {}
  for (const source of [a.deleted, b.deleted]) {
    for (const [id, time] of Object.entries(source)) {
      if (now - time < TOMBSTONE_MS) deleted[id] = Math.max(deleted[id] ?? 0, time)
    }
  }
  const albums = new Map<string, Album>()
  for (const album of [...a.albums, ...b.albums]) {
    const known = albums.get(album.id)
    if (!known || album.modified > known.modified) albums.set(album.id, album)
  }
  for (const [id, album] of albums) {
    if (deleted[id] !== undefined && deleted[id] >= album.modified) albums.delete(id)
  }
  // An album whose parent is gone moves to the top level.
  const merged = [...albums.values()].map((album) => (album.parent && !albums.has(album.parent) ? { ...album, parent: null } : album))
  const items: Record<string, ItemMeta> = { ...a.items }
  for (const [id, meta] of Object.entries(b.items)) {
    if (!items[id] || meta.modified > items[id].modified) items[id] = meta
  }
  const profile = b.profile.modified > a.profile.modified ? b.profile : a.profile
  const newerPrefs = b.prefs_modified > a.prefs_modified
  return {
    profile,
    prefs: newerPrefs ? b.prefs : a.prefs,
    prefs_modified: Math.max(a.prefs_modified, b.prefs_modified),
    albums: merged,
    items,
    deleted
  }
}

const num = (value: unknown, fallback = 0): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)
const str = (value: unknown): string => (typeof value === 'string' ? value : '')

/** Read the data file from untrusted JSON; anything malformed is dropped. */
export function sanitizeData(raw: unknown, fallbackPrefs: Prefs = defaultPrefs()): LibraryData {
  const r = isRecord(raw) ? raw : {}
  const profile = isRecord(r.profile) ? r.profile : {}
  const albums: Album[] = []
  const ids = new Set<string>()
  for (const item of Array.isArray(r.albums) ? r.albums : []) {
    if (!isRecord(item) || !str(item.id) || ids.has(str(item.id))) continue
    ids.add(str(item.id))
    albums.push({
      id: str(item.id),
      name: str(item.name).slice(0, 100) || '…',
      icon: ALBUM_ICONS.includes(item.icon as AlbumIcon) ? (item.icon as AlbumIcon) : 'folder',
      color: FRAME_COLORS.includes(item.color as FrameColor) ? (item.color as FrameColor) : null,
      parent: str(item.parent) || null,
      cover: str(item.cover) || null,
      items: unique((Array.isArray(item.items) ? item.items : []).filter((id): id is string => typeof id === 'string')),
      order: num(item.order),
      created: num(item.created),
      modified: num(item.modified)
    })
  }
  // Parents must exist and must not form a loop.
  for (const album of albums) {
    if (album.parent && (!ids.has(album.parent) || albumPath(albums, album.id)[0]?.parent)) album.parent = null
  }
  const items: Record<string, ItemMeta> = {}
  if (isRecord(r.items)) {
    for (const [id, value] of Object.entries(r.items)) {
      if (!isRecord(value)) continue
      items[id] = {
        star: Boolean(value.star),
        color: FRAME_COLORS.includes(value.color as FrameColor) ? (value.color as FrameColor) : null,
        rotation: ROTATIONS.includes(value.rotation as ItemMeta['rotation']) ? (value.rotation as ItemMeta['rotation']) : 0,
        modified: num(value.modified)
      }
    }
  }
  const deleted: Record<string, number> = {}
  if (isRecord(r.deleted)) for (const [id, time] of Object.entries(r.deleted)) if (typeof time === 'number') deleted[id] = time
  return {
    profile: { username: str(profile.username).slice(0, 64), modified: num(profile.modified) },
    prefs: isRecord(r.prefs) ? sanitizePrefs(r.prefs) : { ...fallbackPrefs },
    prefs_modified: num(r.prefs_modified),
    albums,
    items,
    deleted
  }
}

export function serializeData(data: LibraryData): string {
  return JSON.stringify({ app: 'okgram', format: DATA_FORMAT, ...data }, null, 1)
}

/** URLs the renderer uses for files; the main process serves them (okgram:// protocol). */
export const mediaUrl = (id: string): string => `okgram://media/${encodeURIComponent(id)}`
export const thumbUrl = (id: string, version: string, retry = 0): string =>
  `okgram://thumb/${encodeURIComponent(id)}?v=${encodeURIComponent(version)}${retry ? `&r=${retry}` : ''}`
