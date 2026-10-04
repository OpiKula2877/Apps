// Backup of the storage folder into one password-encrypted file (.okfb) and restore from it.
// File: header (magic, salt, Argon2id params, nonce prefix), then XChaCha20-Poly1305 chunks of a simple archive.
// The last chunk is marked, so a cut file is detected. Secrets (*Blob fields) travel re-wrapped by the backup
// password instead of the device key, and are protected again by the device that restores them.
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DEFAULT_KDF, type KdfParams } from './encryption/passwordProof'
import { argon2id, blake2b, openWithNonce, randomBytes, sealWithNonce } from './sodium'
import { plainProtector, type KeyProtector } from './state'

export type RestoreResult = { ok: true } | { ok: false; error: 'wrong_password' | 'damaged' }

export interface BackupOptions {
  /** Include received files (files/), which can be large. */
  withFiles: boolean
  kdf?: KdfParams
}

export interface ArchiveEntry {
  name: string
  data?: Uint8Array
  /** Read the content from this file instead of `data`. */
  source?: string
}

const MAGIC = Buffer.from('OKFB', 'latin1')
const VERSION = 1
const HEADER_BYTES = 4 + 1 + 16 + 4 + 4 + 16
const CHUNK = 64 * 1024
const MAX_CIPHER_CHUNK = CHUNK + 16
const KIND_FILE = 1
const KIND_END = 0

// --- secrets inside the JSON state files -------------------------------------

function mapBlobs(value: unknown, map: (blob: string) => string): unknown {
  if (Array.isArray(value)) return value.map((item) => mapBlobs(item, map))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, key.endsWith('Blob') && typeof item === 'string' ? map(item) : mapBlobs(item, map)])
    )
  }
  return value
}

const isStateJson = (name: string): boolean => !name.includes('/') && name.endsWith('.json')

// --- encrypted chunk stream -------------------------------------------------------

function chunkKey(password: string, header: Buffer, salt: Uint8Array, kdf: KdfParams): Buffer {
  const k = argon2id(Buffer.from(password.normalize('NFC'), 'utf8'), salt, kdf.iterations, kdf.memoryKib)
  return blake2b([Buffer.from('okfetch/v1/backup', 'utf8'), header], k)
}

function chunkNonce(prefix: Uint8Array, index: number, final: boolean): Buffer {
  const nonce = Buffer.alloc(24)
  Buffer.from(prefix).copy(nonce, 0)
  nonce.writeUInt32BE(index, 16)
  nonce.writeUInt32BE(final ? 1 : 0, 20)
  return nonce
}

class ChunkWriter {
  private buffered: Buffer[] = []
  private size = 0
  private index = 0

  constructor(
    private fd: number,
    private key: Buffer,
    private prefix: Buffer
  ) {}

  write(data: Uint8Array): void {
    this.buffered.push(Buffer.from(data))
    this.size += data.length
    while (this.size > CHUNK) {
      const all = Buffer.concat(this.buffered)
      this.emit(all.subarray(0, CHUNK), false)
      this.buffered = [all.subarray(CHUNK)]
      this.size = all.length - CHUNK
    }
  }

  finish(): void {
    this.emit(Buffer.concat(this.buffered), true)
    this.buffered = []
    this.size = 0
  }

  private emit(plain: Buffer, final: boolean): void {
    const cipher = sealWithNonce(this.key, chunkNonce(this.prefix, this.index++, final), plain)
    const length = Buffer.alloc(4)
    length.writeUInt32BE(cipher.length, 0)
    writeSync(this.fd, length)
    writeSync(this.fd, cipher)
  }
}

class DamagedError extends Error {}
class WrongPasswordError extends Error {}

class ChunkReader {
  private current: Buffer = Buffer.alloc(0)
  private offset = 0
  private index = 0
  private ended = false

  constructor(
    private fd: number,
    private key: Buffer,
    private prefix: Buffer,
    private position: number
  ) {}

  private readRaw(length: number): Buffer {
    const out = Buffer.alloc(length)
    let got = 0
    while (got < length) {
      const n = readSync(this.fd, out, got, length - got, this.position)
      if (n <= 0) break
      got += n
      this.position += n
    }
    return out.subarray(0, got)
  }

