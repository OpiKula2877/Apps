// Integration tests: several cores talk through a local HyperDHT testnet.
import createTestnet from 'hyperdht/testnet'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Core } from '../src/core/controller'
import { MAX_ATTEMPTS } from '../src/core/security/rateLimit'
import { contactChatId, groupChatId } from '../src/shared/model'

type Testnet = Awaited<ReturnType<typeof createTestnet>>

const FAST = { memoryKib: 1024, iterations: 1, lanes: 1 }

async function until(check: () => boolean, ms = 20000): Promise<void> {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error(`timeout: ${check.toString()}`)
    await new Promise((r) => setTimeout(r, 30))
  }
}

describe('core', () => {
  let net: Testnet
  const dirs: string[] = []
  const cores: Core[] = []

  beforeAll(async () => {
    net = await createTestnet(3)
  })
  afterAll(async () => {
    await Promise.all(cores.map((c) => c.close()))
    await net.destroy()
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  })

  const dir = (): string => {
    const d = mkdtempSync(join(tmpdir(), 'okfetch-core-'))
    dirs.push(d)
    return d
  }

  async function node(root = dir()): Promise<Core> {
    const core = await Core.open({ root, bootstrap: net.bootstrap, kdf: FAST, retryMs: 400, strangerTimeoutMs: 5000 })
    cores.push(core)
    return core
  }

  async function befriend(a: Core, b: Core): Promise<void> {
    if (!b.state.profile.kBlob) await b.contacts.setPassword('pass-of-b')
    expect(await a.contacts.add(b.me, 'pass-of-b', 'Bee')).toEqual({ ok: true })
    await until(() => b.contacts.incoming().some((r) => r.pub === a.me))
    expect(b.contacts.accept(a.me, 'Aye')).toBe(true)
    await until(() => a.contacts.list().some((c) => c.pub === b.me) && b.net.isOnline(a.me) && a.net.isOnline(b.me))
  }

  it('rejects a wrong password, then blocks the requester after 5 attempts', async () => {
    const a = await node()
    const b = await node()
    await b.contacts.setPassword('right-password')
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await a.contacts.add(b.me, 'wrong-password')
      await until(() => a.contacts.outgoing().some((r) => r.pub === b.me && r.state === 'rejected' && r.reason !== undefined))
      const reason = a.contacts.outgoing()[0].reason
      expect(reason).toBe(i < MAX_ATTEMPTS - 1 ? 'bad_password' : 'rate_limited')
      if (i < MAX_ATTEMPTS - 1) a.contacts.cancelOutgoing(b.me)
    }
    expect(a.contacts.outgoing()[0].retryMin).toBeGreaterThan(0)
    expect(b.contacts.incoming()).toHaveLength(0)
    // Even the right password is refused during the block.
    a.contacts.cancelOutgoing(b.me)
    await a.contacts.add(b.me, 'right-password')
    await until(() => a.contacts.outgoing().some((r) => r.state === 'rejected' && r.reason === 'rate_limited'))
    expect(b.contacts.incoming()).toHaveLength(0)
  })

  it('adds a contact with the right password and creates both chats', async () => {
    const a = await node()
    const b = await node()
    await befriend(a, b)
    expect(a.contacts.list()[0]).toMatchObject({ pub: b.me, name: 'Bee', online: true })
    expect(b.contacts.list()[0]).toMatchObject({ pub: a.me, name: 'Aye', online: true })
    expect(a.messages.recipients(contactChatId(b.me, 'enc'))).toEqual([b.me])
    expect(a.messages.recipients(contactChatId(b.me, 'plain'))).toEqual([b.me])
    expect(a.contacts.fingerprint(b.me)).toBe(b.contacts.fingerprint(a.me))
    expect(a.state.outgoing).toHaveLength(0)
  })

  it('delivers messages, stores encrypted chats as ciphertext and plain chats as text, tracks delivered and read', async () => {
    const a = await node()
    const b = await node()
    await befriend(a, b)
    const enc = contactChatId(b.me, 'enc')
    const plain = contactChatId(b.me, 'plain')
    const sentEnc = a.messages.send(enc, '<p>tajna zprava</p>')
    const sentPlain = a.messages.send(plain, '<p>verejna zprava</p>')
    expect(sentEnc.ok && sentPlain.ok).toBe(true)
    await until(() => b.messages.list(contactChatId(a.me, 'enc')).length === 1 && b.messages.list(contactChatId(a.me, 'plain')).length === 1)
    expect(b.messages.list(contactChatId(a.me, 'enc'))[0]).toMatchObject({ html: '<p>tajna zprava</p>', unread: true, mine: false })
    await until(() => a.messages.list(enc)[0].status === 'delivered')

    const logs = (core: Core, chat: string): string => readFileSync(join(core.state.root, 'chats', chat.replace(/[^A-Za-z0-9_-]/g, '_'), 'messages.jsonl'), 'utf8')
    expect(logs(a, enc)).not.toContain('tajna zprava')
    expect(logs(b, contactChatId(a.me, 'enc'))).not.toContain('tajna zprava')
    expect(logs(a, plain)).toContain('verejna zprava')

    expect(b.unread(contactChatId(a.me, 'enc'))).toBe(1)
    b.messages.markRead(contactChatId(a.me, 'enc'))
    expect(b.unread(contactChatId(a.me, 'enc'))).toBe(0)
    await until(() => a.messages.list(enc)[0].status === 'read')
    expect(a.messages.list(plain)[0].status).toBe('delivered')
  })

  it('queues a message for an offline contact and delivers it after the contact starts again', async () => {
    const a = await node()
    const rootB = dir()
    const b = await node(rootB)
    await befriend(a, b)
    const bPub = b.me
    await b.close()
    await until(() => !a.net.isOnline(bPub))
    const chat = contactChatId(bPub, 'enc')
    expect(a.messages.send(chat, '<p>cekej na me</p>').ok).toBe(true)
    expect(a.messages.list(chat)[0].status).toBe('pending')
    expect(a.messages.send(chat, `<p>${'x'.repeat(5001)}</p>`)).toEqual({ ok: false, reason: 'too_long_offline' })

    const b2 = await node(rootB)
    expect(b2.me).toBe(bPub)
    await until(() => b2.messages.list(contactChatId(a.me, 'enc')).length === 1)
    expect(b2.messages.list(contactChatId(a.me, 'enc'))[0].html).toBe('<p>cekej na me</p>')
    await until(() => a.messages.list(chat)[0].status === 'delivered')
  })

  it('deletes for me, and for both only own messages; a pending message is cancelled', async () => {
    const a = await node()
    const b = await node()
    await befriend(a, b)
    const chatA = contactChatId(b.me, 'plain')
    const chatB = contactChatId(a.me, 'plain')
    const m1 = a.messages.send(chatA, '<p>jedna</p>')
    const m2 = a.messages.send(chatA, '<p>dva</p>')
    await until(() => b.messages.list(chatB).length === 2)
    const theirs = b.messages.send(chatB, '<p>od b</p>')
    await until(() => a.messages.list(chatA).length === 3)
    if (!m1.ok || !m2.ok || !theirs.ok) throw new Error('send failed')

    expect(a.messages.deleteMessages(chatA, [theirs.id], 'both')).toEqual({ deleted: 0, skipped: 1 })
    expect(a.messages.deleteMessages(chatA, [m1.id], 'both')).toEqual({ deleted: 1, skipped: 0 })
    await until(() => b.messages.list(chatB).length === 2)
    expect(b.messages.list(chatB).map((m) => m.id).sort()).toEqual([m2.id, theirs.id].sort())
    // Deleting for me leaves the other side untouched.
    expect(a.messages.deleteMessages(chatA, [theirs.id], 'me')).toEqual({ deleted: 1, skipped: 0 })
    expect(a.messages.list(chatA).map((m) => m.id)).toEqual([m2.id])
    expect(b.messages.list(chatB)).toHaveLength(2)
  })

  async function transfer(kind: 'enc' | 'plain'): Promise<void> {
    const a = await node()
    const b = await node()
    await befriend(a, b)
    const source = join(dir(), 'obrazek.gif')
    const content = Buffer.alloc(300_000)
    for (let i = 0; i < content.length; i++) content[i] = (i * 31) % 251
    writeFileSync(source, content)
    const chatA = contactChatId(b.me, kind)
    const chatB = contactChatId(a.me, kind)
    const sent = await a.transfers.sendFile(chatA, source)
    if (!sent.ok) throw new Error('offer failed')
    await until(() => b.messages.list(chatB).some((m) => m.file?.state === 'offered'))
    expect(b.messages.list(chatB)[0].file).toMatchObject({ name: 'obrazek.gif', size: 300_000, direction: 'in' })
    expect(b.transfers.accept(chatB, sent.id)).toBe(true)
    await until(() => b.messages.list(chatB)[0].file?.state === 'done')
    await until(() => a.messages.list(chatA)[0].file?.state === 'done')
    const received = readFileSync(b.transfers.filePath(chatB, sent.id)!)
    expect(received.equals(content)).toBe(true)
    expect(readdirSync(join(b.state.root, 'files')).length).toBeGreaterThan(0)
  }

  it('transfers a file in an encrypted chat and checks the hash', () => transfer('enc'))
  it('transfers a file in a plain chat and checks the hash', () => transfer('plain'))

  it('lets the receiver reject a file with an explanation', async () => {
    const a = await node()
    const b = await node()
    await befriend(a, b)
    const source = join(dir(), 'a.txt')
    writeFileSync(source, 'hello')
    const chatA = contactChatId(b.me, 'plain')
    const chatB = contactChatId(a.me, 'plain')
    const sent = await a.transfers.sendFile(chatA, source)
    if (!sent.ok) throw new Error('offer failed')
    await until(() => b.messages.list(chatB).some((m) => m.file?.state === 'offered'))
    expect(b.transfers.reject(chatB, sent.id, 'Posli to jinak, prosim')).toBe(true)
    await until(() => a.messages.list(chatA)[0].file?.state === 'rejected')
    expect(a.messages.list(chatA)[0].file?.feedback).toBe('Posli to jinak, prosim')
  })

  it('runs a group of three: invitation, messages, rename by a non-founder, leave', async () => {
    const a = await node()
    const b = await node()
    const c = await node()
    await befriend(a, b)
    await befriend(a, c)
    const id = a.groups.create('Parta', 'enc', [b.me, c.me])
    expect(id).toBeTruthy()
    await until(() => b.groups.list().some((g) => g.id === id && g.state === 'invited') && c.groups.list().some((g) => g.id === id))
    expect(b.groups.accept(id!)).toBe(true)
    expect(c.groups.accept(id!)).toBe(true)

    const chat = groupChatId(id!)
    await until(() => b.net.isOnline(c.me) && c.net.isOnline(b.me))
    const sent = a.messages.send(chat, '<p>ahoj skupino</p>')
    expect(sent.ok).toBe(true)
    await until(() => b.messages.list(chat).length === 1 && c.messages.list(chat).length === 1)
    expect(c.messages.list(chat)[0]).toMatchObject({ html: '<p>ahoj skupino</p>', fromName: expect.any(String) })
    await until(() => a.messages.list(chat)[0].status === 'delivered')

    expect(b.groups.update(id!, { name: 'Nova parta' })).toBe(true)
    await until(() => a.groups.list()[0].name === 'Nova parta' && c.groups.list()[0].name === 'Nova parta')

    // A message from a member who is not a contact of the receiver still arrives (the roster authorises it).
    const fromC = c.messages.send(chat, '<p>od c</p>')
    expect(fromC.ok).toBe(true)
    await until(() => b.messages.list(chat).length === 2 && a.messages.list(chat).length === 2)

    expect(c.groups.leave(id!)).toBe(true)
    await until(() => a.groups.list()[0].members.length === 2 && b.groups.list()[0].members.length === 2)
    expect(c.groups.list()).toHaveLength(0)
  })

  it('blocks a contact: no connection, no messages', async () => {
    const a = await node()
    const b = await node()
    await befriend(a, b)
    a.contacts.block(b.me)
    await until(() => !a.net.isOnline(b.me))
    expect(a.contacts.list()[0]).toMatchObject({ blocked: true, online: false })
    a.contacts.unblock(b.me)
    await until(() => a.net.isOnline(b.me), 30000)
  })
})
