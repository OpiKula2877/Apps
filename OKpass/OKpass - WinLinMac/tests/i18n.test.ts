import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { STRINGS } from '../src/renderer/src/i18n/strings'
import { COLOR_ROLES, FLAG_NAMES } from '../src/shared/theme'

const SRC = join(__dirname, '..', 'src')

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(ts|tsx)$/.test(name) && !name.startsWith('strings') ? [path] : []
  })
}

function literalKeys(): Set<string> {
  const keys = new Set<string>()
  // UI texts live in the renderer; the controller sends message keys.
  for (const file of [...sources(join(SRC, 'renderer')), join(SRC, 'core', 'controller.ts')]) {
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(/\bt\(\s*'([a-z_]+\.[a-z_.]+)'/g)) keys.add(m[1])
    for (const m of text.matchAll(/\bkey:\s*'([a-z_]+\.[a-z_.]+)'/g)) keys.add(m[1])
    for (const m of text.matchAll(/'((?:tabs|settings\.tab|entry\.field|editor|login|status|backups|decoy|settings|text|key)\.[a-z_.]+)'/g)) {
      if (!m[1].endsWith('.')) keys.add(m[1])
    }
  }
  return keys
}

const dynamicKeys = [
  ...COLOR_ROLES.map((r) => `color.${r}`),
  ...FLAG_NAMES.map((f) => `flag.${f}`),
  ...['light', 'dark', 'opikula', 'custom'].map((th) => `theme.${th}`),
  ...['saved', 'dirty', 'saving', 'pending', 'error'].map((s) => `status.${s}`),
  ...[0, 1, 2, 3, 4].map((n) => `strength.${n}`),
  ...['empty', 'too_long', 'bad_chars'].map((c) => `key.error.${c}`),
  ...['title', 'username', 'password', 'custom'].map((k) => `entry.placeholder.${k}`),
  'decoy.error.same_as_main',
  'login.secret_invalid',
  'login.secret_wrong_type'
]

describe('translations', () => {
  it('cover every key the code uses', () => {
    const missing = [...literalKeys(), ...dynamicKeys].filter((k) => !(k in STRINGS)).sort()
    expect(missing).toEqual([])
  })

  it('have Czech and English for every key', () => {
    const incomplete = Object.entries(STRINGS)
      .filter(([, v]) => !v.cs || !v.en)
      .map(([k]) => k)
    expect(incomplete).toEqual([])
  })
})
