// Thumbnails, cached on disk so the grid loads fast and works offline.
// Photos: Drive's own preview or the file scaled down here. GIF and SVG: the file itself.
// Videos: Drive's preview; without one the window draws a frame and sends it back (store()).
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MediaItem } from '../shared/ipc'
import type { MediaBackend } from '../core/backend'
import { jpegOrientation } from '../core/imageSize'

export const THUMB_EDGE = 480
const CONCURRENT = 4
const FAILURE_PAUSE_MS = 10 * 60 * 1000
const MAX_DECODE_BYTES = 60 * 1024 * 1024
const MAX_RAW_BYTES = 12 * 1024 * 1024
const TYPES = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', svg: 'image/svg+xml' } as const
type ThumbExt = keyof typeof TYPES

export interface Thumb {
  bytes: Uint8Array
  type: string
}

async function readAll(response: Response, limit: number): Promise<Uint8Array | null> {
  const length = Number(response.headers.get('content-length') ?? 0)
  if (length > limit) {
    await response.body?.cancel().catch(() => undefined)
    return null
  }
  const data = new Uint8Array(await response.arrayBuffer())
  return data.length > limit ? null : data
}

export class ThumbService {
  private running = 0
  private readonly waiting: (() => void)[] = []
  private readonly failed = new Map<string, number>()
  private readonly inFlight = new Map<string, Promise<Thumb | null>>()

  constructor(
    private readonly folder: string,
    private readonly backend: MediaBackend,
    private readonly resize: (bytes: Uint8Array, max: number) => Uint8Array | null
  ) {}

  private key(id: string, version: string): string {
    return createHash('sha1').update(`${id}|${version}`).digest('hex')
  }

  private cached(key: string): Thumb | null {
    for (const ext of Object.keys(TYPES) as ThumbExt[]) {
      const path = join(this.folder, `${key}.${ext}`)
      if (existsSync(path)) {
        try {
          return { bytes: new Uint8Array(readFileSync(path)), type: TYPES[ext] }
        } catch {
          return null
        }
      }
    }
    return null
  }

  private save(key: string, ext: ThumbExt, bytes: Uint8Array): Thumb {
    mkdirSync(this.folder, { recursive: true })
    writeFileSync(join(this.folder, `${key}.${ext}`), bytes)
    return { bytes, type: TYPES[ext] }
  }

  private async slot<T>(work: () => Promise<T>): Promise<T> {
    if (this.running >= CONCURRENT) await new Promise<void>((resolve) => this.waiting.push(resolve))
    this.running++
    try {
      return await work()
    } finally {
      this.running--
      this.waiting.shift()?.()
    }
  }

  /** The cached thumbnail, or a new one. null = none (the window shows a placeholder or draws one). */
  get(item: MediaItem): Promise<Thumb | null> {
    const key = this.key(item.id, item.version)
    const hit = this.cached(key)
    if (hit) return Promise.resolve(hit)
    if (Date.now() - (this.failed.get(key) ?? 0) < FAILURE_PAUSE_MS) return Promise.resolve(null)
    const running = this.inFlight.get(key)
    if (running) return running
    const job = this.slot(() => this.make(item, key))
      .catch(() => null)
      .then((thumb) => {
        if (!thumb) this.failed.set(key, Date.now())
        return thumb
      })
      .finally(() => this.inFlight.delete(key))
    this.inFlight.set(key, job)
    return job
  }

  private async original(item: MediaItem, limit: number): Promise<Uint8Array | null> {
    if (item.size > limit) return null
    return readAll(await this.backend.open(item.id, null), limit)
  }

  private async make(item: MediaItem, key: string): Promise<Thumb | null> {
    if (item.ext === 'svg') {
      const bytes = await this.original(item, MAX_RAW_BYTES)
      return bytes ? this.save(key, 'svg', bytes) : null
    }
    // Drive makes previews of photos and videos itself.
    if (this.backend.kind === 'drive') {
      const preview = await this.backend.thumbnail(item.id).catch(() => null)
      if (preview) return this.save(key, 'jpg', this.resize(preview, THUMB_EDGE) ?? preview)
    }
    if (item.kind === 'video') return null
    if (item.ext === 'gif') {
      const bytes = await this.original(item, MAX_RAW_BYTES)
      return bytes ? this.save(key, 'gif', bytes) : null
    }
    const bytes = await this.original(item, MAX_DECODE_BYTES)
    if (!bytes) return null
    // Phone photos are often stored turned and marked with an EXIF orientation, which the
    // scaler here ignores: the window draws those thumbnails itself (it applies the orientation).
    if ((item.ext === 'jpg' || item.ext === 'jpeg') && jpegOrientation(bytes) > 1) return null
    const small = this.resize(bytes, THUMB_EDGE)
    if (small) return this.save(key, 'jpg', small)
    // Cannot decode here (e.g. CMYK JPEG): let the window try the file itself.
    return bytes.length <= MAX_RAW_BYTES ? this.save(key, item.ext === 'png' ? 'png' : 'jpg', bytes) : null
  }

  /** Try again the files that had no thumbnail (e.g. after the connection came back). */
  resetFailures(): void {
    this.failed.clear()
  }

  /** A frame the window drew from a video. */
  store(item: Pick<MediaItem, 'id' | 'version'>, bytes: Uint8Array): void {
    const key = this.key(item.id, item.version)
    this.failed.delete(key)
    this.save(key, 'jpg', bytes)
  }
}
