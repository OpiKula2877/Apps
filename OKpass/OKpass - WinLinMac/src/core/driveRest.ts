// Google Drive storage over the REST API: folder "OKpass" with vault.okp and a backups subfolder.
// Works with Node fetch (desktop) and in the Android WebView (Drive supports CORS).
import { concat, randomBytes, toHex, utf8, view } from './bytes'
import { AuthError, type Account, type BackupInfo, type RemoteVault, type StorageBackend } from './backend'
import { classifyError, statusError } from './errors'
import type { TokenProvider } from './platform'

const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
const FOLDER_MIME = 'application/vnd.google-apps.folder'
const APP_FOLDER = 'OKpass'
const BACKUP_FOLDER = 'backups'
const VAULT_NAME = 'vault.okp'
const TIMEOUT_MS = 30_000

interface DriveFile {
  id: string
  name?: string
  md5Checksum?: string
  createdTime?: string
}

const quote = (value: string): string => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

export class DriveRestBackend implements StorageBackend {
  private folderId: string | null = null
  private backupFolderId: string | null = null
  private vaultId: string | null = null

  constructor(
    private readonly tokens: TokenProvider,
    private readonly fetchImpl: typeof fetch = (...args) => globalThis.fetch(...args)
  ) {}

  private async token(): Promise<string> {
    try {
      const token = await this.tokens.getToken()
      if (!token) throw new AuthError('no access token')
      return token
    } catch (error) {
      throw classifyError(error)
    }
  }

  /** One request; an expired access token (401) is renewed once and the request repeated. */
  private async call(url: string, init: RequestInit = {}, retried = false): Promise<Response> {
    const token = await this.token()
    let response: Response
    try {
      response = await this.fetchImpl(url, {
        ...init,
        headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(TIMEOUT_MS)
      })
    } catch (error) {
      throw classifyError(error)
    }
    if (response.status === 401 && !retried) {
      this.tokens.invalidate()
      return this.call(url, init, true)
    }
    if (!response.ok) throw statusError(response.status, await response.text().catch(() => ''))
    return response
  }

  private async json<T>(url: string, init?: RequestInit): Promise<T> {
    return (await this.call(url, init)).json() as Promise<T>
  }

  private async find(query: string, fields: string, orderBy?: string, pageSize = 10): Promise<DriveFile[]> {
    const params = new URLSearchParams({ q: `${query} and trashed = false`, spaces: 'drive', fields, pageSize: String(pageSize) })
    if (orderBy) params.set('orderBy', orderBy)
    return (await this.json<{ files?: DriveFile[] }>(`${API}/files?${params}`)).files ?? []
  }

  private async ensureFolder(name: string, parent: string): Promise<string> {
    const found = await this.find(`name = '${quote(name)}' and mimeType = '${FOLDER_MIME}' and '${parent}' in parents`, 'files(id,name)')
    if (found.length) return found[0].id
    const created = await this.json<DriveFile>(`${API}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parent] })
    })
    return created.id
  }

  private async folder(): Promise<string> {
    this.folderId ??= await this.ensureFolder(APP_FOLDER, 'root')
    return this.folderId
  }

  private async backups(): Promise<string> {
    this.backupFolderId ??= await this.ensureFolder(BACKUP_FOLDER, await this.folder())
    return this.backupFolderId
  }

  private async download(id: string): Promise<Uint8Array> {
    const response = await this.call(`${API}/files/${encodeURIComponent(id)}?alt=media`)
    try {
      return new Uint8Array(await response.arrayBuffer())
    } catch (error) {
      throw classifyError(error)
    }
  }

  private async createFile(name: string, parent: string, data: Uint8Array): Promise<DriveFile> {
    const boundary = `okpass-${toHex(randomBytes(12))}`
    const metadata = JSON.stringify({ name, parents: [parent] })
    const body = concat(
      utf8(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`),
      data,
      utf8(`\r\n--${boundary}--`)
    )
    return this.json<DriveFile>(`${UPLOAD}/files?uploadType=multipart&fields=id,md5Checksum`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: view(body)
    })
  }

  async account(): Promise<Account> {
    const about = await this.json<{ user?: { displayName?: string; emailAddress?: string; permissionId?: string } }>(
      `${API}/about?fields=${encodeURIComponent('user(displayName,emailAddress,permissionId)')}`
    )
    const user = about.user ?? {}
    return { id: user.permissionId || user.emailAddress || '', email: user.emailAddress ?? '', displayName: user.displayName ?? '' }
  }

  async downloadVault(): Promise<RemoteVault | null> {
    const found = await this.find(`name = '${VAULT_NAME}' and '${await this.folder()}' in parents`, 'files(id,md5Checksum)', 'modifiedTime desc')
    if (!found.length) {
      this.vaultId = null
      return null
    }
    this.vaultId = found[0].id
    return { data: await this.download(found[0].id), revision: found[0].md5Checksum ?? '' }
  }

  async uploadVault(data: Uint8Array): Promise<string> {
    let result: DriveFile
    if (this.vaultId === null) {
      result = await this.createFile(VAULT_NAME, await this.folder(), data)
    } else {
      result = await this.json<DriveFile>(`${UPLOAD}/files/${encodeURIComponent(this.vaultId)}?uploadType=media&fields=id,md5Checksum`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: view(data)
      })
    }
    this.vaultId = result.id
    return result.md5Checksum ?? ''
  }

  async listBackups(): Promise<BackupInfo[]> {
    const found = await this.find(`'${await this.backups()}' in parents`, 'files(id,name,createdTime)', 'createdTime desc', 200)
    return found.map((f) => ({ id: f.id, name: f.name ?? '', created: f.createdTime ?? '' }))
  }

  async createBackup(data: Uint8Array, name: string): Promise<void> {
    await this.createFile(name, await this.backups(), data)
  }

  downloadBackup(id: string): Promise<Uint8Array> {
    return this.download(id)
  }

  async deleteBackup(id: string): Promise<void> {
    await this.call(`${API}/files/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }
}
