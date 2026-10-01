// Binary vault file format (same as the Python and the first desktop version):
//
//   header = "OKPASS" | version u8 | memory_kib u32 | iterations u32 | lanes u8
//            | salt 16 B | slot_count u8 | slot_size u32          (big-endian)
//   slots  = slot_count * slot_size bytes
//
// Each slot is nonce (12) | masked length (4) | AES-256-GCM ciphertext+tag | random padding.
// The length is XOR-masked with a key-dependent value, so without the right key a
// slot is indistinguishable from random bytes.
import { unzlibSync, zlibSync } from 'fflate'
import { concat, randomBytes, readU32, utf8, view, writeU32 } from './bytes'
import { DEFAULT_PARAMS, type KdfParams, type SlotKeys } from './kdf'

export const MAGIC = utf8('OKPASS')
export const VERSION = 1
export const SLOT_COUNT = 2
export const BUCKET = 64 * 1024
const NONCE_LEN = 12
const LENGTH_LEN = 4
const TAG_LEN = 16
const SALT_LEN = 16
const FIXED_LEN = 6 + 1 + 4 + 4 + 1 + SALT_LEN + 1
export const HEADER_LEN = FIXED_LEN + 4

export class FormatError extends Error {
  name = 'FormatError'
}

export class VaultFile {
  constructor(
    readonly params: KdfParams,
    readonly salt: Uint8Array,
    readonly slots: Uint8Array[]
  ) {}

  get slotSize(): number {
    return this.slots[0].length
  }

  /** Immutable part of the header, authenticated by every slot. */
  get aad(): Uint8Array {
    const buf = new Uint8Array(FIXED_LEN)
    buf.set(MAGIC, 0)
    let o = MAGIC.length
    buf[o++] = VERSION
    writeU32(buf, o, this.params.memoryKib)
    o += 4
    writeU32(buf, o, this.params.iterations)
    o += 4
    buf[o++] = this.params.lanes
    buf.set(this.salt, o)
    o += SALT_LEN
    buf[o] = SLOT_COUNT
    return buf
  }

  toBytes(): Uint8Array {
    const size = new Uint8Array(4)
    writeU32(size, 0, this.slotSize)
    return concat(this.aad, size, ...this.slots)
  }

  static create(params: KdfParams = DEFAULT_PARAMS): VaultFile {
    return new VaultFile(params, randomBytes(SALT_LEN), Array.from({ length: SLOT_COUNT }, () => randomBytes(BUCKET)))
  }

  static parse(data: Uint8Array): VaultFile {
    if (data.length < HEADER_LEN || !MAGIC.every((b, i) => data[i] === b)) throw new FormatError('not an OKpass file')
    let o = MAGIC.length
    const version = data[o++]
    const memoryKib = readU32(data, o)
    o += 4
    const iterations = readU32(data, o)
    o += 4
    const lanes = data[o++]
    const salt = data.slice(o, o + SALT_LEN)
    o += SALT_LEN
    const count = data[o++]
    const slotSize = readU32(data, o)
    if (version !== VERSION || count !== SLOT_COUNT) throw new FormatError('unsupported OKpass file version')
    if (slotSize < NONCE_LEN + LENGTH_LEN + TAG_LEN || data.length !== HEADER_LEN + count * slotSize) {
      throw new FormatError('damaged OKpass file')
    }
    if (!(8 * lanes <= memoryKib && memoryKib <= 4 * 1024 * 1024 && iterations >= 1 && iterations <= 64 && lanes >= 1 && lanes <= 64)) {
      throw new FormatError('invalid key derivation parameters')
    }
    const slots = Array.from({ length: count }, (_, i) => data.slice(HEADER_LEN + i * slotSize, HEADER_LEN + (i + 1) * slotSize))
    return new VaultFile({ memoryKib, iterations, lanes }, salt, slots)
  }
}

async function lengthMask(keys: SlotKeys, nonce: Uint8Array): Promise<number> {
  const digest = new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', keys.lengthMask, view(nonce)))
  return readU32(digest, 0)
}

/** Encrypt plaintext into an unpadded slot body. */
export async function sealBody(keys: SlotKeys, aad: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array> {
  const nonce = randomBytes(NONCE_LEN)
  const ciphertext = new Uint8Array(
    await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv: view(nonce), additionalData: view(aad) }, keys.enc, view(zlibSync(plaintext, { level: 9 })))
  )
  const masked = new Uint8Array(LENGTH_LEN)
  writeU32(masked, 0, ciphertext.length ^ (await lengthMask(keys, nonce)))
  return concat(nonce, masked, ciphertext)
}

/** Return the plaintext stored in the slot, or null if the key does not fit. */
export async function openSlot(keys: SlotKeys, aad: Uint8Array, slot: Uint8Array): Promise<Uint8Array | null> {
  const nonce = slot.subarray(0, NONCE_LEN)
  const length = (readU32(slot, NONCE_LEN) ^ (await lengthMask(keys, nonce))) >>> 0
  const start = NONCE_LEN + LENGTH_LEN
  if (length < TAG_LEN || start + length > slot.length) return null
  try {
    const compressed = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: view(nonce), additionalData: view(aad) },
      keys.enc,
      view(slot.subarray(start, start + length))
    )
    return unzlibSync(new Uint8Array(compressed))
  } catch {
    return null
  }
}

export function roundUp(size: number): number {
  return Math.max(BUCKET, Math.ceil(size / BUCKET) * BUCKET)
}

/**
 * Return a new file with the given slots replaced. Slots not in `bodies` keep their
 * bytes and are only extended with random padding when the slot size has to grow.
 * The slot size may shrink only when every slot is rewritten.
 */
export function assemble(file: VaultFile, bodies: Map<number, Uint8Array>): VaultFile {
  const needed = roundUp(Math.max(...[...bodies.values()].map((b) => b.length)))
  const size = bodies.size === SLOT_COUNT ? needed : Math.max(file.slotSize, needed)
  const slots = file.slots.map((old, index) => {
    const base = bodies.get(index) ?? old
    return concat(base, randomBytes(size - base.length))
  })
  return new VaultFile(file.params, file.salt, slots)
}
