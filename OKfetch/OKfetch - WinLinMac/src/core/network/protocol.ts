// Wire format on a peer connection: [u32 length][u8 type][payload]. Length covers type + payload.
// Control frames carry JSON; block frames carry raw (or encrypted) file bytes.

export const PROTOCOL_VERSION = 1
export const MAX_FRAME = 1024 * 1024
export const ID_BYTES = 16

export const FRAME_CTRL = 1
export const FRAME_BLOCK = 2

export interface Frame {
  type: number
  payload: Buffer
}

export function encodeFrame(type: number, payload: Uint8Array): Buffer {
  const head = Buffer.alloc(5)
  head.writeUInt32BE(payload.length + 1, 0)
  head.writeUInt8(type, 4)
  return Buffer.concat([head, payload])
}

export const encodeCtrl = (message: Ctrl): Buffer => encodeFrame(FRAME_CTRL, Buffer.from(JSON.stringify(message), 'utf8'))

/** Collects stream chunks and cuts them into frames. Throws on an oversized or empty frame (the caller closes the connection). */
export class FrameDecoder {
  private chunks: Buffer[] = []
  private size = 0

  push(chunk: Uint8Array): Frame[] {
    this.chunks.push(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength))
    this.size += chunk.length
    const frames: Frame[] = []
    for (;;) {
      if (this.size < 5) break
      const buffer = this.chunks.length === 1 ? this.chunks[0] : Buffer.concat(this.chunks)
      this.chunks = [buffer]
      const length = buffer.readUInt32BE(0)
      if (length < 1 || length > MAX_FRAME) throw new Error('bad frame length')
      if (buffer.length < 4 + length) break
      frames.push({ type: buffer.readUInt8(4), payload: Buffer.from(buffer.subarray(5, 4 + length)) })
      const rest = buffer.subarray(4 + length)
      this.chunks = rest.length ? [rest] : []
      this.size = rest.length
    }
    return frames
  }
}

export function parseCtrl(frame: Frame): Ctrl | null {
  if (frame.type !== FRAME_CTRL) return null
  try {
    const value: unknown = JSON.parse(frame.payload.toString('utf8'))
    return value && typeof value === 'object' && typeof (value as { t?: unknown }).t === 'string' ? (value as Ctrl) : null
  } catch {
    return null
  }
}

/** Block payload: [16-byte file id][u32 block index][data]. */
export function encodeBlock(fileId: string, index: number, data: Uint8Array): Buffer {
  const head = Buffer.alloc(ID_BYTES + 4)
  Buffer.from(fileId, 'hex').copy(head, 0)
  head.writeUInt32BE(index, ID_BYTES)
  return encodeFrame(FRAME_BLOCK, Buffer.concat([head, data]))
}

export function decodeBlock(payload: Buffer): { id: string; index: number; data: Buffer } | null {
  if (payload.length < ID_BYTES + 4) return null
  return { id: payload.subarray(0, ID_BYTES).toString('hex'), index: payload.readUInt32BE(ID_BYTES), data: payload.subarray(ID_BYTES + 4) }
}

export interface GroupMember {
  pub: string
  name: string
}

export interface GroupDoc {
  id: string
  name: string
  type: 'enc' | 'plain'
  members: GroupMember[]
  lamport: number
  by: string
}

/** Control messages. Frames with `rid` are reliable: the receiver answers `rack` and the sender keeps them until then. */
export type Ctrl =
  | { t: 'hello'; v: number; username: string; avatar: string | null }
  | { t: 'challenge'; nonce: string }
  | { t: 'challenge_get' }
  | { t: 'request'; username: string; proof: string; key: string }
  | { t: 'rack'; rid: string }
  | { t: 'request_result'; rid: string; accepted: boolean; reason?: string; retryMin?: number; username?: string; feedback?: string }
  | { t: 'msg'; rid: string; chat: string; ts: number; lamport: number; body: string; enc: boolean }
  | { t: 'read'; rid: string; chat: string; ids: string[] }
  | { t: 'del'; rid: string; chat: string; ids: string[] }
  | { t: 'typing'; chat: string }
  | { t: 'avatar_get'; hash: string }
  | { t: 'avatar'; hash: string; data: string }
  | { t: 'file_offer'; rid: string; chat: string; ts: number; lamport: number; meta: string; enc: boolean }
  | { t: 'file_accept'; rid: string; id: string }
  | { t: 'file_reject'; rid: string; id: string; feedback: string }
  | { t: 'file_cancel'; id: string }
  | { t: 'file_end'; id: string; blocks: number }
  | { t: 'file_done'; id: string; ok: boolean }
  | { t: 'group_invite'; rid: string; doc: GroupDoc; key: string | null }
  | { t: 'group_join'; rid: string; id: string }
  | { t: 'group_update'; rid: string; doc: GroupDoc }
  | { t: 'group_leave'; rid: string; id: string }

export type CtrlType = Ctrl['t']
export const RELIABLE: ReadonlySet<string> = new Set([
  'request_result', 'msg', 'read', 'del', 'file_offer', 'file_accept', 'file_reject', 'group_invite', 'group_join', 'group_update', 'group_leave'
])
