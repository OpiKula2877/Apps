// Searching, filtering and sorting the media list (used by both windows and the tests).
import type { MediaItem, MediaKind, SortBy } from './ipc'
import { metaOf, type FrameColor, type LibraryData } from './model'

export interface MediaFilter {
  query: string
  starOnly: boolean
  color: FrameColor | null
  kind: MediaKind | null
}

export const NO_FILTER: MediaFilter = { query: '', starOnly: false, color: null, kind: null }

export const SMART_ALBUMS = ['smart:favorites', 'smart:photos', 'smart:videos', 'smart:recent'] as const
export type SmartAlbum = (typeof SMART_ALBUMS)[number]
export const RECENT_DAYS = 30

export const isSmart = (id: string): id is SmartAlbum => (SMART_ALBUMS as readonly string[]).includes(id)

/** The date the library sorts by: when the photo was taken, otherwise the file date. */
export const dateOf = (item: MediaItem): number => item.taken ?? item.modified

export function filterMedia(media: MediaItem[], data: LibraryData, filter: MediaFilter): MediaItem[] {
  const words = filter.query.toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return media.filter((item) => {
    if (filter.kind && item.kind !== filter.kind) return false
    if (filter.starOnly || filter.color) {
      const meta = metaOf(data, item.id)
      if (filter.starOnly && !meta.star) return false
      if (filter.color && meta.color !== filter.color) return false
    }
    if (words.length) {
      const text = item.name.toLocaleLowerCase()
      if (!words.every((word) => text.includes(word))) return false
    }
    return true
  })
}

const byName = (a: MediaItem, b: MediaItem): number => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })

export function sortMedia(media: MediaItem[], by: SortBy, desc: boolean): MediaItem[] {
  const compare: Record<SortBy, (a: MediaItem, b: MediaItem) => number> = {
    date: (a, b) => dateOf(a) - dateOf(b) || byName(a, b),
    name: byName,
    format: (a, b) => a.ext.localeCompare(b.ext) || byName(a, b),
    size: (a, b) => a.size - b.size || byName(a, b)
  }
  const sorted = [...media].sort(compare[by])
  return desc ? sorted.reverse() : sorted
}

/** Media of a smart album (built automatically from the library). */
export function smartAlbumMedia(id: SmartAlbum, media: MediaItem[], data: LibraryData, now = Date.now()): MediaItem[] {
  switch (id) {
    case 'smart:favorites':
      return media.filter((item) => metaOf(data, item.id).star)
    case 'smart:photos':
      return media.filter((item) => item.kind === 'image')
    case 'smart:videos':
      return media.filter((item) => item.kind === 'video')
    case 'smart:recent':
      return media.filter((item) => now - item.created < RECENT_DAYS * 24 * 3600 * 1000).sort((a, b) => b.created - a.created)
  }
}

/** Media of an album in album order; ids of files that no longer exist are skipped. */
export function albumMedia(itemIds: string[], media: MediaItem[]): MediaItem[] {
  const byId = new Map(media.map((item) => [item.id, item]))
  return itemIds.map((id) => byId.get(id)).filter((item): item is MediaItem => Boolean(item))
}

/** Pick a name that is not in `taken` by adding " (2)", " (3)"… before the extension. */
export function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name.toLowerCase())) return name
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${ext}`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
}
