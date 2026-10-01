// 16-character contact/group key made of [0-9a-zA-Z].
import { randomInt } from '../sodium'

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
export const CONTACT_KEY_LENGTH = 16

export function generateContactKey(): string {
  let key = ''
  for (let i = 0; i < CONTACT_KEY_LENGTH; i++) key += ALPHABET[randomInt(ALPHABET.length)]
  return key
}

export const isContactKey = (key: unknown): key is string => typeof key === 'string' && /^[0-9a-zA-Z]{16}$/.test(key)
