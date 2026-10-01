// Key rules shared by the main process (derivation) and the renderer (input checks).

export const MAX_KEY_LENGTH = 32

export type KeyError = 'empty' | 'too_long' | 'bad_chars'

/** Spaces (and any other whitespace) do not count as part of the key. */
export function normalizeKey(raw: string): string {
  return raw.replace(/\s+/gu, '')
}

export function keyLength(raw: string): number {
  return [...normalizeKey(raw)].length
}

export function validateKey(raw: string): KeyError | null {
  const key = [...normalizeKey(raw)]
  if (key.length === 0) return 'empty'
  if (key.length > MAX_KEY_LENGTH) return 'too_long'
  // Printable ASCII without space: 0-9, a-z, A-Z and all special characters.
  if (key.some((ch) => ch.codePointAt(0)! < 33 || ch.codePointAt(0)! > 126)) return 'bad_chars'
  return null
}
