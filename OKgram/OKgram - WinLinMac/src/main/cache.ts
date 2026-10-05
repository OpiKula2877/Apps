// Offline copy of one library on this computer: the data file (with "not uploaded yet" flag),
// the last media list, video sizes and lengths, and the thumbnail cache.
import { createHash } from 'node:crypto'
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import type { MediaItem, VideoInfo } from '../shared/ipc'

function atomicWrite(path: string, data: Uint8Array | string): void {
  const tmp = `${path}.tmp`
  const fd = openSync(tmp, 'w')
  try {
    writeSync(fd, typeof data === 'string' ? Buffer.from(data, 'utf8') : data)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(tmp, path)
}

function folderSize(folder: string): number {
  let total = 0
  let entries
  try {
    entries = readdirSync(folder, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    const path = join(folder, entry.name)
    if (entry.isDirectory()) total += folderSize(path)
    else {
      try {
        total += statSync(path).size
      } catch {
        // removed meanwhile
      }
    }
  }
  return total
}

export interface CachedData {
  data: Uint8Array
  base: string | null
  pending: boolean
}

export type VideoInfoMap = Record<string, VideoInfo & { version: string }>

export class LibraryCache {
  readonly folder: string
  readonly thumbs: string

  constructor(root: string, key: string) {
    this.folder = join(root, createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 24))
    this.thumbs = join(this.folder, 'thumbs')
  }

  private json<T>(name: string): T | null {
    try {
      return JSON.parse(readFileSync(join(this.folder, name), 'utf8')) as T
    } catch {
      return null
    }
  }

  private write(name: string, data: Uint8Array | string): void {
    mkdirSync(this.folder, { recursive: true })
    atomicWrite(join(this.folder, name), data)
  }

  readData(): CachedData | null {
    try {
      const data = new Uint8Array(readFileSync(join(this.folder, 'okgram.json')))
      const meta = this.json<{ base?: string | null; pending?: boolean }>('meta.json') ?? {}
      return { data, base: meta.base ?? null, pending: Boolean(meta.pending) }
    } catch {
      return null
    }
  }

  writeData(data: Uint8Array, base: string | null, pending: boolean): void {
    this.write('okgram.json', data)
    this.write('meta.json', JSON.stringify({ base, pending }))
  }

  readList(): MediaItem[] | null {
    const list = this.json<MediaItem[]>('media.json')
    return Array.isArray(list) ? list : null
  }

  writeList(items: MediaItem[]): void {
    this.write('media.json', JSON.stringify(items))
  }

  readVideoInfo(): VideoInfoMap {
    return this.json<VideoInfoMap>('videos.json') ?? {}
  }

  writeVideoInfo(map: VideoInfoMap): void {
    this.write('videos.json', JSON.stringify(map))
  }

  size(): number {
    return folderSize(this.folder)
  }

  clearThumbs(): void {
    rmSync(this.thumbs, { recursive: true, force: true })
  }

  clear(): void {
    rmSync(this.folder, { recursive: true, force: true })
  }
}
