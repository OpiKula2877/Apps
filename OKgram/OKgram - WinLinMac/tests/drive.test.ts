// Google Drive REST backend against a small in-memory imitation of the Drive API.
import { describe, expect, it } from 'vitest'
import { AuthError, OfflineError, type UploadSource } from '../src/core/backend'
import { CHUNK, DriveRestBackend, driveItem, parseExifTime } from '../src/core/driveRest'

interface FakeFile {
  id: string
  name: string
  parents: string[]
  mimeType: string
  data: Uint8Array
  trashed?: boolean
  thumbnailLink?: string
}

class FakeDrive {
  files: FakeFile[] = []
  calls: string[] = []
  failNext: number[] = []
  breakChunk = -1
  sessions = new Map<string, { meta: { name: string; parents: string[] }; size: number; received: Uint8Array; got: number }>()
  private counter = 0

  fetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input))
    const method = init.method ?? 'GET'
    this.calls.push(`${method} ${url.pathname}`)
    const status = this.failNext.shift()
    if (status) return new Response('fail', { status })
    const body = init.body as Uint8Array | string | undefined
    const json = (value: unknown, code = 200): Response => new Response(JSON.stringify(value), { status: code, headers: { 'Content-Type': 'application/json' } })
    const meta = (f: FakeFile) => ({ id: f.id, name: f.name, mimeType: f.mimeType, size: String(f.data.length), md5Checksum: `md5-${f.data.length}-${f.data[0] ?? 0}`, createdTime: '2026-01-02T03:04:05Z', modifiedTime: '2026-01-02T03:04:05Z', thumbnailLink: f.thumbnailLink })

    if (url.pathname === '/drive/v3/about') return json({ user: { emailAddress: 'opi@example.com', displayName: 'Opi', permissionId: 'p1' }, storageQuota: { usage: '10', limit: '100' } })
    if (url.pathname === '/drive/v3/files' && method === 'GET') {
      const q = url.searchParams.get('q') ?? ''
      let found = this.files.filter((f) => !f.trashed)
      const name = /name = '([^']+)'/.exec(q)?.[1]
      const parent = /'([^']+)' in parents/.exec(q)?.[1]
      if (name) found = found.filter((f) => f.name === name)
      if (parent) found = found.filter((f) => f.parents.includes(parent))
      if (q.includes("mimeType = 'application/vnd.google-apps.folder'")) found = found.filter((f) => f.mimeType.endsWith('folder'))
      if (q.includes("mimeType != 'application/vnd.google-apps.folder'")) found = found.filter((f) => !f.mimeType.endsWith('folder'))
      const size = Number(url.searchParams.get('pageSize') ?? 100)
      const start = Number(url.searchParams.get('pageToken') ?? 0)
      const page = found.slice(start, start + Math.min(size, 2))
      return json({ files: page.map(meta), nextPageToken: start + 2 < found.length ? String(start + 2) : undefined })
    }
    if (url.pathname === '/drive/v3/files' && method === 'POST') {
      const data = JSON.parse(String(body))
      const file = { id: `id${++this.counter}`, name: data.name, parents: data.parents, mimeType: data.mimeType, data: new Uint8Array(0) }
      this.files.push(file)
      return json(meta(file))
    }
    if (url.pathname === '/upload/drive/v3/files' && url.searchParams.get('uploadType') === 'multipart') {
      const text = new TextDecoder().decode(body as Uint8Array)
      const metaJson = JSON.parse(text.split('\r\n\r\n')[1].split('\r\n')[0])
      const content = text.split('\r\n\r\n')[2].split('\r\n--')[0]
      const file = { id: `id${++this.counter}`, name: metaJson.name, parents: metaJson.parents, mimeType: 'application/json', data: new TextEncoder().encode(content) }
      this.files.push(file)
      return json(meta(file))
    }
    if (url.pathname === '/upload/drive/v3/files' && url.searchParams.get('uploadType') === 'resumable') {
      const id = `s${++this.counter}`
      const headers = init.headers as Record<string, string>
      this.sessions.set(id, { meta: JSON.parse(String(body)), size: Number(headers['X-Upload-Content-Length']), received: new Uint8Array(Number(headers['X-Upload-Content-Length'])), got: 0 })
      return new Response(null, { status: 200, headers: { Location: `https://upload.example/session/${id}` } })
    }
    if (url.hostname === 'upload.example') {
      const session = this.sessions.get(url.pathname.split('/').pop()!)!
      const range = (init.headers as Record<string, string>)['Content-Range']
      const done = (): Response => {
        const file = { id: `id${++this.counter}`, name: session.meta.name, parents: session.meta.parents, mimeType: 'image/jpeg', data: session.received }
        this.files.push(file)
        return json(meta(file))
      }
      if (range.startsWith('bytes */')) {
        if (session.got === session.size) return done()
        return new Response(null, { status: 308, headers: session.got ? { Range: `bytes=0-${session.got - 1}` } : {} })
      }
      const [, from, to] = /bytes (\d+)-(\d+)\//.exec(range)!.map(Number)
      if (this.breakChunk === from) {
        this.breakChunk = -1
        // the chunk arrives, but the answer is lost
        session.received.set(body as Uint8Array, from)
        session.got = to + 1
        throw new TypeError('fetch failed')
      }
      if (from !== session.got) return new Response('bad offset', { status: 400 })
      session.received.set(body as Uint8Array, from)
      session.got = to + 1
      if (session.got === session.size) return done()
      return new Response(null, { status: 308, headers: { Range: `bytes=0-${session.got - 1}` } })
    }
    const fileMatch = /^\/(upload\/)?drive\/v3\/files\/([^/]+)(\/permissions(\/.*)?)?$/.exec(url.pathname)
    if (fileMatch) {
      const file = this.files.find((f) => f.id === fileMatch[2])
      if (!file) return new Response('not found', { status: 404 })
      if (fileMatch[3]) return json({ id: 'perm' })
      if (method === 'PATCH' && fileMatch[1]) {
        file.data = body as Uint8Array
        return json(meta(file))
      }
      if (method === 'PATCH') {
        Object.assign(file, JSON.parse(String(body)))
        return json(meta(file))
      }
      if (url.searchParams.get('alt') === 'media') {
        const range = (init.headers as Record<string, string>)?.Range
        if (range) {
          const [, from, to] = /bytes=(\d+)-(\d+)/.exec(range)!.map(Number)
          return new Response(file.data.slice(from, to + 1), { status: 206, headers: { 'Content-Range': `bytes ${from}-${to}/${file.data.length}` } })
        }
        return new Response(file.data as Uint8Array<ArrayBuffer>)
      }
      return json({ ...meta(file), webViewLink: `https://drive.google.com/file/d/${file.id}/view` })
    }
    return new Response('unknown', { status: 404 })
  }
}

