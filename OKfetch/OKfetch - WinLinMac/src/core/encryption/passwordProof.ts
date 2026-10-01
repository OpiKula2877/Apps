// Receive-password proof. K = Argon2id(password, salt derived from the receiver's public key).
// The requester proves it knows K without sending it, and wraps the new contact key with a key derived from K.
import { normalizePassword } from '../../shared/keys'
import { argon2id, blake2b, equalBytes, open, seal } from '../sodium'

export interface KdfParams {
  memoryKib: number
  iterations: number
  lanes: number
}

export const DEFAULT_KDF: KdfParams = { memoryKib: 65536, iterations: 3, lanes: 1 }

export async function deriveK(password: string, receiverPub: Uint8Array, params: KdfParams = DEFAULT_KDF): Promise<Buffer> {
  const salt = blake2b([Buffer.from('okfetch/v1/salt', 'utf8'), receiverPub], undefined, 16)
  // libsodium has no lane setting (always 1), the same value the defaults use.
  return argon2id(Buffer.from(normalizePassword(password), 'utf8'), salt, params.iterations, params.memoryKib)
}

const proofInput = (nonce: Uint8Array, requesterPub: Uint8Array, receiverPub: Uint8Array): Uint8Array[] => [
  Buffer.from('okfetch/v1/proof', 'utf8'),
  nonce,
  requesterPub,
  receiverPub
]

export const makeProof = (k: Uint8Array, nonce: Uint8Array, requesterPub: Uint8Array, receiverPub: Uint8Array): Buffer =>
  blake2b(proofInput(nonce, requesterPub, receiverPub), k)

export function verifyProof(k: Uint8Array, nonce: Uint8Array, requesterPub: Uint8Array, receiverPub: Uint8Array, proof: Uint8Array): boolean {
  return equalBytes(makeProof(k, nonce, requesterPub, receiverPub), proof)
}

const wrapKey = (k: Uint8Array, nonce: Uint8Array): Buffer => blake2b([Buffer.from('okfetch/v1/wrap', 'utf8'), nonce], k)

/** Wrap the 16-character contact key so only someone who knows K can read it. */
export const wrapContactKey = (k: Uint8Array, nonce: Uint8Array, contactKey: string): string =>
  seal(wrapKey(k, nonce), Buffer.from(contactKey, 'utf8')).toString('base64')

export function unwrapContactKey(k: Uint8Array, nonce: Uint8Array, wrapped: string): string | null {
  const plain = open(wrapKey(k, nonce), Buffer.from(wrapped, 'base64'))
  return plain ? plain.toString('utf8') : null
}
