import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FRAME_BLOCK, FRAME_CTRL, FrameDecoder, MAX_FRAME, decodeBlock, encodeBlock, encodeCtrl, encodeFrame, parseCtrl } from '../src/core/network/protocol'
import type { StoredMessage } from '../src/core/records'
import { GLOBAL_MAX_FAILURES, MAX_ATTEMPTS, RateLimiter, WINDOW_MS } from '../src/core/security/rateLimit'
import { ChatLog } from '../src/core/storage/chatLog'
import { chatDirName, safeFileName } from '../src/core/storage/paths'
import { OFFLINE_CHAR_LIMIT, isEmptyMessage, plainText, preview, textLength } from '../src/shared/text'

describe('frame decoder', () => {
  it('cuts a stream into frames however it is chunked', () => {
    const a = encodeCtrl({ t: 'typing', chat: 'enc' })
    const b = encodeBlock('00112233445566778899aabbccddeeff', 3, Buffer.from('hello'))
    const stream = Buffer.concat([a, b, a])
    for (const size of [1, 2, 3, 7, 1000]) {
      const decoder = new FrameDecoder()
      const frames = []
      for (let i = 0; i < stream.length; i += size) frames.push(...decoder.push(stream.subarray(i, i + size)))
      expect(frames.map((f) => f.type)).toEqual([FRAME_CTRL, FRAME_BLOCK, FRAME_CTRL])
      expect(parseCtrl(frames[0])).toEqual({ t: 'typing', chat: 'enc' })
      expect(decodeBlock(frames[1].payload)).toEqual({ id: '00112233445566778899aabbccddeeff', index: 3, data: Buffer.from('hello') })
    }
  })

  it('rejects an oversized frame', () => {
    const head = Buffer.alloc(5)
    head.writeUInt32BE(MAX_FRAME + 1, 0)
    expect(() => new FrameDecoder().push(head)).toThrow()
  })

  it('returns null for garbage control payloads', () => {
    expect(parseCtrl({ type: FRAME_CTRL, payload: Buffer.from('not json') })).toBeNull()
    expect(parseCtrl({ type: FRAME_CTRL, payload: Buffer.from('{"x":1}') })).toBeNull()
    expect(parseCtrl({ type: FRAME_BLOCK, payload: Buffer.from('{"t":"x"}') })).toBeNull()
    expect(encodeFrame(9, Buffer.alloc(0)).length).toBe(5)
  })
})

describe('rate limiter', () => {
  it('blocks a key after 5 wrong passwords for 15 minutes', () => {
    let now = 1_000_000
    const limiter = new RateLimiter(() => now)
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) expect(limiter.fail('a').allowed).toBe(true)
    const verdict = limiter.fail('a')
    expect(verdict.allowed).toBe(false)
    expect(verdict.retryAfterMs).toBe(WINDOW_MS)
    expect(limiter.check('b').allowed).toBe(true)
    now += WINDOW_MS + 1
    expect(limiter.check('a').allowed).toBe(true)
  })

  it('forgets earlier failures after a success', () => {
    const limiter = new RateLimiter(() => 1)
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) limiter.fail('a')
    limiter.success('a')
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) expect(limiter.fail('a').allowed).toBe(true)
  })

  it('applies a global ceiling across many keys', () => {
    const limiter = new RateLimiter(() => 1)
    for (let i = 0; i < GLOBAL_MAX_FAILURES; i++) limiter.fail(`key-${i}`)
    expect(limiter.check('fresh-key').allowed).toBe(false)
  })
})

describe('chat log', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'okfetch-log-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const message = (id: string, lamport: number): StoredMessage => ({
    id, chatId: 'x:enc', from: 'me', ts: lamport, lamport, body: `body-${id}`, enc: false, kind: 'text', waiting: ['peer'], read: false
  })

  it('replays adds, updates and deletions after a restart', () => {
    const path = join(dir, 'chat', 'messages.jsonl')
    const log = new ChatLog(path)
    log.add(message('a', 1))
    log.add(message('b', 2))
    log.add(message('c', 3))
    log.update('a', { waiting: [], read: true })
    log.remove('b')
    const again = new ChatLog(path)
    expect(again.sorted().map((m) => m.id)).toEqual(['a', 'c'])
    expect(again.messages.get('a')).toMatchObject({ waiting: [], read: true })
    expect(again.has('b')).toBe(true)
    expect(again.add(message('b', 2))).toBe(false)
  })

  it('orders by lamport clock and ignores a torn last line', () => {
    const path = join(dir, 'messages.jsonl')
    const log = new ChatLog(path)
    log.add(message('late', 9))
    log.add(message('early', 1))
    expect(log.sorted().map((m) => m.id)).toEqual(['early', 'late'])
    appendFileSync(path, '{"op":"m","id":"torn')
    expect(new ChatLog(path).sorted()).toHaveLength(2)
  })

  it('compacts the file when most records are updates', () => {
    const path = join(dir, 'messages.jsonl')
    const log = new ChatLog(path)
    log.add(message('a', 1))
    for (let i = 0; i < 400; i++) log.update('a', { read: i % 2 === 0 })
    const lines = readFileSync(path, 'utf8').trim().split('\n')
    expect(lines.length).toBeLessThan(250)
    expect(new ChatLog(path).messages.get('a')).toMatchObject({ read: false })
  })

  it('keeps file state patches', () => {
    const path = join(dir, 'messages.jsonl')
    const log = new ChatLog(path)
    log.add({ ...message('f', 1), kind: 'file', file: { state: 'offered', direction: 'in' } })
    log.update('f', { file: { state: 'done', rel: 'chat/f_name.png' } })
    expect(new ChatLog(path).messages.get('f')?.file).toEqual({ state: 'done', direction: 'in', rel: 'chat/f_name.png' })
  })
})

describe('paths and text helpers', () => {
  it('makes chat ids and file names safe for any file system', () => {
    expect(chatDirName('abc:enc')).toBe('abc_enc')
    expect(chatDirName('g:0123')).toBe('g_0123')
    expect(safeFileName('../../etc/passwd')).not.toContain('/')
    expect(safeFileName('a<b>:c.txt')).toBe('a_b__c.txt')
    expect(safeFileName('')).toBe('file')
  })

  it('counts characters of the text, not of the markup', () => {
    expect(plainText('<p>Ahoj <strong>světe</strong></p><p>&lt;b&gt; &amp; x</p>')).toBe('Ahoj světe\n<b> & x')
    expect(textLength('<p>' + 'a'.repeat(OFFLINE_CHAR_LIMIT) + '</p>')).toBe(OFFLINE_CHAR_LIMIT)
    expect(isEmptyMessage('<p></p><p> </p>')).toBe(true)
    expect(preview('<p>' + 'x'.repeat(300) + '</p>', 20)).toHaveLength(20)
  })
})
