// Thin typed layer over libsodium (sodium-native): the only file that touches the raw API.
import sodium from 'sodium-universal'

export const KEY_BYTES = 32
export const NONCE_BYTES = 24
export const TAG_BYTES = 16

export const toBuf = (data: Uint8Array | string): Buffer => (typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data.buffer, data.byteOffset, data.byteLength))

export function randomBytes(length: number): Buffer {
  const out = Buffer.alloc(length)
  sodium.randombytes_buf(out)
  return out
}

/** BLAKE2b. With a key the result is a MAC (key must be 16–64 bytes). */
export function blake2b(input: Uint8Array | Uint8Array[], key?: Uint8Array, length = 32): Buffer {
  const out = Buffer.alloc(length)
  const data = Array.isArray(input) ? Buffer.concat(input.map(toBuf)) : toBuf(input)
  sodium.crypto_generichash(out, data, key ? toBuf(key) : undefined)
  return out
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && sodium.sodium_memcmp(toBuf(a), toBuf(b))
}

export function signKeyPair(): { publicKey: Buffer; secretKey: Buffer } {
  const publicKey = Buffer.alloc(sodium.crypto_sign_PUBLICKEYBYTES)
  const secretKey = Buffer.alloc(sodium.crypto_sign_SECRETKEYBYTES)
  sodium.crypto_sign_keypair(publicKey, secretKey)
  return { publicKey, secretKey }
}

/** XChaCha20-Poly1305 with a random nonce; output = nonce ‖ ciphertext ‖ tag. */
export function seal(key: Uint8Array, plain: Uint8Array, ad: Uint8Array | string = ''): Buffer {
  const nonce = randomBytes(NONCE_BYTES)
  const cipher = Buffer.alloc(plain.length + TAG_BYTES)
  sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(cipher, toBuf(plain), toBuf(ad), null, nonce, toBuf(key))
  return Buffer.concat([nonce, cipher])
}

/** Returns null for a wrong key, wrong context or tampered data. */
export function open(key: Uint8Array, sealed: Uint8Array, ad: Uint8Array | string = ''): Buffer | null {
  if (sealed.length < NONCE_BYTES + TAG_BYTES) return null
  const data = toBuf(sealed)
  const nonce = data.subarray(0, NONCE_BYTES)
  const cipher = data.subarray(NONCE_BYTES)
  const plain = Buffer.alloc(cipher.length - TAG_BYTES)
  try {
    sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(plain, null, cipher, toBuf(ad), nonce, toBuf(key))
    return plain
  } catch {
    return null
  }
}

/** Same cipher with a caller-chosen nonce (file blocks use the block counter). The caller guarantees uniqueness. */
export function sealWithNonce(key: Uint8Array, nonce: Uint8Array, plain: Uint8Array): Buffer {
  const cipher = Buffer.alloc(plain.length + TAG_BYTES)
  sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(cipher, toBuf(plain), null, null, toBuf(nonce), toBuf(key))
  return cipher
}

export function openWithNonce(key: Uint8Array, nonce: Uint8Array, cipher: Uint8Array): Buffer | null {
  if (cipher.length < TAG_BYTES) return null
  const plain = Buffer.alloc(cipher.length - TAG_BYTES)
  try {
    sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(plain, null, toBuf(cipher), null, toBuf(nonce), toBuf(key))
    return plain
  } catch {
    return null
  }
}

/** Incremental BLAKE2b-256 (for files that do not fit in memory). */
export function hashStream(): { update(data: Uint8Array): void; digest(): Buffer } {
  const state = Buffer.alloc(sodium.crypto_generichash_STATEBYTES)
  sodium.crypto_generichash_init(state, undefined, KEY_BYTES)
  return {
    update: (data) => sodium.crypto_generichash_update(state, toBuf(data)),
    digest() {
      const out = Buffer.alloc(KEY_BYTES)
      sodium.crypto_generichash_final(state, out)
      return out
    }
  }
}

/** Argon2id (libsodium, version 1.3, one lane): same output as any other standard Argon2id with these parameters. */
export function argon2id(password: Uint8Array, salt: Uint8Array, iterations: number, memoryKib: number, length = 32): Buffer {
  const out = Buffer.alloc(length)
  sodium.crypto_pwhash(out, toBuf(password), toBuf(salt), iterations, memoryKib * 1024, sodium.crypto_pwhash_ALG_ARGON2ID13)
  return out
}

/** Uniform random integer in [0, max) without modulo bias. */
export function randomInt(max: number): number {
  const limit = 0x100000000 - (0x100000000 % max)
  for (;;) {
    const value = randomBytes(4).readUInt32BE(0)
    if (value < limit) return value % max
  }
}