  private nextChunk(): void {
    if (this.ended) throw new DamagedError('read past the end')
    const head = this.readRaw(4)
    if (head.length < 4) throw new DamagedError('missing final chunk')
    const length = head.readUInt32BE(0)
    if (length < 16 || length > MAX_CIPHER_CHUNK) throw new DamagedError('bad chunk length')
    const cipher = this.readRaw(length)
    if (cipher.length < length) throw new DamagedError('cut chunk')
    let plain = openWithNonce(this.key, chunkNonce(this.prefix, this.index, false), cipher)
    if (!plain) {
      plain = openWithNonce(this.key, chunkNonce(this.prefix, this.index, true), cipher)
      if (!plain) throw this.index === 0 ? new WrongPasswordError() : new DamagedError('bad chunk')
      this.ended = true
      if (this.readRaw(1).length > 0) throw new DamagedError('data after the final chunk')
    }
    this.index++
    this.current = plain
    this.offset = 0
  }

  read(length: number): Buffer {
    const parts: Buffer[] = []
    let missing = length
    while (missing > 0) {
      if (this.offset >= this.current.length) this.nextChunk()
      const take = Math.min(missing, this.current.length - this.offset)
      parts.push(this.current.subarray(this.offset, this.offset + take))
      this.offset += take
      missing -= take
    }
    return Buffer.concat(parts)
  }

  /** True when the whole stream (up to the final chunk) was consumed. */
  atEnd(): boolean {
    return this.ended && this.offset >= this.current.length
  }
}

// --- archive --------------------------------------------------------------------

function entryHeader(name: string, size: number): Buffer {
  const nameBytes = Buffer.from(name, 'utf8')
  const head = Buffer.alloc(1 + 2 + nameBytes.length + 8)
  head.writeUInt8(KIND_FILE, 0)
  head.writeUInt16BE(nameBytes.length, 1)
  nameBytes.copy(head, 3)
  head.writeUInt32BE(Math.floor(size / 0x100000000), 3 + nameBytes.length)
  head.writeUInt32BE(size >>> 0, 7 + nameBytes.length)
  return head
}

/** Write entries as an encrypted backup file (the building block of writeBackup; also used by tests). */
export function writeArchive(target: string, password: string, kdf: KdfParams, entries: Iterable<ArchiveEntry>): void {
  const salt = randomBytes(16)
  const prefix = randomBytes(16)
  const header = Buffer.alloc(HEADER_BYTES)
  MAGIC.copy(header, 0)
  header.writeUInt8(VERSION, 4)
  salt.copy(header, 5)
  header.writeUInt32BE(kdf.memoryKib, 21)
  header.writeUInt32BE(kdf.iterations, 25)
  prefix.copy(header, 29)
  const key = chunkKey(password, header, salt, kdf)
  mkdirSync(dirname(target), { recursive: true })
  const fd = openSync(target, 'w')
  try {
    writeSync(fd, header)
    const out = new ChunkWriter(fd, key, prefix)
    for (const entry of entries) {
      if (entry.source) {
        const size = statSync(entry.source).size
        out.write(entryHeader(entry.name, size))
        const input = openSync(entry.source, 'r')
        try {
          const buffer = Buffer.alloc(CHUNK)
          let position = 0
          while (position < size) {
            const n = readSync(input, buffer, 0, Math.min(CHUNK, size - position), position)
            if (n <= 0) throw new Error(`file changed while reading: ${entry.name}`)
            out.write(buffer.subarray(0, n))
            position += n
          }
        } finally {
          closeSync(input)
        }
      } else {
        const data = entry.data ?? new Uint8Array(0)
        out.write(entryHeader(entry.name, data.length))
        out.write(data)
      }
    }
    out.write(Buffer.from([KIND_END]))
    out.finish()
  } finally {
    closeSync(fd)
  }
}

function* walk(dir: string, prefix: string): Generator<{ name: string; path: string }> {
  for (const item of readdirSync(dir).sort()) {
    const path = join(dir, String(item))
    const name = prefix ? `${prefix}/${item}` : String(item)
    if (statSync(path).isDirectory()) yield* walk(path, name)
    else yield { name, path }
  }
}

const skipped = (name: string, withFiles: boolean): boolean =>
  name.startsWith('outgoing/') || (!withFiles && name.startsWith('files/')) || /\.(tmp|part)$/.test(name) || name.includes('.write-test-')

