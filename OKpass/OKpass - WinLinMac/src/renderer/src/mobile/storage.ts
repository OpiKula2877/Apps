// Phone storage: settings in Preferences, the encrypted offline copy in the app's private files.
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Preferences } from '@capacitor/preferences'
import { fromBase64, sha256Hex, toBase64 } from '../../../core/bytes'
import type { CacheStore, CachedVault } from '../../../core/repository'
import { sanitizeSettings } from '../../../core/settings'
import type { Settings } from '../../../shared/ipc'

export async function loadSettings(): Promise<Settings> {
  try {
    const { value } = await Preferences.get({ key: 'settings' })
    return sanitizeSettings(value ? JSON.parse(value) : {})
  } catch {
    return sanitizeSettings({})
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await Preferences.set({ key: 'settings', value: JSON.stringify(settings) })
}

async function readBytes(path: string): Promise<Uint8Array> {
  const { data } = await Filesystem.readFile({ path, directory: Directory.Data })
  if (typeof data === 'string') return fromBase64(data)
  return new Uint8Array(await data.arrayBuffer())
}

export class CapacitorCache implements CacheStore {
  constructor(private readonly accountId: string) {}

  private async folder(): Promise<string> {
    return `cache/${(await sha256Hex(this.accountId)).slice(0, 24)}`
  }

  async read(): Promise<CachedVault | null> {
    try {
      const folder = await this.folder()
      const data = await readBytes(`${folder}/vault.okp`)
      const meta = await Filesystem.readFile({ path: `${folder}/meta.json`, directory: Directory.Data, encoding: Encoding.UTF8 })
      const parsed = JSON.parse(String(meta.data))
      return { data, baseRevision: parsed.base_revision ?? null, pending: Boolean(parsed.pending) }
    } catch {
      return null
    }
  }

  async write(data: Uint8Array, baseRevision: string | null, pending: boolean): Promise<void> {
    const folder = await this.folder()
    // Write a temporary file first, so a crash never leaves a half-written vault.
    await Filesystem.writeFile({ path: `${folder}/vault.tmp`, data: toBase64(data), directory: Directory.Data, recursive: true })
    await Filesystem.rename({ from: `${folder}/vault.tmp`, to: `${folder}/vault.okp`, directory: Directory.Data, toDirectory: Directory.Data })
    await Filesystem.writeFile({
      path: `${folder}/meta.json`,
      data: JSON.stringify({ base_revision: baseRevision, pending }),
      directory: Directory.Data,
      encoding: Encoding.UTF8,
      recursive: true
    })
  }

  async clear(): Promise<void> {
    try {
      await Filesystem.rmdir({ path: await this.folder(), directory: Directory.Data, recursive: true })
    } catch {
      // nothing cached
    }
  }
}
