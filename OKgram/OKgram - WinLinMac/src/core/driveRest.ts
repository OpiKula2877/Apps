// Google Drive storage over the REST API: folder "OKgram" holding the photos, videos and okgram.json.
// The app uses the drive.file scope, so it sees only the files it created itself.
import type { MediaItem } from '../shared/ipc'
import { extensionOf, kindOf, mimeOf } from '../shared/formats'
import { DATA_FILE } from '../shared/model'
import { AuthError, BackendError, type Account, type MediaBackend, type RemoteData, type UploadSource } from './backend'
import { RETRYABLE, classifyError, statusError } from './errors'

export interface TokenProvider {
  /** A valid access token, refreshed when needed. Throws AuthError or OfflineError. */
  getToken(): Promise<string>
  /** Forget the current access token (after Google answered 401). */
  invalidate(): void
}

const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
const FOLDER_MIME = 'application/vnd.google-apps.folder'
export const APP_FOLDER = 'OKgram'
const TIMEOUT_MS = 30_000
/** Upload chunk: a multiple of 256 KiB, as Drive requires. */
export const CHUNK = 8 * 1024 * 1024
const RETRIES = 3
const FIELDS =
  'id,name,mimeType,size,createdTime,modifiedTime,md5Checksum,version,thumbnailLink,shared,imageMediaMetadata(width,height,time,rotation),videoMediaMetadata(width,height,durationMillis)'

interface DriveFile {
  id: string
  name?: string
  mimeType?: string
  size?: string
  createdTime?: string
  modifiedTime?: string
  md5Checksum?: string
  version?: string
  thumbnailLink?: string
  shared?: boolean
  webViewLink?: string
  imageMediaMetadata?: { width?: number; height?: number; time?: string; rotation?: number }
  videoMediaMetadata?: { width?: number; height?: number; durationMillis?: string }
}

const quote = (value: string): string => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
/** Bytes as a request body (the DOM typings want an ArrayBuffer-backed view). */
const asBody = (bytes: Uint8Array): BodyInit => bytes as Uint8Array<ArrayBuffer>
const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** EXIF time "2024:07:31 18:02:11" (camera local time). */
export function parseExifTime(value: string | undefined): number | null {
  const match = value && /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value)
  if (!match) return null
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number)
  if (year < 1900) return null
  const time = new Date(year, month - 1, day, hour, minute, second).getTime()
  return Number.isFinite(time) ? time : null
}

export function driveItem(file: DriveFile): MediaItem | null {
  const name = file.name ?? ''
  const kind = kindOf(name)
  if (!kind || name === DATA_FILE) return null
  const image = file.imageMediaMetadata
  const video = file.videoMediaMetadata
  let width = image?.width ?? video?.width ?? null
  let height = image?.height ?? video?.height ?? null
  if (image?.rotation && image.rotation % 2 === 1) [width, height] = [height, width]
  const time = (value?: string): number => (value ? Date.parse(value) || 0 : 0)
  return {
    id: file.id,
    name,
    ext: extensionOf(name),
    kind,
    mime: mimeOf(name),
    size: Number(file.size ?? 0) || 0,
    created: time(file.createdTime),
    modified: time(file.modifiedTime) || time(file.createdTime),
    taken: parseExifTime(image?.time),
    width,
    height,
    duration: video?.durationMillis ? Number(video.durationMillis) || null : null,
    version: file.md5Checksum || file.version || file.modifiedTime || '0',
    shared: Boolean(file.shared)
  }
}

export interface DriveOptions {
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

export class DriveRestBackend implements MediaBackend {
  readonly kind = 'drive' as const
  private folderId: string | null = null
  private dataId: string | null = null
  private readonly thumbLinks = new Map<string, string>()
  private readonly fetchImpl: typeof fetch
  private readonly sleep: (ms: number) => Promise<void>

