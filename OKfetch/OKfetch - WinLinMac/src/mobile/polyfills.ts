// Web globals that Bare does not have but npm packages expect (noble uses them already while loading).
// Must be the first import of the worklet entry.
import sodium from 'sodium-universal'

const g = globalThis as Record<string, unknown>

if (typeof g.TextEncoder === 'undefined') {
  g.TextEncoder = class TextEncoder {
    readonly encoding = 'utf-8'
    encode(input = ''): Uint8Array {
      return new Uint8Array(Buffer.from(String(input), 'utf8'))
    }
  }
}

if (typeof g.TextDecoder === 'undefined') {
  g.TextDecoder = class TextDecoder {
    readonly encoding = 'utf-8'
    decode(input?: ArrayBufferView | ArrayBuffer): string {
      if (!input) return ''
      const view = ArrayBuffer.isView(input) ? Buffer.from(input.buffer, input.byteOffset, input.byteLength) : Buffer.from(input)
      return view.toString('utf8')
    }
  }
}

const cryptoGlobal = (g.crypto ?? {}) as { getRandomValues?: (array: ArrayBufferView) => ArrayBufferView }
if (typeof cryptoGlobal.getRandomValues !== 'function') {
  cryptoGlobal.getRandomValues = (array) => {
    sodium.randombytes_buf(Buffer.from(array.buffer, array.byteOffset, array.byteLength))
    return array
  }
  g.crypto = cryptoGlobal
}
