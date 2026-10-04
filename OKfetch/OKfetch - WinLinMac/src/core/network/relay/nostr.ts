// Nostr events (NIP-01) for the relay fallback: id = SHA-256 of the serialized event, BIP-340 Schnorr signature.
// The key is random per start, so events of different sessions cannot be linked to each other by the relays.
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { randomBytes } from '../../sodium'

/** Ephemeral range (20000–29999): relays forward these to subscribers and do not store them. */
export const RELAY_KIND = 21430

export interface NostrEvent {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig: string
}

/** Randomness comes from libsodium: Bare has no crypto.getRandomValues, which noble would use by default. */
export function newNostrKey(): Uint8Array {
  for (;;) {
    const key = new Uint8Array(randomBytes(32))
    try {
      schnorr.getPublicKey(key)
      return key
    } catch {
      // not a valid scalar (chance about 2^-128): draw again
    }
  }
}

export function signEvent(secretKey: Uint8Array, kind: number, tags: string[][], content: string, createdAt = Math.floor(Date.now() / 1000)): NostrEvent {
  const pubkey = bytesToHex(schnorr.getPublicKey(secretKey))
  const id = bytesToHex(sha256(Buffer.from(JSON.stringify([0, pubkey, createdAt, kind, tags, content]), 'utf8')))
  const sig = bytesToHex(schnorr.sign(hexToBytes(id), secretKey, new Uint8Array(randomBytes(32))))
  return { id, pubkey, created_at: createdAt, kind, tags, content, sig }
}
