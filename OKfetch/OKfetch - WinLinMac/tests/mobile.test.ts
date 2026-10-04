// Unit tests of the Android pieces that run outside Android: bridge codec, key protector, QR payload, settings.
import { describe, expect, it } from 'vitest'
import { createDataKeyProtector } from '../src/mobile/keyProtector'
import { outgoingToDelete, outgoingToken } from '../src/mobile/outgoing'
import { LineSplitter, decodeLine, encodeLine } from '../src/mobile/rpc'
import { randomBytes } from '../src/core/sodium'
import { DEFAULT_RELAYS, defaultSettings, sanitizeSettings } from '../src/core/settings'
import { plainProtector } from '../src/core/state'
import { formatQr, parseQr } from '../src/shared/qr'

// 52 z-base-32 characters; the last one carries a single bit, so only 'y' or 'o' are canonical.
const ID = 'ybndrfg8ejkmcpqxot1uwisza345h769ybndrfg8ejkmcpqxot1o'

describe('bridge line codec', () => {
  it('round-trips calls with bytes, nested values and missing optional arguments', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255])
    const line = encodeLine({ t: 'call', id: 'w7', method: 'addContact', args: ['id', 'pw', undefined, { png: bytes }] })
    expect(line.includes('\n')).toBe(false)
    const back = decodeLine(line)
    expect(back).toMatchObject({ t: 'call', id: 'w7', method: 'addContact' })
    const args = (back as { args: unknown[] }).args
    expect(args[0]).toBe('id')
    expect(args[2]).toBeUndefined()
    expect(args).toHaveLength(4)
    const png = (args[3] as { png: Uint8Array }).png
    expect(png).toBeInstanceOf(Uint8Array)
    expect(Array.from(png)).toEqual([0, 1, 2, 250, 255])
  })

  it('sends a Buffer as bytes too (Buffer has its own toJSON)', () => {
    const back = decodeLine(encodeLine({ t: 'call', id: 'j1', method: 'init', args: [{ dataKey: Buffer.from([7, 8, 9]) }] }))
    const key = ((back as { args: { dataKey: Uint8Array }[] }).args[0]).dataKey
    expect(key).toBeInstanceOf(Uint8Array)
    expect(Array.from(key)).toEqual([7, 8, 9])
  })

  it('keeps text with new lines and non-latin characters on one line', () => {
    const line = encodeLine({ t: 'event', event: { type: 'incoming', title: 'Žluťoučký kůň', text: 'a\nb' } })
    expect(line.includes('\n')).toBe(false)
    expect(decodeLine(line)).toEqual({ t: 'event', event: { type: 'incoming', title: 'Žluťoučký kůň', text: 'a\nb' } })
  })

  it('rejects garbage and messages without a known type', () => {
    expect(decodeLine('not json')).toBeNull()
    expect(decodeLine('{"t":"nope"}')).toBeNull()
    expect(decodeLine('{"t":"call","id":5,"method":"x","args":[]}')).toBeNull()
    expect(decodeLine('[]')).toBeNull()
  })

  it('splits a stream into whole lines, whatever the chunk boundaries', () => {
    const split = new LineSplitter()
    expect(split.push('{"a":1}\n{"b"')).toEqual(['{"a":1}'])
    expect(split.push(':2}\n\n{"c":3}')).toEqual(['{"b":2}'])
    expect(split.push('\n')).toEqual(['{"c":3}'])
  })
})

describe('data-key protector (Android Keystore wraps the data key)', () => {
  it('protects and unprotects with the same data key', () => {
    const protector = createDataKeyProtector(randomBytes(32))
    const blob = protector.protect('secret-value')
    expect(blob.startsWith('dk:')).toBe(true)
    expect(blob.includes('secret-value')).toBe(false)
    expect(protector.unprotect(blob)).toBe('secret-value')
    expect(protector.backend).toBe('android_keystore')
    expect(protector.strong).toBe(true)
  })

  it('throws for a blob made with another data key', () => {
    const blob = createDataKeyProtector(randomBytes(32)).protect('secret-value')
    expect(() => createDataKeyProtector(randomBytes(32)).unprotect(blob)).toThrow('key_unavailable')
  })

  it('still reads plain blobs (restored backups)', () => {
    const protector = createDataKeyProtector(randomBytes(32))
    expect(protector.unprotect(plainProtector.protect('from-backup'))).toBe('from-backup')
  })

  it('refuses a data key of the wrong size', () => {
    expect(() => createDataKeyProtector(randomBytes(16))).toThrow()
  })
})