const tokens = (fail = false) => {
  let invalidated = 0
  return {
    async getToken() {
      if (fail) throw new AuthError('expired')
      return 'token'
    },
    invalidate() {
      invalidated++
    },
    get invalidated() {
      return invalidated
    }
  }
}

function source(bytes: Uint8Array, name = 'photo.jpg'): UploadSource {
  return { path: name, name, size: bytes.length, mime: 'image/jpeg', modified: 0, read: async (start, end) => bytes.slice(start, end) }
}

const noSleep = async (): Promise<void> => undefined

describe('DriveRestBackend', () => {
  it('creates the OKgram folder once and lists only supported media, page by page', async () => {
    const drive = new FakeDrive()
    const backend = new DriveRestBackend(tokens(), { fetchImpl: drive.fetch as typeof fetch, sleep: noSleep })
    expect(await backend.account()).toEqual({ id: 'p1', email: 'opi@example.com', displayName: 'Opi' })
    const folder = drive.files.find((f) => f.name === 'OKgram')!
    for (const name of ['a.jpg', 'b.mp4', 'notes.txt', 'okgram.json', 'c.png']) {
      drive.files.push({ id: name, name, parents: [folder.id], mimeType: 'x', data: new Uint8Array([1]) })
    }
    const list = await backend.listMedia()
    expect(list.map((m) => m.id).sort()).toEqual(['a.jpg', 'b.mp4', 'c.png'])
    expect(list.find((m) => m.id === 'b.mp4')?.kind).toBe('video')
    expect(drive.files.filter((f) => f.name === 'OKgram')).toHaveLength(1)
  })

  it('writes, finds and updates okgram.json', async () => {
    const drive = new FakeDrive()
    const backend = new DriveRestBackend(tokens(), { fetchImpl: drive.fetch as typeof fetch, sleep: noSleep })
    expect(await backend.readData()).toBeNull()
    await backend.writeData(new TextEncoder().encode('{"a":1}'))
    const fresh = new DriveRestBackend(tokens(), { fetchImpl: drive.fetch as typeof fetch, sleep: noSleep })
    const read = await fresh.readData()
    expect(new TextDecoder().decode(read!.data)).toBe('{"a":1}')
    await fresh.writeData(new TextEncoder().encode('{"a":2}'))
    expect(drive.files.filter((f) => f.name === 'okgram.json')).toHaveLength(1)
    expect(await fresh.dataRevision()).toBe(await backend.dataRevision())
  })

  it('uploads in chunks and continues after a lost answer', async () => {
    const drive = new FakeDrive()
    const backend = new DriveRestBackend(tokens(), { fetchImpl: drive.fetch as typeof fetch, sleep: noSleep })
    const bytes = new Uint8Array(CHUNK * 2 + 1000).map((_, i) => i % 251)
    drive.breakChunk = CHUNK
    const progress: number[] = []
    const item = await backend.upload(source(bytes), (done) => progress.push(done), new AbortController().signal)
    expect(item.name).toBe('photo.jpg')
    const stored = drive.files.find((f) => f.id === item.id)!
    expect(Buffer.from(stored.data).equals(Buffer.from(bytes))).toBe(true)
    expect(progress.at(-1)).toBe(bytes.length)
  })

  it('repeats rate-limited requests and renews an expired access token', async () => {
    const drive = new FakeDrive()
    const t = tokens()
    const backend = new DriveRestBackend(t, { fetchImpl: drive.fetch as typeof fetch, sleep: noSleep })
    drive.failNext = [503, 429]
    await backend.account()
    drive.failNext = [401]
    await backend.quota()
    expect(t.invalidated).toBe(1)
    drive.failNext = [503, 503, 503, 503]
    await expect(backend.quota()).rejects.toBeInstanceOf(OfflineError)
  })

  it('reports a sign-in that no longer works', async () => {
    const backend = new DriveRestBackend(tokens(true), { fetchImpl: new FakeDrive().fetch as typeof fetch, sleep: noSleep })
    await expect(backend.account()).rejects.toBeInstanceOf(AuthError)
  })

  it('streams ranges, renames, trashes and shares', async () => {
    const drive = new FakeDrive()
    const backend = new DriveRestBackend(tokens(), { fetchImpl: drive.fetch as typeof fetch, sleep: noSleep })
    const item = await backend.upload(source(new Uint8Array([1, 2, 3, 4, 5])), () => undefined, new AbortController().signal)
    const part = await backend.open(item.id, 'bytes=1-3')
    expect(part.status).toBe(206)
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(new Uint8Array([2, 3, 4]))
    expect((await backend.rename(item.id, 'nove.jpg')).name).toBe('nove.jpg')
    expect(await backend.share(item.id)).toContain(item.id)
    await backend.trash(item.id)
    expect(await backend.listMedia()).toEqual([])
    expect(await backend.quota()).toEqual({ used: 10, limit: 100 })
  })
})

describe('driveItem', () => {
  it('maps Drive metadata (EXIF time, turned photos, video length)', () => {
    const photo = driveItem({ id: '1', name: 'IMG.JPG', size: '2048', md5Checksum: 'm', imageMediaMetadata: { width: 4000, height: 3000, rotation: 1, time: '2023:12:24 18:30:00' } })!
    expect(photo).toMatchObject({ kind: 'image', ext: 'jpg', width: 3000, height: 4000, size: 2048, version: 'm' })
    expect(new Date(photo.taken!).getMonth()).toBe(11)
    expect(driveItem({ id: '2', name: 'v.webm', videoMediaMetadata: { durationMillis: '61000' } })!.duration).toBe(61000)
    expect(driveItem({ id: '3', name: 'okgram.json' })).toBeNull()
    expect(parseExifTime('0000:00:00 00:00:00')).toBeNull()
  })
})
