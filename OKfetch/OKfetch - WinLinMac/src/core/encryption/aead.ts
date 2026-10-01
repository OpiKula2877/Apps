// Message encryption: XChaCha20-Poly1305 with a key derived from the 16-character key, a context and the member keys.
import { blake2b, open, seal } from '../sodium'

/** Chat key = BLAKE2b(context ‖ sorted public keys), keyed with the 16-character key. */
export function deriveChatKey(key16: string, context: string, publicKeys: Uint8Array[] = []): Buffer {
  const sorted = [...publicKeys].sort((a, b) => Buffer.compare(a, b))
  return blake2b([Buffer.from(`okfetch/v1/${context}`, 'utf8'), ...sorted], Buffer.from(key16, 'utf8'))
}

export const messageAd = (chat: string, id: string): string => `okfetch/msg/${chat}/${id}`

export function encryptText(key: Uint8Array, text: string, ad: string): string {
  return seal(key, Buffer.from(text, 'utf8'), ad).toString('base64')
}

/** Returns null for a wrong key or tampered data. */
export function decryptText(key: Uint8Array, data: string, ad: string): string | null {
  const plain = open(key, Buffer.from(data, 'base64'), ad)
  return plain ? plain.toString('utf8') : null
}
