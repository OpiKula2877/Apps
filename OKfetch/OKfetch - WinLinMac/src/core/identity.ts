// Identity = Ed25519 key pair. The identifier is the z-base-32 public key, stable across IPs and networks.
import * as z32 from 'z32'
import { signKeyPair } from './sodium'

export interface Identity {
  publicKey: Buffer
  secretKey: Buffer
}

export const IDENTIFIER_LENGTH = 52

export function createIdentity(): Identity {
  return signKeyPair()
}

export const toIdentifier = (publicKey: Uint8Array): string => z32.encode(publicKey)

export function fromIdentifier(identifier: string): Buffer {
  return Buffer.from(z32.decode(identifier))
}

/** Parse what the user typed: spaces, dashes and case are ignored. Returns null when it is not a valid identifier. */
export function parseIdentifier(raw: string): string | null {
  const text = raw.replace(/[\s-]+/g, '').toLowerCase()
  if (text.length !== IDENTIFIER_LENGTH) return null
  try {
    const key = z32.decode(text)
    return key.length === 32 && z32.encode(key) === text ? text : null
  } catch {
    return null
  }
}

/** Groups of four characters for reading aloud and copying. */
export const formatIdentifier = (identifier: string): string => identifier.replace(/(.{4})(?=.)/g, '$1 ')

export const shortId = (identifier: string): string => `${identifier.slice(0, 4)}…${identifier.slice(-4)}`
