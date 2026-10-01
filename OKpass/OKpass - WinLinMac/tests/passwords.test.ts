import { describe, expect, it } from 'vitest'
import { SYMBOLS, generatePassword, strength } from '../src/shared/passwords'

const all = { length: 12, lower: true, upper: true, digits: true, symbols: true, avoidAmbiguous: false }

describe('password generator', () => {
  it('uses every selected group', () => {
    for (let i = 0; i < 50; i++) {
      const pw = generatePassword(all)
      expect(pw).toHaveLength(12)
      expect(pw).toMatch(/[a-z]/)
      expect(pw).toMatch(/[A-Z]/)
      expect(pw).toMatch(/[0-9]/)
      expect([...pw].some((c) => SYMBOLS.includes(c))).toBe(true)
    }
  })

  it('can produce digits only without look-alikes', () => {
    const pw = generatePassword({ ...all, length: 30, lower: false, upper: false, symbols: false, avoidAmbiguous: true })
    expect(pw).toMatch(/^[2-9]+$/)
  })

  it('rates strength', () => {
    expect(strength('')).toBe(0)
    expect(strength('abc')).toBe(1)
    expect(strength('Kx9!p2-Lm#qR7_zT')).toBe(4)
  })
})
