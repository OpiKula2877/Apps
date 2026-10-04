// Key protection on Android: a random 32-byte data key, wrapped by a non-exportable Android Keystore key in Java,
// is handed to the worklet at start. Secrets are sealed with it (XChaCha20-Poly1305), like safeStorage on desktop.
import { KEY_BYTES, open, seal } from '../core/sodium'
import { plainProtector, type KeyProtector } from '../core/state'

const AD = 'okfetch/v1/data-key'

export function createDataKeyProtector(dataKey: Uint8Array): KeyProtector {
  if (dataKey.length !== KEY_BYTES) throw new Error('data key must have 32 bytes')
  const key = Buffer.from(dataKey)
  return {
    backend: 'android_keystore',
    strong: true,
    protect: (secret) => `dk:${seal(key, Buffer.from(secret, 'utf8'), AD).toString('base64')}`,
    unprotect(blob) {
      if (!blob.startsWith('dk:')) return plainProtector.unprotect(blob)
      const plain = open(key, Buffer.from(blob.slice(3), 'base64'), AD)
      if (!plain) throw new Error('key_unavailable')
      return plain.toString('utf8')
    }
  }
}
