// Key derivation (Argon2id + HKDF-Expand), byte-compatible with the Python version.
import { argon2id } from 'hash-wasm'
import { normalizeKey } from '../shared/keys'
import { concat, utf8, view } from './bytes'

export { MAX_KEY_LENGTH, normalizeKey, validateKey, type KeyError } from '../shared/keys'

export interface KdfParams {
  memoryKib: number
  iterations: number
  lanes: number
}

export const DEFAULT_PARAMS: KdfParams = { memoryKib: 131072, iterations: 4, lanes: 4 }

export async function deriveMaster(raw: string, salt: Uint8Array, params: KdfParams): Promise<Uint8Array> {
  return argon2id({
    password: utf8(normalizeKey(raw)),
    salt,
    parallelism: params.lanes,
    iterations: params.iterations,
    memorySize: params.memoryKib,
    hashLength: 32,
    outputType: 'binary'
  })
}

const subtle = (): SubtleCrypto => globalThis.crypto.subtle

export async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await subtle().importKey('raw', view(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await subtle().sign('HMAC', k, view(data)))
}

/** HKDF-Expand (RFC 5869) for a single 32-byte block. */
const expand = (master: Uint8Array, info: string): Promise<Uint8Array> => hmacSha256(master, concat(utf8(info), Uint8Array.of(1)))

export interface SlotKeys {
  master: Uint8Array
  enc: CryptoKey
  lengthMask: CryptoKey
  fakeSeed: Uint8Array
}

export async function slotKeys(master: Uint8Array): Promise<SlotKeys> {
  const [enc, length, fakeSeed] = await Promise.all([
    expand(master, 'okpass/v1/slot-encryption'),
    expand(master, 'okpass/v1/slot-length'),
    expand(master, 'okpass/v1/decoy-generator')
  ])
  return {
    master,
    enc: await subtle().importKey('raw', view(enc), 'AES-GCM', false, ['encrypt', 'decrypt']),
    lengthMask: await subtle().importKey('raw', view(length), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
    fakeSeed
  }
}
