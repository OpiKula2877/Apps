// Line protocol of the Android app: one JSON object per line between the WebView, the Java host and the worklet.
// Ids say who asked: 'w…' the WebView, 'j…' the Java host, 'h…' the worklet (asking the host). Uses no Buffer,
// so the same file runs in the WebView, in Bare and in Node.

export type RpcMessage =
  | { t: 'call'; id: string; method: string; args: unknown[] }
  | { t: 'reply'; id: string; ok: true; result: unknown }
  | { t: 'reply'; id: string; ok: false; error: string }
  | { t: 'event'; event: unknown }
  | { t: 'host'; id: string; method: string; args: unknown[] }

const CHUNK = 0x8000

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(binary)
}

export function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

// Bytes travel as {$bytes}, a missing value inside an array as {$u} (JSON would turn it into null).
// The original value is read from the holder because JSON calls Buffer#toJSON before the replacer.
function replacer(this: unknown, key: string, value: unknown): unknown {
  const original = (this as Record<string, unknown>)[key]
  if (original instanceof Uint8Array) return { $bytes: bytesToBase64(original) }
  if (value === undefined && Array.isArray(this)) return { $u: 1 }
  return value
}

function reviver(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    if (typeof record.$bytes === 'string' && Object.keys(record).length === 1) return base64ToBytes(record.$bytes)
    if (record.$u === 1 && Object.keys(record).length === 1) return undefined
  }
  return value
}

/** One line of text (JSON escapes every new line inside strings). */
export const encodeLine = (message: RpcMessage): string => JSON.stringify(message, replacer)

export function decodeLine(line: string): RpcMessage | null {
  let value: unknown
  try {
    value = JSON.parse(line, reviver)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const m = value as Record<string, unknown>
  switch (m.t) {
    case 'call':
    case 'host':
      return typeof m.id === 'string' && typeof m.method === 'string' && Array.isArray(m.args) ? (m as RpcMessage) : null
    case 'reply':
      if (typeof m.id !== 'string' || typeof m.ok !== 'boolean') return null
      return m.ok ? (m as RpcMessage) : { t: 'reply', id: m.id, ok: false, error: String(m.error ?? 'error') }
    case 'event':
      return 'event' in m ? (m as RpcMessage) : null
    default:
      return null
  }
}

/** Cuts a stream of text into whole lines; empty lines are skipped. */
export class LineSplitter {
  private rest = ''

  push(chunk: string): string[] {
    const parts = (this.rest + chunk).split('\n')
    this.rest = parts.pop() ?? ''
    return parts.filter((line) => line.length > 0)
  }
}
