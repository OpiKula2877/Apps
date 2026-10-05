// Every text the app asks for exists in Czech and English.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { STRINGS } from '../src/renderer/src/i18n/strings'
import { ALBUM_ICONS, FRAME_COLORS } from '../src/shared/model'
import { COLOR_ROLES, FLAG_NAMES } from '../src/shared/theme'

function files(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name)
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

const source = files(join(__dirname, '..', 'src'))
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n')

describe('translations', () => {
  it('has both languages for every key', () => {
    for (const [key, value] of Object.entries(STRINGS)) {
      expect(value.cs, key).toBeTruthy()
      expect(value.en, key).toBeTruthy()
      const params = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
      expect(params(value.en), key).toEqual(params(value.cs))
    }
  })

  it('knows every literal key used in the code', () => {
    const used = new Set<string>()
    for (const match of source.matchAll(/\bt\(\s*'([a-z_]+\.[a-z0-9_.]+)'/g)) used.add(match[1])
    for (const match of source.matchAll(/\bkey: '([a-z_]+\.[a-z0-9_.]+)'/g)) used.add(match[1])
    const missing = [...used].filter((key) => !STRINGS[key])
    expect(missing).toEqual([])
  })

  it('knows the keys built from lists', () => {
    const keys = [
      ...FRAME_COLORS.map((c) => `color.${c}`),
      ...ALBUM_ICONS.map((i) => `icon.${i}`),
      ...COLOR_ROLES.map((r) => `role.${r}`),
      ...FLAG_NAMES.map((f) => `flag.${f}`),
      ...['light', 'dark', 'opikula', 'custom'].map((t) => `theme.${t}`),
      ...['album', 'date', 'name', 'format', 'size'].map((s) => `sort.${s}`),
      ...['saved', 'saving', 'pending', 'error'].map((s) => `status.${s}`),
      ...['queued', 'active', 'done', 'error', 'cancelled'].map((s) => `transfers.${s}`),
      ...['account', 'appearance', 'viewing', 'storage', 'data'].map((s) => `settings.tab.${s}`),
      ...['favorites', 'photos', 'videos', 'recent'].flatMap((s) => [`smart.${s}`, `smart.${s}_info`, `smart.${s}_empty`]),
      ...['invalid', 'exists', 'failed'].map((s) => `rename.${s}`),
      ...['invalid', 'wrong_type'].map((s) => `login.secret_${s}`),
      'tabs.media',
      'tabs.albums'
    ]
    expect(keys.filter((key) => !STRINGS[key])).toEqual([])
  })
})
