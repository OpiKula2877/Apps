// Browser stand-ins used when the phone build runs outside Android (development and tests).
// Storage lives in localStorage; set localStorage["okpass-dev:offline"] = "1" to simulate offline.
import { fromBase64, toBase64, toHex } from '../../../core/bytes'
import { OfflineError, type Account, type BackupInfo, type RemoteVault, type StorageBackend } from '../../../core/backend'
import type { AuthAdapter, BiometricAdapter } from '../../../core/platform'

const KEY = 'okpass-dev:'

async function md5ish(data: Uint8Array): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(data)))).slice(0, 32)
}

export class WebDevBackend implements StorageBackend {
  private check(): void {
    if (localStorage.getItem(`${KEY}offline`) === '1') throw new OfflineError('simulated offline mode')
  }

  private backups(): BackupInfo[] {
    return JSON.parse(localStorage.getItem(`${KEY}backups`) ?? '[]')
  }

  async account(): Promise<Account> {
    this.check()
    return { id: 'local-dev', email: 'local-dev@okpass', displayName: 'Local Dev' }
  }

  async downloadVault(): Promise<RemoteVault | null> {
    this.check()
    const stored = localStorage.getItem(`${KEY}vault`)
    if (!stored) return null
    const data = fromBase64(stored)
    return { data, revision: await md5ish(data) }
  }

  async uploadVault(data: Uint8Array): Promise<string> {
    this.check()
    localStorage.setItem(`${KEY}vault`, toBase64(data))
    return md5ish(data)
  }

  async listBackups(): Promise<BackupInfo[]> {
    this.check()
    return this.backups()
  }

  async createBackup(data: Uint8Array, name: string): Promise<void> {
    this.check()
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    localStorage.setItem(`${KEY}backup:${id}`, toBase64(data))
    localStorage.setItem(`${KEY}backups`, JSON.stringify([{ id, name, created: new Date().toISOString() }, ...this.backups()]))
  }

  async downloadBackup(id: string): Promise<Uint8Array> {
    this.check()
    return fromBase64(localStorage.getItem(`${KEY}backup:${id}`) ?? '')
  }

  async deleteBackup(id: string): Promise<void> {
    this.check()
    localStorage.removeItem(`${KEY}backup:${id}`)
    localStorage.setItem(`${KEY}backups`, JSON.stringify(this.backups().filter((b) => b.id !== id)))
  }
}

export const devAuth: AuthAdapter = {
  needsClientSecret: false,
  hasClientSecret: async () => true,
  chooseClientSecret: async () => 'cancel',
  load: async () => null,
  login: async () => {
    throw new Error('no sign-in in development mode')
  },
  logout: async () => undefined
}

/** Fingerprint stand-in: "touching the sensor" always succeeds. */
export function createWebBiometric(): BiometricAdapter {
  const slot = `${KEY}bio`
  return {
    available: async () => true,
    enabled: async () => sessionStorage.getItem(slot) !== null,
    async store(secret) {
      sessionStorage.setItem(slot, toBase64(secret))
      return true
    },
    unlock: async () => {
      const stored = sessionStorage.getItem(slot)
      return stored ? fromBase64(stored) : null
    },
    clear: async () => sessionStorage.removeItem(slot)
  }
}

/** Browser "export": download the file. */
export async function downloadFile(name: string, data: Uint8Array): Promise<boolean> {
  const url = URL.createObjectURL(new Blob([new Uint8Array(data)], { type: 'application/octet-stream' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return true
}
