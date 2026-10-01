// Password generator and a simple strength estimate (same rules as the Python version).

export const SYMBOLS = '!?*.-_#%+=@$&/;:'
const AMBIGUOUS = new Set([...'Il1O0o|`\'"'])
const LOWER = 'abcdefghijklmnopqrstuvwxyz'
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const DIGITS = '0123456789'

export interface GeneratorOptions {
  length: number
  lower: boolean
  upper: boolean
  digits: boolean
  symbols: boolean
  avoidAmbiguous: boolean
}

/** Uniform random integer in [0, max) without modulo bias. */
function randomBelow(max: number): number {
  const limit = Math.floor(0x100000000 / max) * max
  const buf = new Uint32Array(1)
  do globalThis.crypto.getRandomValues(buf)
  while (buf[0] >= limit)
  return buf[0] % max
}

const pick = (chars: string): string => chars[randomBelow(chars.length)]

export function generatePassword(options: GeneratorOptions): string {
  let groups = [options.lower && LOWER, options.upper && UPPER, options.digits && DIGITS, options.symbols && SYMBOLS].filter(Boolean) as string[]
  if (!groups.length) groups = [LOWER]
  if (options.avoidAmbiguous) groups = groups.map((g) => [...g].filter((c) => !AMBIGUOUS.has(c)).join(''))
  const length = Math.max(options.length, groups.length)
  const alphabet = groups.join('')
  // One character from every selected group, the rest from the whole alphabet.
  const chars = [...groups.map(pick), ...Array.from({ length: length - groups.length }, () => pick(alphabet))]
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomBelow(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

/** 0 (none) to 4 (very strong) from an entropy estimate. */
export function strength(password: string): 0 | 1 | 2 | 3 | 4 {
  if (!password) return 0
  const chars = [...password]
  let pool = 0
  if (chars.some((c) => c >= 'a' && c <= 'z')) pool += 26
  if (chars.some((c) => c >= 'A' && c <= 'Z')) pool += 26
  if (chars.some((c) => c >= '0' && c <= '9')) pool += 10
  if (chars.some((c) => !/[a-zA-Z0-9]/.test(c))) pool += 33
  const uniqueRatio = new Set(chars).size / chars.length
  const bits = chars.length * Math.log2(Math.max(pool, 2)) * Math.min(1, 0.5 + uniqueRatio)
  if (bits < 28) return 1
  if (bits < 50) return 2
  if (bits < 75) return 3
  return 4
}
