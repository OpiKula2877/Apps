import { argon2id as wasmArgon2id } from 'hash-wasm'
import { describe, expect, it } from 'vitest'
import { decryptText, deriveChatKey, encryptText, messageAd } from '../src/core/encryption/aead'
import { generateContactKey, isContactKey } from '../src/core/encryption/contactKey'
import { BLOCK_SIZE, decryptBlock, deriveFileKey, encryptBlock } from '../src/core/encryption/fileCipher'
import { fingerprint } from '../src/core/encryption/fingerprint'
import { deriveK, makeProof, unwrapContactKey, verifyProof, wrapContactKey } from '../src/core/encryption/passwordProof'
import { createIdentity, formatIdentifier, fromIdentifier, parseIdentifier, toIdentifier } from '../src/core/identity'
import { argon2id, randomBytes, randomInt } from '../src/core/sodium'

const FAST = { memoryKib: 1024, iterations: 1, lanes: 1 }

describe('identity', () => {
  it('round-trips the identifier and ignores spaces, dashes and case', () => {
    const { publicKey } = createIdentity()
    const id = toIdentifier(publicKey)
    expect(id).toHaveLength(52)
    expect(fromIdentifier(id).equals(publicKey)).toBe(true)
    expect(parseIdentifier(formatIdentifier(id).toUpperCase().replace(/ /g, '-'))).toBe(id)
  })

  it('rejects invalid identifiers', () => {
    expect(parseIdentifier('abc')).toBeNull()
    expect(parseIdentifier('0'.repeat(52))).toBeNull()
  })
})

describe('contact key', () => {
  it('has 16 characters from [0-9a-zA-Z] and differs each time', () => {
    const a = generateContactKey()
    expect(isContactKey(a)).toBe(true)
    expect(generateContactKey()).not.toBe(a)
  })
})

describe('message encryption', () => {
  const a = createIdentity().publicKey
  const b = createIdentity().publicKey

  it('decrypts with the same key and context', () => {
    const key = deriveChatKey('abcdefghijklmnop', 'contact', [a, b])
    const sealed = encryptText(key, '<p>ahoj</p>', messageAd('enc', 'm1'))
    expect(decryptText(key, sealed, messageAd('enc', 'm1'))).toBe('<p>ahoj</p>')
  })

  it('derives the same key whatever the order of the public keys', () => {
    expect(deriveChatKey('abcdefghijklmnop', 'contact', [a, b]).equals(deriveChatKey('abcdefghijklmnop', 'contact', [b, a]))).toBe(true)
  })

  it('fails with a wrong key, a wrong context or tampered data', () => {
    const key = deriveChatKey('abcdefghijklmnop', 'contact', [a, b])
    const sealed = encryptText(key, 'secret', messageAd('enc', 'm1'))
    expect(decryptText(deriveChatKey('ZZZZZZZZZZZZZZZZ', 'contact', [a, b]), sealed, messageAd('enc', 'm1'))).toBeNull()
    expect(decryptText(key, sealed, messageAd('enc', 'm2'))).toBeNull()
    const raw = Buffer.from(sealed, 'base64')
    raw[raw.length - 1] ^= 1
    expect(decryptText(key, raw.toString('base64'), messageAd('enc', 'm1'))).toBeNull()
  })
})

describe('file cipher', () => {
  it('round-trips blocks and rejects a wrong index or key', () => {
    const chatKey = deriveChatKey('abcdefghijklmnop', 'contact')
    const fileKey = deriveFileKey(chatKey, 'file-1')
    const block = randomBytes(BLOCK_SIZE)
    const cipher = encryptBlock(fileKey, 7, block)
    expect(cipher.length).toBe(BLOCK_SIZE + 16)
    expect(decryptBlock(fileKey, 7, cipher)?.equals(block)).toBe(true)
    expect(decryptBlock(fileKey, 8, cipher)).toBeNull()
    expect(decryptBlock(deriveFileKey(chatKey, 'file-2'), 7, cipher)).toBeNull()
  })
})

describe('verification code', () => {
  it('is identical for both sides, has 6 groups of 5 digits and differs for another pair', () => {
    const a = createIdentity().publicKey
    const b = createIdentity().publicKey
    const c = createIdentity().publicKey
    expect(fingerprint(a, b)).toBe(fingerprint(b, a))
    expect(fingerprint(a, b)).toMatch(/^(\d{5} ){5}\d{5}$/)
    expect(fingerprint(a, b)).not.toBe(fingerprint(a, c))
  })
})

describe('password proof', () => {
  const requester = createIdentity().publicKey
  const receiver = createIdentity().publicKey
  const nonce = randomBytes(16)

  it('accepts the right password and rejects a wrong one', async () => {
    const k = await deriveK('s3cret!', receiver, FAST)
    const proof = makeProof(await deriveK('s3cret!', receiver, FAST), nonce, requester, receiver)
    expect(verifyProof(k, nonce, requester, receiver, proof)).toBe(true)
    const wrong = makeProof(await deriveK('s3creT!', receiver, FAST), nonce, requester, receiver)
    expect(verifyProof(k, nonce, requester, receiver, wrong)).toBe(false)
  })

  it('binds the proof to nonce and both public keys', async () => {
    const k = await deriveK('pw', receiver, FAST)
    const proof = makeProof(k, nonce, requester, receiver)
    expect(verifyProof(k, randomBytes(16), requester, receiver, proof)).toBe(false)
    expect(verifyProof(k, nonce, createIdentity().publicKey, receiver, proof)).toBe(false)
  })

  it('salts with the receiver public key and ignores whitespace in the password', async () => {
    const other = createIdentity().publicKey
    expect((await deriveK('pw', receiver, FAST)).equals(await deriveK('pw', other, FAST))).toBe(false)
    expect((await deriveK('p w', receiver, FAST)).equals(await deriveK('pw', receiver, FAST))).toBe(true)
  })

  it('wraps the contact key so only a holder of K can read it', async () => {
    const k = await deriveK('pw', receiver, FAST)
    const key = generateContactKey()
    const wrapped = wrapContactKey(k, nonce, key)
    expect(unwrapContactKey(k, nonce, wrapped)).toBe(key)
    expect(unwrapContactKey(await deriveK('other', receiver, FAST), nonce, wrapped)).toBeNull()
  })
})

describe('portable primitives', () => {
  it('Argon2id from libsodium equals a standard implementation (phone and PC derive the same key)', async () => {
    const salt = randomBytes(16)
    for (const [memoryKib, iterations] of [[1024, 1], [8192, 2]]) {
      const standard = Buffer.from(await wasmArgon2id({ password: 'Tajne-Heslo-1', salt, parallelism: 1, iterations, memorySize: memoryKib, hashLength: 32, outputType: 'binary' }))
      expect(argon2id(Buffer.from('Tajne-Heslo-1'), salt, iterations, memoryKib).equals(standard)).toBe(true)
    }
  })

  it('randomInt stays in range and covers it', () => {
    const seen = new Set<number>()
    for (let i = 0; i < 2000; i++) {
      const n = randomInt(62)
      expect(n).toBeGreaterThanOrEqual(0)
      expect(n).toBeLessThan(62)
      seen.add(n)
    }
    expect(seen.size).toBe(62)
  })
})
