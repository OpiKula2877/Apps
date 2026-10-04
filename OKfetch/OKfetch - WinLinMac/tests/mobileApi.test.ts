// The phone UI's API (mobileApi) talking to the phone core (startWorklet) over the line protocol, in one process.
// Node stands in for both the WebView and the Bare worklet; the Java host only routes lines by id.
import createTestnet from 'hyperdht/testnet'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomBytes } from '../src/core/sodium'
import { decodeLine, encodeLine } from '../src/mobile/rpc'
import { startWorklet, type WorkletHandle } from '../src/mobile/worklet'
import { createMobileApi } from '../src/renderer/src/mobile/mobileApi'
import type { OkfetchApi, UiEvent } from '../src/shared/ipc'

type Testnet = Awaited<ReturnType<typeof createTestnet>>

describe('phone API over the line protocol', () => {
  let net: Testnet
  let dir: string
  let worklet: WorkletHandle
  let api: OkfetchApi
  const events: UiEvent[] = []

  beforeAll(async () => {
    net = await createTestnet(3)
    dir = mkdtempSync(join(tmpdir(), 'okfetch-mobileapi-'))
    let toWorklet: (line: string) => void = () => undefined
    const toWeb = new Set<(line: string) => void>()
    const javaCalls = new Map<string, (ok: boolean) => void>()
    // The Java host: replies to 'w…' ids and events go to the WebView; replies to 'j…' ids stay here.
    worklet = startWorklet({
      send: (line) =>
        setTimeout(() => {
          const message = decodeLine(line)
          if (message?.t === 'reply' && message.id.startsWith('j')) javaCalls.get(message.id)?.(message.ok)
          else for (const listener of toWeb) listener(line)
        }, 0),
      onLine: (listener) => {
        toWorklet = listener
      }
    })
    api = createMobileApi({ send: (line) => setTimeout(() => toWorklet(line), 0), onLine: (listener) => toWeb.add(listener) })
    api.onEvent((event) => events.push(event))
    const ready = new Promise<boolean>((resolve) => javaCalls.set('j0', resolve))
    toWorklet(
      encodeLine({
        t: 'call',
        id: 'j0',
        method: 'init',
        args: [{ root: join(dir, 'okfetch'), configDir: join(dir, 'config'), cacheDir: join(dir, 'cache'), dataKey: randomBytes(32), bootstrap: net.bootstrap, kdf: { memoryKib: 1024, iterations: 1, lanes: 1 } }]
      })
    )
    expect(await ready).toBe(true)
  })

  afterAll(async () => {
    await worklet.close()
    await net.destroy()
    rmSync(dir, { recursive: true, force: true })
  })

  it('says it is the Android build', () => {
    expect(api.platform).toBe('android')
  })

  it('answers calls with the core result', async () => {
    expect(await api.getStatus()).toEqual({ phase: 'ready' })
    expect((await api.getProfile()).identifier).toHaveLength(52)
    expect((await api.getSecurityInfo()).backend).toBe('android_keystore')
    expect(await api.addContact('not-an-identifier', 'pw')).toEqual({ ok: false, reason: 'bad_identifier' })
  })

  it('passes optional arguments as missing, not as the text "null"', async () => {
    await api.setUsername('Pepa')
    const fake = 'ybndrfg8ejkmcpqxot1uwisza345h769ybndrfg8ejkmcpqxot1o'
    expect(await api.addContact(fake, 'pw', undefined)).toMatchObject({ ok: true })
    const outgoing = (await api.listRequests()).outgoing[0]
    expect(outgoing.pub).toBe(fake)
    expect(outgoing.name).not.toBe('null')
  })

  it('saves phone settings and announces them to the Java host', async () => {
    const saved = await api.updateSettings({ theme: 'system', app_lock: true, lock_after: 5 })
    expect(saved).toMatchObject({ theme: 'system', app_lock: true, lock_after: 5 })
    await new Promise((r) => setTimeout(r, 20))
    expect(events.some((e) => e.type === 'settings' && e.settings.lock_after === 5)).toBe(true)
    expect((await api.getSettings()).lock_after).toBe(5)
  })

  it('reports what the phone cannot do instead of failing', async () => {
    expect(await api.useStoragePath('/tmp', false)).toEqual({ ok: false, error: 'unsupported' })
    expect(await api.pickFolder()).toBeNull()
  })

})

describe('phone API with a failing core', () => {
  it('turns an error reply into a rejected promise and ignores unknown replies', async () => {
    let listener: (line: string) => void = () => undefined
    const api = createMobileApi({
      send(line) {
        const call = decodeLine(line)
        if (call?.t !== 'call') return
        setTimeout(() => {
          listener(encodeLine({ t: 'reply', id: 'w999', ok: true, result: 'stray' }))
          listener(encodeLine({ t: 'reply', id: call.id, ok: false, error: 'core not running' }))
        }, 0)
      },
      onLine: (fn) => {
        listener = fn
      }
    })
    await expect(api.getProfile()).rejects.toThrow('core not running')
  })
})
