// Receive-password rules (same character rules as the OKpass key), shared by main and renderer.

export const MAX_PASSWORD_LENGTH = 32

export type PasswordError = 'empty' | 'too_long' | 'bad_chars'

/** Spaces (and any other whitespace) do not count as part of the password. */
export function normalizePassword(raw: string): string {
  return raw.replace(/\s+/gu, '')
}

export function passwordLength(raw: string): number {
  return [...normalizePassword(raw)].length
}

export function validatePassword(raw: string): PasswordError | null {
  const text = [...normalizePassword(raw)]
  if (text.length === 0) return 'empty'
  if (text.length > MAX_PASSWORD_LENGTH) return 'too_long'
  // Printable ASCII without space: 0-9, a-z, A-Z and all special characters.
  if (text.some((ch) => ch.codePointAt(0)! < 33 || ch.codePointAt(0)! > 126)) return 'bad_chars'
  return null
}
