// Library in a folder on this computer: every supported photo and video in the folder and
// its subfolders, plus okgram.json in the folder itself. Ids are paths relative to the folder.
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, watch } from 'node:fs'
import { access, constants, mkdir, open, readFile, readdir, rename, rm, stat, statfs, utimes, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { MediaItem } from '../shared/ipc'
import { extensionOf, kindOf, mimeOf } from '../shared/formats'
import { uniqueName } from '../shared/library'
import { DATA_FILE } from '../shared/model'
import { BackendError, type Account, type MediaBackend, type RemoteData, type UploadSource } from '../core/backend'
import { readImageInfo, type ImageInfo } from '../core/imageSize'
import { parseRange } from '../core/range'

const HEAD_BYTES = 256 * 1024
const MAX_DEPTH = 12
const MAX_FILES = 100_000

const sha1 = (data: Uint8Array | string): string => createHash('sha1').update(data).digest('hex')

/** Absolute path of `id` inside `root`, or null when it points outside. */
export function resolveInside(root: string, id: string): string | null {
  const base = resolve(root)
  const target = resolve(base, id)
  return target.startsWith(base + sep) ? target : null
}

const toId = (root: string, path: string): string => relative(root, path).split(sep).join('/')

async function readHead(path: string): Promise<Uint8Array> {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(HEAD_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, HEAD_BYTES, 0)
    return new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead)
  } finally {
    await handle.close()
  }
}

/** Run `work` for every element with at most `limit` running at once. */
async function eachLimited<T>(list: T[], limit: number, work: (value: T) => Promise<void>): Promise<void> {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, list.length) }, async () => {
      while (next < list.length) await work(list[next++])
    })
  )
}

export interface LocalHooks {
  /** Move a file to the system trash. */
  trash(path: string): Promise<void>
}

export class LocalLibrary implements MediaBackend {
  readonly kind = 'local' as const
  readonly root: string
  private readonly infoCache = new Map<string, { version: string; info: ImageInfo | null }>()

  constructor(
    root: string,
    private readonly hooks: LocalHooks
  ) {
    this.root = resolve(root)
  }

  private path(id: string): string {
    const target = resolveInside(this.root, id)
    if (!target) throw new BackendError('path outside the library')
    return target
  }

  localPath(id: string): string {
    return this.path(id)
  }

  async account(): Promise<Account> {
    try {
      await mkdir(this.root, { recursive: true })
      await access(this.root, constants.R_OK | constants.W_OK)
    } catch {
      throw new BackendError('not_writable')
    }
    return { id: this.root, email: this.root, displayName: basename(this.root) || this.root }
  }

  private async item(path: string): Promise<MediaItem | null> {
    const name = basename(path)
    const kind = kindOf(name)
    if (!kind) return null
    const info = await stat(path)
    if (!info.isFile()) return null
    const id = toId(this.root, path)
    const version = `${info.size}-${Math.round(info.mtimeMs)}`
    let image: ImageInfo | null = null
    if (kind === 'image') {
      const cached = this.infoCache.get(id)
      if (cached?.version === version) image = cached.info
      else {
        image = readImageInfo(await readHead(path).catch(() => new Uint8Array(0)), extensionOf(name))
        this.infoCache.set(id, { version, info: image })
      }
    }
    return {
      id,
      name,
      ext: extensionOf(name),
      kind,
      mime: mimeOf(name),
      size: info.size,
      created: Math.round(info.birthtimeMs || info.ctimeMs),
      modified: Math.round(info.mtimeMs),
      taken: image?.taken ?? null,
      width: image?.width ?? null,
      height: image?.height ?? null,
      duration: null,
      version,
      shared: false
    }
  }