describe('QR payload', () => {
  it('formats the identifier and the user name as an okfetch link', () => {
    expect(formatQr(ID, 'Pepa Novák')).toBe(`okfetch:add?id=${ID}&name=Pepa%20Nov%C3%A1k`)
    expect(formatQr(ID, '')).toBe(`okfetch:add?id=${ID}`)
  })

  it('parses its own format, a bare identifier and the grouped form', () => {
    expect(parseQr(formatQr(ID, 'Pepa Novák'))).toEqual({ id: ID, name: 'Pepa Novák' })
    expect(parseQr(ID)).toEqual({ id: ID })
    expect(parseQr(ID.toUpperCase().replace(/(.{4})/g, '$1 '))).toEqual({ id: ID })
  })

  it('refuses other QR codes and broken identifiers', () => {
    expect(parseQr('https://example.com')).toBeNull()
    expect(parseQr(`okfetch:add?id=${ID.slice(1)}`)).toBeNull()
    expect(parseQr(`okfetch:add?id=${ID.slice(1)}l`)).toBeNull()
    expect(parseQr(`okfetch:add?id=${ID.slice(0, -1)}u`)).toBeNull()
    expect(parseQr('okfetch:add')).toBeNull()
    expect(parseQr('')).toBeNull()
  })

  it('limits the name taken from a QR code', () => {
    const parsed = parseQr(formatQr(ID, 'x'.repeat(500)))
    expect(parsed?.name?.length).toBe(64)
  })
})

describe('copies of outgoing files (outgoing/<token>/<name>)', () => {
  const now = 10_000_000
  const HOUR = 3600_000

  it('keeps copies of offers that wait or send, deletes finished ones at once and never-offered ones after an hour', () => {
    const dirs = [
      { token: 'waiting', mtimeMs: now - 5 * HOUR },
      { token: 'finished', mtimeMs: now },
      { token: 'shared-recently', mtimeMs: now - 10 * 60_000 },
      { token: 'shared-long-ago', mtimeMs: now - 2 * HOUR }
    ]
    const refs = new Map([
      ['waiting', true],
      ['finished', false]
    ])
    expect(outgoingToDelete(dirs, refs, now)).toEqual(['finished', 'shared-long-ago'])
  })

  it('finds the token in a source path on any system', () => {
    expect(outgoingToken('/data/user/0/cz.opikula.okfetch/files/okfetch/outgoing/k3j2/fotka.jpg')).toBe('k3j2')
    expect(outgoingToken('C:\\data\\okfetch\\outgoing\\t1\\a.txt')).toBe('t1')
    expect(outgoingToken('/home/pepa/outgoing.txt')).toBeNull()
    expect(outgoingToken('/home/pepa/a.txt')).toBeNull()
  })
})

describe('phone settings', () => {
  it('has safe defaults for the phone-only settings', () => {
    const d = defaultSettings()
    expect(d.app_lock).toBe(false)
    expect(d.lock_after).toBe(1)
    expect(d.background_service).toBe(true)
    expect(d.block_screenshots).toBe(true)
    expect(d.hide_notification_content).toBe(false)
  })

  it('keeps the relay settings valid: on by default, only ws/wss addresses, defaults when empty', () => {
    expect(defaultSettings()).toMatchObject({ relay_fallback: true, relay_only: false, relay_urls: DEFAULT_RELAYS })
    expect(sanitizeSettings({ relay_urls: ['wss://a.example', 'http://x.example', 'wss://a.example', 5, ' wss://b.example '] }).relay_urls).toEqual([
      'wss://a.example',
      'wss://b.example'
    ])
    expect(sanitizeSettings({ relay_urls: [] }).relay_urls).toEqual(DEFAULT_RELAYS)
    expect(sanitizeSettings({ relay_urls: 'wss://x' }).relay_urls).toEqual(DEFAULT_RELAYS)
    expect(sanitizeSettings({ relay_fallback: false }).relay_fallback).toBe(false)
    expect(DEFAULT_RELAYS.every((u) => u.startsWith('wss://'))).toBe(true)
  })

  it('accepts the system theme and only the offered lock times', () => {
    expect(sanitizeSettings({ theme: 'system' }).theme).toBe('system')
    expect(sanitizeSettings({ lock_after: 5 }).lock_after).toBe(5)
    expect(sanitizeSettings({ lock_after: 0 }).lock_after).toBe(0)
    expect(sanitizeSettings({ lock_after: 7 }).lock_after).toBe(1)
    expect(sanitizeSettings({ lock_after: 'x' }).lock_after).toBe(1)
    expect(sanitizeSettings({ app_lock: 1, background_service: false, block_screenshots: 0, hide_notification_content: 'yes' })).toMatchObject({
      app_lock: true,
      background_service: false,
      block_screenshots: false,
      hide_notification_content: true
    })
  })
})
