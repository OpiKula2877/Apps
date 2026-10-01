// Random identifiers (32 hex characters = 16 random bytes).
import { randomBytes } from './sodium'

export const newId = (): string => randomBytes(16).toString('hex')