  async listMedia(): Promise<MediaItem[]> {
    await this.account()
    const files: string[] = []
    const walk = async (folder: string, depth: number): Promise<void> => {
      let entries
      try {
        entries = await readdir(folder, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.') || files.length >= MAX_FILES) continue
        const path = join(folder, entry.name)
        if (entry.isDirectory() && depth < MAX_DEPTH) await walk(path, depth + 1)
        else if (entry.isFile() && kindOf(entry.name) && !(depth === 0 && entry.name === DATA_FILE)) files.push(path)
      }
    }
    await walk(this.root, 0)
    const items: MediaItem[] = []
    await eachLimited(files, 16, async (path) => {
      const item = await this.item(path).catch(() => null)
      if (item) items.push(item)
    })
    return items
  }

  private dataPath(): string {
    return join(this.root, DATA_FILE)
  }

  async readData(): Promise<RemoteData | null> {
    try {
      const data = new Uint8Array(await readFile(this.dataPath()))
      return { data, revision: sha1(data) }
    } catch {
      return null
    }
  }

  async dataRevision(): Promise<string | null> {
    return (await this.readData())?.revision ?? null
  }

  async writeData(data: Uint8Array): Promise<string> {
    const tmp = `${this.dataPath()}.tmp`
    await writeFile(tmp, data)
    await rename(tmp, this.dataPath())
    return sha1(data)
  }

  private async taken(folder: string): Promise<Set<string>> {
    return new Set((await readdir(folder).catch(() => [] as string[])).map((name) => name.toLowerCase()))
  }

  async upload(source: UploadSource, onProgress: (done: number) => void, signal: AbortSignal): Promise<MediaItem> {
    await this.account()
    const name = uniqueName(basename(source.name), await this.taken(this.root))
    const target = join(this.root, name)
    let done = 0
    const count = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        done += chunk.length
        onProgress(done)
        callback(null, chunk)
      }
    })
    try {
      await pipeline(createReadStream(source.path), count, createWriteStream(target, { flags: 'wx' }), { signal })
    } catch (error) {
      await rm(target, { force: true })
      throw error
    }
    if (source.modified) await utimes(target, new Date(), new Date(source.modified)).catch(() => undefined)
    const item = await this.item(target)
    if (!item) throw new BackendError('unsupported file')
    return item
  }

  async rename(id: string, name: string): Promise<MediaItem> {
    const from = this.path(id)
    const to = join(dirname(from), name)
    if (to !== from && (await this.taken(dirname(from))).has(name.toLowerCase()) && name.toLowerCase() !== basename(from).toLowerCase()) {
      throw new BackendError('exists')
    }
    await rename(from, to)
    const item = await this.item(to)
    if (!item) throw new BackendError('unsupported name')
    return item
  }

  async trash(id: string): Promise<void> {
    await this.hooks.trash(this.path(id))
  }

  async open(id: string, range: string | null): Promise<Response> {
    const path = this.path(id)
    const info = await stat(path)
    const type = mimeOf(path)
    const parsed = parseRange(range, info.size)
    if (parsed === 'invalid') return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${info.size}` } })
    const start = parsed?.start ?? 0
    const end = parsed?.end ?? info.size - 1
    const body = info.size === 0 ? null : (Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream<Uint8Array>)
    const headers: Record<string, string> = { 'Content-Type': type, 'Content-Length': String(info.size === 0 ? 0 : end - start + 1), 'Accept-Ranges': 'bytes' }
    if (parsed) headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`
    return new Response(body, { status: parsed ? 206 : 200, headers })
  }

  async thumbnail(): Promise<Uint8Array | null> {
    return null
  }

  async share(): Promise<string> {
    throw new BackendError('unsupported')
  }

  async unshare(): Promise<void> {
    throw new BackendError('unsupported')
  }

  async quota(): Promise<{ used: number; limit: number | null }> {
    const info = await statfs(this.root)
    return { used: (info.blocks - info.bfree) * info.bsize, limit: info.blocks * info.bsize }
  }

  watch(onChange: () => void): () => void {
    try {
      const watcher = watch(this.root, { recursive: true }, (_event, file) => {
        const name = file ? basename(String(file)) : ''
        if (name === DATA_FILE || name.endsWith('.tmp') || name.startsWith('.')) return
        onChange()
      })
      watcher.on('error', () => undefined)
      return () => watcher.close()
    } catch {
      return () => undefined
    }
  }
}
