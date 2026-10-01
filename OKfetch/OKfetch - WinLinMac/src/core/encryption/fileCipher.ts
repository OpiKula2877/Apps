// File encryption in blocks. The per-file key is derived from the chat key; the nonce is the block counter,
// so every (key, nonce) pair is used exactly once.
import { NONCE_BYTES, TAG_BYTES, blake2b, openWithNonce, sealWithNonce } from '../sodium'

export const BLOCK_SIZE = 64 * 1024
export const BLOCK_OVERHEAD = TAG_BYTES

export function deriveFileKey(chatKey: Uint8Array, fileId: string): Buffer {
  return blake2b([Buffer.from('okfetch/v1/file/', 'utf8'), Buffer.from(fileId, 'utf8')], chatKey)
}

function blockNonce(index: number): Buffer {
  const nonce = Buffer.alloc(NONCE_BYTES)
  nonce.writeUInt32LE(index >>> 0, 0)
  nonce.writeUInt32LE(Math.floor(index / 0x100000000), 4)
  return nonce
}

export const encryptBlock = (fileKey: Uint8Array, index: number, block: Uint8Array): Buffer => sealWithNonce(fileKey, blockNonce(index), block)
export const decryptBlock = (fileKey: Uint8Array, index: number, cipher: Uint8Array): Buffer | null => openWithNonce(fileKey, blockNonce(index), cipher)