/** Back up the storage folder. Throws 'key_unavailable' when the secrets cannot be opened on this device. */
export function writeBackup(root: string, protector: KeyProtector, password: string, target: string, options: BackupOptions): void {
  const toPlain = (blob: string): string => plainProtector.protect(protector.unprotect(blob))
  const entries = function* (): Generator<ArchiveEntry> {
    for (const file of walk(root, '')) {
      if (skipped(file.name, options.withFiles)) continue
      if (isStateJson(file.name)) {
        const value = mapBlobs(JSON.parse(readFileSync(file.path, 'utf8')), toPlain)
        yield { name: file.name, data: Buffer.from(JSON.stringify(value, null, 2), 'utf8') }
      } else {
        yield { name: file.name, source: file.path }
      }
    }
  }
  writeArchive(target, password, options.kdf ?? DEFAULT_KDF, entries())
}

/** Relative path inside the storage folder, or null for anything that could escape it. */
function safeEntryName(name: string): string[] | null {
  if (!name || name.includes('\\') || name.includes('\0') || name.startsWith('/') || /^[A-Za-z]:/.test(name)) return null
  const parts = name.split('/')
  return parts.every((part) => part && part !== '.' && part !== '..') ? parts : null
}

function extract(source: string, password: string, target: string): void {
  const fd = openSync(source, 'r')
  try {
    const header = Buffer.alloc(HEADER_BYTES)
    if (readSync(fd, header, 0, HEADER_BYTES, 0) < HEADER_BYTES) throw new DamagedError('short file')
    if (!header.subarray(0, 4).equals(MAGIC) || header.readUInt8(4) !== VERSION) throw new DamagedError('not a backup')
    const salt = header.subarray(5, 21)
    const kdf: KdfParams = { memoryKib: header.readUInt32BE(21), iterations: header.readUInt32BE(25), lanes: 1 }
    if (kdf.memoryKib < 8 || kdf.memoryKib > 1024 * 1024 || kdf.iterations < 1 || kdf.iterations > 16) throw new DamagedError('bad parameters')
    const prefix = Buffer.from(header.subarray(29, 45))
    const input = new ChunkReader(fd, chunkKey(password, header, salt, kdf), prefix, HEADER_BYTES)
    for (;;) {
      const kind = input.read(1).readUInt8(0)
      if (kind === KIND_END) break
      if (kind !== KIND_FILE) throw new DamagedError('bad entry')
      const nameLength = input.read(2).readUInt16BE(0)
      const parts = safeEntryName(input.read(nameLength).toString('utf8'))
      if (!parts) throw new DamagedError('bad entry name')
      const sizeBytes = input.read(8)
      let left = sizeBytes.readUInt32BE(0) * 0x100000000 + sizeBytes.readUInt32BE(4)
      const path = join(target, ...parts)
      mkdirSync(dirname(path), { recursive: true })
      const out = openSync(path, 'w')
      try {
        while (left > 0) {
          const piece = input.read(Math.min(CHUNK, left))
          writeSync(out, piece)
          left -= piece.length
        }
      } finally {
        closeSync(out)
      }
    }
    if (!input.atEnd()) throw new DamagedError('data after the end marker')
  } finally {
    closeSync(fd)
  }
}

/**
 * Restore a backup into `root`, replacing what is there. It unpacks into a temporary folder first,
 * so a wrong password or a damaged file leaves the current data untouched. The core must be closed.
 */
export function restoreBackup(source: string, password: string, root: string, protector: KeyProtector): RestoreResult {
  const temp = `${root}.restore`
  rmSync(temp, { recursive: true, force: true })
  try {
    mkdirSync(temp, { recursive: true })
    extract(source, password, temp)
    if (!existsSync(join(temp, 'identity.json'))) throw new DamagedError('no identity')
    for (const name of readdirSync(temp).map(String)) {
      if (!isStateJson(name)) continue
      const path = join(temp, name)
      const value = mapBlobs(JSON.parse(readFileSync(path, 'utf8')), (blob) => protector.protect(plainProtector.unprotect(blob)))
      writeFileSync(path, JSON.stringify(value, null, 2), 'utf8')
    }
  } catch (error) {
    rmSync(temp, { recursive: true, force: true })
    if (error instanceof WrongPasswordError) return { ok: false, error: 'wrong_password' }
    return { ok: false, error: 'damaged' }
  }
  const old = `${root}.old`
  rmSync(old, { recursive: true, force: true })
  if (existsSync(root)) renameSync(root, old)
  renameSync(temp, root)
  rmSync(old, { recursive: true, force: true })
  return { ok: true }
}
