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
    return /\.(ts|tsx)$/.test(name) && !name.startsWith('strings') && name !== 'helpContent.ts' ? [path] : []
  })
}

/** Keys written literally: t('a.b') and the key lists passed around as strings. */
function literalKeys(): Set<string> {
  const keys = new Set<string>()
  for (const file of sources(join(SRC, 'renderer'))) {
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(/\bt\(\s*'([a-z_]+\.[a-z_.]+)'/g)) keys.add(m[1])
    for (const m of text.matchAll(/'((?:settings\.tab|tabs|chat|file|contact|group|list|request|requests|add|verify|storage|header|toast|reject|editor|lock|backup|phone|qr|share|keys|diag|relay)\.[a-z_.]+)'/g)) {
      if (!m[1].endsWith('.')) keys.add(m[1])
    }
  }
  return keys
}

/** Keys built at run time (template strings), listed with every value the code can produce. */
const dynamicKeys = [
  ...COLOR_ROLES.map((r) => `color.${r}`),
  ...FLAG_NAMES.map((f) => `flag.${f}`),
  ...['light', 'dark', 'opikula', 'custom', 'system'].map((th) => `theme.${th}`),
  ...['none', 'unavailable'].map((a) => `lock.${a}`),
  ...['connected', 'peer_not_found', 'holepunch_double_randomized_nats', 'timeout'].map((c) => `diag.probe.${c}`),
  ...['wrong_password', 'damaged', 'short', 'mismatch', 'key_unavailable', 'io'].map((e) => `backup.error.${e}`),
  ...['connecting', 'online', 'offline'].map((n) => `net.${n}`),
  ...['fetch', 'settings'].map((n) => `tabs.${n}`),
  ...['empty', 'too_long_offline', 'no_chat', 'not_connected', 'no_file'].map((r) => `chat.send_error.${r}`),
  ...['bad_identifier', 'self', 'exists', 'bad_password', 'blocked', 'pending'].map((r) => `add.error.${r}`),
  ...['empty', 'too_long', 'bad_chars'].map((r) => `password.error.${r}`),
  ...['bad_password', 'rate_limited', 'no_password', 'declined'].map((r) => `request.result.${r}`),
  ...['not_writable', 'not_empty', 'copy_failed', 'unknown'].map((r) => `storage.error.${r}`)
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

  it('use the same {parameters} in both languages', () => {
    const params = (text: string): string => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
    const different = Object.entries(STRINGS)
      .filter(([, v]) => params(v.cs) !== params(v.en))
      .map(([k]) => k)
    expect(different).toEqual([])
  })
})
