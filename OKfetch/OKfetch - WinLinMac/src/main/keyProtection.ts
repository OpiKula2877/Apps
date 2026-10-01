// Keys (identity, contact keys, password key) are wrapped by the operating system:
// DPAPI on Windows, Keychain on macOS, libsecret / kwallet on Linux.
import { safeStorage } from 'electron'
import { plainProtector, type KeyProtector } from '../core/state'

export function createProtector(): KeyProtector {
  const available = safeStorage.isEncryptionAvailable()
  let backend = 'none'
  if (available) {
    if (process.platform === 'linux') backend = safeStorage.getSelectedStorageBackend()
    else backend = process.platform === 'win32' ? 'dpapi' : 'keychain'
  }
  const strong = available && backend !== 'basic_text' && backend !== 'unknown' && backend !== 'none'
  return {
    backend,
    strong,
    protect: (secret) => (available ? `os:${safeStorage.encryptString(secret).toString('base64')}` : plainProtector.protect(secret)),
    unprotect: (blob) => (blob.startsWith('os:') ? safeStorage.decryptString(Buffer.from(blob.slice(3), 'base64')) : plainProtector.unprotect(blob))
  }
}
