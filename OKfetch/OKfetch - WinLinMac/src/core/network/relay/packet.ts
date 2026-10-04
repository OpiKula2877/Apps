// Packets of the relay fallback: from ‖ nonce ‖ XChaCha20-Poly1305(payload). The key comes from static
// Diffie-Hellman of the two identities, so only the two peers can read a packet and it proves who sent it.
// Relays see only the recipient's mailbox tag (a hash of its public key) and opaque bytes.
import type { Identity } from '../../identity'
import { NONCE_BYTES, TAG_BYTES, blake2b, open, seal, sharedSecret } from '../../sodium'

const KEY_CONTEXT = Buffer.from('okfetch/v1/relay', 'utf8')
const MAILBOX_CONTEXT = Buffer.from('okfetch/v1/mailbox', 'utf8')
const PUB_BYTES = 32

export const mailboxTag = (publicKey: Uint8Array): string => blake2b([MAILBOX_CONTEXT, publicKey]).toString('hex')

const keyCache = new Map<string, Buffer>()

function linkKey(me: Identity, theirPublicKey: Uint8Array): Buffer | null {
  const cacheKey = `${me.publicKey.toString('hex')}/${Buffer.from(theirPublicKey).toString('hex')}`
  const cached = keyCache.get(cacheKey)
  if (cached) return cached
  const shared = sharedSecret(me.secretKey, theirPublicKey)
  if (!shared) return null
  const sorted = [me.publicKey, Buffer.from(theirPublicKey)].sort(Buffer.compare)
  const key = blake2b([KEY_CONTEXT, ...sorted], shared)
  if (keyCache.size > 512) keyCache.clear()
  keyCache.set(cacheKey, key)
  return key
}

/** Additional data binds the packet to sender and recipient. */
const ad = (from: Uint8Array, to: Uint8Array): Buffer => Buffer.concat([KEY_CONTEXT, from, to])

export function sealPacket(me: Identity, to: Uint8Array, payload: Uint8Array): string {
  const key = linkKey(me, to)
  if (!key) throw new Error('bad recipient key')
  return Buffer.concat([me.publicKey, seal(key, payload, ad(me.publicKey, to))]).toString('base64')
}

export function openPacket(me: Identity, content: string): { from: Buffer; payload: Buffer } | null {
  let raw: Buffer
  try {
    raw = Buffer.from(content, 'base64')
  } catch {
    return null
  }
  if (raw.length < PUB_BYTES + NONCE_BYTES + TAG_BYTES) return null
  const from = Buffer.from(raw.subarray(0, PUB_BYTES))
  const key = linkKey(me, from)
  if (!key) return null
  const payload = open(key, raw.subarray(PUB_BYTES), ad(from, me.publicKey))
  return payload ? { from, payload } : null
}
