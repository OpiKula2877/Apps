// Verification code: both sides compute the same 6 × 5 digits from the two public keys and compare them aloud.
import { blake2b } from '../sodium'

export function fingerprint(a: Uint8Array, b: Uint8Array): string {
  const [first, second] = Buffer.compare(a, b) <= 0 ? [a, b] : [b, a]
  const digest = blake2b([Buffer.from('okfetch/v1/verify', 'utf8'), first, second], undefined, 24)
  const groups: string[] = []
  for (let i = 0; i < 6; i++) groups.push(String(digest.readUInt32BE(i * 4) % 100000).padStart(5, '0'))
  return groups.join(' ')
}