  constructor(
    private readonly tokens: TokenProvider,
    options: DriveOptions = {}
  ) {
    this.fetchImpl = options.fetchImpl ?? ((...args) => globalThis.fetch(...args))
    this.sleep = options.sleep ?? defaultSleep
  }

  private async token(): Promise<string> {
    try {
      const token = await this.tokens.getToken()
      if (!token) throw new AuthError('no access token')
      return token
    } catch (error) {
      throw classifyError(error)
    }
  }

  /**
   * One request. An expired access token (401) is renewed once; rate limits and server
   * errors are repeated a few times with a growing pause.
   */
  private async call(url: string, init: RequestInit & { timeout?: number | null } = {}, attempt = 0, renewed = false): Promise<Response> {
    const token = await this.token()
    let response: Response
    const { timeout = TIMEOUT_MS, ...rest } = init
    try {
      response = await this.fetchImpl(url, {
        ...rest,
        headers: { ...(rest.headers as Record<string, string>), Authorization: `Bearer ${token}` },
        signal: timeout === null ? rest.signal : rest.signal ? AbortSignal.any([rest.signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout)
      })
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') throw error
      throw classifyError(error)
    }
    if (response.status === 401 && !renewed) {
      this.tokens.invalidate()
      return this.call(url, init, attempt, true)
    }
    if (RETRYABLE.has(response.status) && attempt < RETRIES) {
      await response.body?.cancel().catch(() => undefined)
      await this.sleep(500 * 2 ** attempt + Math.random() * 250)
      return this.call(url, init, attempt + 1, renewed)
    }
    if (!response.ok) throw statusError(response.status, await response.text().catch(() => ''))
    return response
  }

  private async json<T>(url: string, init?: RequestInit): Promise<T> {
    return (await this.call(url, init)).json() as Promise<T>
  }

  private async find(query: string, fields: string, pageSize = 10): Promise<DriveFile[]> {
    const params = new URLSearchParams({ q: `${query} and trashed = false`, spaces: 'drive', fields: `files(${fields})`, pageSize: String(pageSize) })
    return (await this.json<{ files?: DriveFile[] }>(`${API}/files?${params}`)).files ?? []
  }

  private async folder(): Promise<string> {
    if (this.folderId) return this.folderId
    const found = await this.find(`name = '${APP_FOLDER}' and mimeType = '${FOLDER_MIME}' and 'root' in parents`, 'id')
    if (found.length) return (this.folderId = found[0].id)
    const created = await this.json<DriveFile>(`${API}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: APP_FOLDER, mimeType: FOLDER_MIME, parents: ['root'] })
    })
    return (this.folderId = created.id)
  }

  private remember(file: DriveFile): MediaItem | null {
    if (file.thumbnailLink) this.thumbLinks.set(file.id, file.thumbnailLink)
    return driveItem(file)
  }

  async account(): Promise<Account> {
    const about = await this.json<{ user?: { displayName?: string; emailAddress?: string; permissionId?: string } }>(
      `${API}/about?fields=${encodeURIComponent('user(displayName,emailAddress,permissionId)')}`
    )
    const user = about.user ?? {}
    await this.folder()
    return { id: user.permissionId || user.emailAddress || '', email: user.emailAddress ?? '', displayName: user.displayName ?? '' }
  }

  async listMedia(): Promise<MediaItem[]> {
    const folder = await this.folder()
    const items: MediaItem[] = []
    let pageToken = ''
    do {
      const params = new URLSearchParams({
        q: `'${folder}' in parents and trashed = false and mimeType != '${FOLDER_MIME}'`,
        spaces: 'drive',
        fields: `nextPageToken,files(${FIELDS})`,
        pageSize: '1000'
      })
      if (pageToken) params.set('pageToken', pageToken)
      const page = await this.json<{ files?: DriveFile[]; nextPageToken?: string }>(`${API}/files?${params}`)
      for (const file of page.files ?? []) {
        const item = this.remember(file)
        if (item) items.push(item)
      }
      pageToken = page.nextPageToken ?? ''
    } while (pageToken)
    return items
  }

  private async findData(): Promise<DriveFile | null> {
    const found = await this.find(`name = '${quote(DATA_FILE)}' and '${await this.folder()}' in parents`, 'id,md5Checksum')
    this.dataId = found[0]?.id ?? null
    return found[0] ?? null
  }

  async dataRevision(): Promise<string | null> {
    if (!this.dataId) return (await this.findData())?.md5Checksum ?? null
    try {
      const file = await this.json<DriveFile>(`${API}/files/${encodeURIComponent(this.dataId)}?fields=md5Checksum,trashed`)
      return file.md5Checksum ?? null
    } catch (error) {
      if (error instanceof BackendError) return (await this.findData())?.md5Checksum ?? null
      throw error
    }
  }

  async readData(): Promise<RemoteData | null> {
    const file = await this.findData()
    if (!file) return null
    const response = await this.call(`${API}/files/${encodeURIComponent(file.id)}?alt=media`)
    return { data: new Uint8Array(await response.arrayBuffer()), revision: file.md5Checksum ?? '' }
  }

  async writeData(data: Uint8Array): Promise<string> {
    let result: DriveFile
    if (this.dataId === null) await this.findData()
    if (this.dataId === null) {
      const boundary = `okgram-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
      const metadata = JSON.stringify({ name: DATA_FILE, parents: [await this.folder()], mimeType: 'application/json' })
      const head = new TextEncoder().encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n`)
      const tail = new TextEncoder().encode(`\r\n--${boundary}--`)
      const body = new Uint8Array(head.length + data.length + tail.length)
      body.set(head)
      body.set(data, head.length)
      body.set(tail, head.length + data.length)
      result = await this.json<DriveFile>(`${UPLOAD}/files?uploadType=multipart&fields=id,md5Checksum`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body: asBody(body)
      })
    } else {
      result = await this.json<DriveFile>(`${UPLOAD}/files/${encodeURIComponent(this.dataId)}?uploadType=media&fields=id,md5Checksum`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: asBody(data)
      })
    }
    this.dataId = result.id
    return result.md5Checksum ?? ''
  }

  /** Where a broken resumable upload continues: the byte after the last one Drive has. */
  private async uploadOffset(session: string, size: number): Promise<number | MediaItem> {
    const response = await this.fetchImpl(session, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${await this.token()}`, 'Content-Range': `bytes */${size}` },
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    if (response.ok) {
      const item = this.remember(await response.json())
      if (item) return item
    }
    if (response.status !== 308) throw statusError(response.status, await response.text().catch(() => ''))
    const range = response.headers.get('range')
    return range ? Number(range.split('-')[1]) + 1 : 0
  }

  /** Resumable upload in chunks, so big videos survive a short network outage. */
  async upload(source: UploadSource, onProgress: (done: number) => void, signal: AbortSignal): Promise<MediaItem> {
    const init = await this.call(`${UPLOAD}/files?uploadType=resumable&fields=${encodeURIComponent(FIELDS)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': source.mime,
        'X-Upload-Content-Length': String(source.size)
      },
      body: JSON.stringify({ name: source.name, parents: [await this.folder()], modifiedTime: new Date(source.modified || Date.now()).toISOString() }),
      signal
    })
    const session = init.headers.get('location')
    if (!session) throw new BackendError('Drive did not start the upload')
    let offset = 0
    let failures = 0
    for (;;) {
      signal.throwIfAborted()
      const end = Math.min(offset + CHUNK, source.size)
      const chunk = source.size === 0 ? new Uint8Array(0) : await source.read(offset, end)
      let response: Response | null = null
      try {
        response = await this.fetchImpl(session, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${await this.token()}`,
            'Content-Range': source.size === 0 ? 'bytes */0' : `bytes ${offset}-${end - 1}/${source.size}`
          },
          body: asBody(chunk),
          redirect: 'manual',
          signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)])
        })
      } catch (error) {
        if (signal.aborted) throw error
        if (error instanceof AuthError) throw error
      }
      if (response && response.ok) {
        const item = this.remember(await response.json())
        if (!item) throw new BackendError('unsupported file')
        onProgress(source.size)
        return item
      }
      if (response && response.status === 308) {
        const range = response.headers.get('range')
        offset = range ? Number(range.split('-')[1]) + 1 : 0
        failures = 0
        onProgress(offset)
        continue
      }
      if (response && !RETRYABLE.has(response.status) && response.status !== 401) {
        throw statusError(response.status, await response.text().catch(() => ''))
      }
      if (response?.status === 401) this.tokens.invalidate()
      if (++failures > 5) throw response ? statusError(response.status, '') : classifyError(new TypeError('network'))
      await this.sleep(1000 * 2 ** Math.min(failures, 4))
      try {
        const next = await this.uploadOffset(session, source.size)
        if (typeof next !== 'number') {
          onProgress(source.size)
          return next
        }
        offset = next
      } catch {
        // still offline: the next round tries again
      }
    }
  }

  async rename(id: string, name: string): Promise<MediaItem> {
    const file = await this.json<DriveFile>(`${API}/files/${encodeURIComponent(id)}?fields=${encodeURIComponent(FIELDS)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    })
    const item = this.remember(file)
    if (!item) throw new BackendError('unsupported name')
    return item
  }

  async trash(id: string): Promise<void> {
    await this.call(`${API}/files/${encodeURIComponent(id)}?fields=id`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true })
    })
    this.thumbLinks.delete(id)
  }

  open(id: string, range: string | null, signal?: AbortSignal): Promise<Response> {
    return this.call(`${API}/files/${encodeURIComponent(id)}?alt=media`, { headers: range ? { Range: range } : {}, signal, timeout: null })
  }

  async thumbnail(id: string): Promise<Uint8Array | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      let link = attempt === 0 ? this.thumbLinks.get(id) : undefined
      if (!link) {
        const file = await this.json<DriveFile>(`${API}/files/${encodeURIComponent(id)}?fields=thumbnailLink`)
        if (!file.thumbnailLink) return null
        link = file.thumbnailLink
        this.thumbLinks.set(id, link)
      }
      const sized = /=s\d+$/.test(link) ? link.replace(/=s\d+$/, '=s480') : link
      let response: Response
      try {
        response = await this.fetchImpl(sized, { headers: { Authorization: `Bearer ${await this.token()}` }, signal: AbortSignal.timeout(TIMEOUT_MS) })
      } catch (error) {
        throw classifyError(error)
      }
      if (response.ok) return new Uint8Array(await response.arrayBuffer())
      // The link expired: ask Drive for a fresh one.
      this.thumbLinks.delete(id)
      if (RETRYABLE.has(response.status)) throw statusError(response.status, '')
    }
    return null
  }

  async share(id: string): Promise<string> {
    await this.call(`${API}/files/${encodeURIComponent(id)}/permissions?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'reader', type: 'anyone' })
    })
    const file = await this.json<DriveFile>(`${API}/files/${encodeURIComponent(id)}?fields=webViewLink`)
    return file.webViewLink ?? `https://drive.google.com/file/d/${encodeURIComponent(id)}/view`
  }

  async unshare(id: string): Promise<void> {
    try {
      await this.call(`${API}/files/${encodeURIComponent(id)}/permissions/anyoneWithLink`, { method: 'DELETE' })
    } catch (error) {
      if (!(error instanceof BackendError)) throw error
    }
  }

  async quota(): Promise<{ used: number; limit: number | null }> {
    const about = await this.json<{ storageQuota?: { limit?: string; usage?: string } }>(`${API}/about?fields=${encodeURIComponent('storageQuota(limit,usage)')}`)
    const quota = about.storageQuota ?? {}
    return { used: Number(quota.usage ?? 0) || 0, limit: quota.limit ? Number(quota.limit) : null }
  }
}
