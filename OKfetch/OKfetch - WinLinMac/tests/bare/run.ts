// Runs inside Bare (bundled by scripts/build-worklet.mjs --test): two phone cores talk through the same line
// protocol the Android app uses. Checks storage, crypto, files, backup and restart under the Bare runtime.
// Web globals for Bare first (noble needs them while loading).
import '../../src/mobile/polyfills'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from '../../src/core/sodium'
import { decodeLine, encodeLine } from '../../src/mobile/rpc'
import { bareSocketFactory, bareSocketsAvailable } from '../../src/mobile/bareSocket'
import { startWorklet, type InitOptions, type WorkletHandle } from '../../src/mobile/worklet'

const FAST = { memoryKib: 1024, iterations: 1, lanes: 1 }
const base = join(tmpdir(), `okfetch-bare-${randomBytes(6).toString('hex')}`)
mkdirSync(base, { recursive: true })

function fail(message: string): never {
  console.log(`FAIL ${message}`)
  rmSync(base, { recursive: true, force: true })
  Bare.exit(1)
}

Bare.on('uncaughtException', (error) => fail(`uncaught ${String((error as Error)?.stack ?? error)}`))
Bare.on('unhandledRejection', (error) => fail(`unhandled ${String((error as Error)?.stack ?? error)}`))

function check(condition: unknown, message: string): void {
  if (!condition) fail(message)
  console.log(`ok ${message}`)
}

async function until(test: () => Promise<boolean> | boolean, what: string, ms = 15000): Promise<void> {
  const end = Date.now() + ms
  while (!(await test())) {
    if (Date.now() > end) fail(`timeout: ${what}`)
    await new Promise((r) => setTimeout(r, 25))
  }
}

/** Plays the part of the Java host and the WebView for one worklet. */
class Phone {
  handle!: WorkletHandle
  events: any[] = []
  hostAnswers: Record<string, (args: unknown[]) => unknown> = {}
  private pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>()
  private next = 0

  constructor(
    readonly name: string,
    readonly dataKey: Uint8Array = randomBytes(32),
    readonly extra: Partial<InitOptions> = {}
  ) {}

  get root(): string {
    return join(base, this.name, 'okfetch')
  }

  async start(): Promise<string> {
    let toWorklet: (line: string) => void = () => undefined
    this.handle = startWorklet(
      {
      send: (line) => setTimeout(() => this.receive(line), 0),
      onLine: (listener) => {
        toWorklet = listener
      }
      },
      { relaySocket: bareSocketFactory }
    )
    this.sendLine = (line) => setTimeout(() => toWorklet(line), 0)
    const status = await this.call('init', {
      root: this.root,
      configDir: join(base, this.name, 'config'),
      cacheDir: join(base, this.name, 'cache'),
      dataKey: this.dataKey,
      kdf: FAST,
      retryMs: 300,
      ...this.extra
    })
    return status.phase
  }

  private sendLine: (line: string) => void = () => undefined

  call(method: string, ...args: unknown[]): Promise<any> {
    const id = `w${this.next++}`
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.sendLine(encodeLine({ t: 'call', id, method, args }))
    })
  }

  private receive(line: string): void {
    const message = decodeLine(line)
    if (!message) fail(`${this.name}: bad line from the worklet: ${line.slice(0, 80)}`)
    if (message.t === 'event') this.events.push(message.event)
    else if (message.t === 'reply') {
      const waiting = this.pending.get(message.id)
      this.pending.delete(message.id)
      if (message.ok) waiting?.resolve(message.result)
      else waiting?.reject(new Error(message.error))
    } else if (message.t === 'host') {
      const answer = this.hostAnswers[message.method]
      Promise.resolve(answer ? answer(message.args) : null).then((result) =>
        this.sendLine(encodeLine({ t: 'reply', id: message.id, ok: true, result }))
      )
    }
  }
}

async function main(): Promise<void> {
  const a = new Phone('a')
  const b = new Phone('b')
  check((await a.start()) === 'ready', 'phone A starts')
  check((await b.start()) === 'ready', 'phone B starts')
  check(a.events.some((e) => e.type === 'app' && e.status.phase === 'ready'), 'ready event reaches the UI')

  const idA = (await a.call('getProfile')).identifier
  const idB = (await b.call('getProfile')).identifier
  check(typeof idA === 'string' && idA.length === 52 && idA !== idB, 'identifiers are z-base-32 public keys')
  check((await a.call('getSecurityInfo')).backend === 'android_keystore', 'keys protected by the data key')
  const identityFile = readFileSync(join(a.root, 'identity.json'), 'utf8')
  check(JSON.parse(identityFile).secretBlob.startsWith('dk:'), 'identity secret is wrapped on disk')

  await a.call('setUsername', 'Alena')
  check((await b.call('setPassword', 'heslo-b')) === null, 'receive password set')
  check((await a.call('addContact', idB, 'heslo-b', 'Bee')).ok === true, 'request sent')
  await until(async () => (await b.call('listRequests')).incoming.some((r: any) => r.pub === idA), 'request arrives')
  check(b.events.some((e) => e.type === 'request'), 'request event for the notification')
  check((await b.call('acceptRequest', idA, 'Aye')) === true, 'request accepted')
  await until(async () => (await a.call('listContacts')).some((c: any) => c.pub === idB && c.online), 'A sees B online')

  const enc = `${idB}:enc`
  const plain = `${idB}:plain`
  check((await a.call('sendMessage', enc, '<p>Ahoj <strong>šifrovaně</strong> 🙂</p>')).ok, 'encrypted message sent')
  check((await a.call('sendMessage', plain, '<p>Ahoj nešifrovaně</p>')).ok, 'plain message sent')
  await until(async () => (await b.call('getMessages', `${idA}:enc`)).length === 1 && (await b.call('getMessages', `${idA}:plain`)).length === 1, 'messages arrive')
  const got = (await b.call('getMessages', `${idA}:enc`))[0]
  check(got.html === '<p>Ahoj <strong>šifrovaně</strong> 🙂</p>', 'encrypted text intact (UTF-8, emoji)')
  check(b.events.some((e) => e.type === 'incoming' && e.chatId === `${idA}:enc`), 'incoming event for the notification')
  const chatsDir = join(b.root, 'chats')
  const logs = readdirSync(chatsDir).map((d: any) => readFileSync(join(chatsDir, String(d), 'messages.jsonl'), 'utf8'))
  check(logs.some((l) => l.includes('Ahoj nešifrovaně')) && !logs.some((l) => l.includes('šifrovaně</strong>')), 'enc chat stored as ciphertext, plain as text')
  await until(async () => (await a.call('getMessages', enc))[0].status === 'delivered', 'delivery confirmation')
  await b.call('markRead', `${idA}:enc`)
  await until(async () => (await a.call('getMessages', enc))[0].status === 'read', 'read confirmation')

  // File: the host copies the picked file into outgoing/ and returns its path.
  const outgoing = join(a.root, 'outgoing', 'tok1')
  mkdirSync(outgoing, { recursive: true })
  const photo = randomBytes(300_000)
  writeFileSync(join(outgoing, 'fotka.jpg'), photo)
  a.hostAnswers.pickFile = (args) => (args[0] === 'camera' ? join(outgoing, 'fotka.jpg') : null)
  check((await a.call('sendPrepared', enc, join(b.root, 'identity.json'))).reason === 'no_file', 'only prepared copies can be sent by path')
  check((await a.call('sendFile', enc, 'file')).reason === 'cancelled', 'cancelled picker sends nothing')
  const sent = await a.call('sendFile', enc, 'camera')
  check(sent.ok, 'photo offered')
  await until(async () => (await b.call('getMessages', `${idA}:enc`)).some((m: any) => m.file?.state === 'offered'), 'offer arrives')
  check((await b.call('acceptFile', `${idA}:enc`, sent.id)) === true, 'offer accepted')
  await until(async () => (await b.call('getMessages', `${idA}:enc`)).some((m: any) => m.file?.state === 'done'), 'file arrives', 30000)
  const received = (await b.call('getMessages', `${idA}:enc`)).find((m: any) => m.file?.state === 'done')
  const receivedBytes = readFileSync(join(b.root, 'files', ...received.file.rel.split('/')))
  check(Buffer.compare(receivedBytes, photo) === 0, 'file content identical after encrypted transfer')
  await until(() => !existsSync(outgoing), 'finished upload removed from outgoing/', 20000)

  // Backup and restore on the same phone.
  const exported = join(base, 'export.okfb')
  a.hostAnswers.saveDocument = (args) => {
    writeFileSync(exported, readFileSync(String(args[0])))
    return true
  }
  check((await a.call('createBackup', 'zaloha-heslo', true)).ok, 'backup created')
  a.hostAnswers.pickDocument = () => exported
  check((await a.call('restoreBackup', 'spatne')).error === 'wrong_password', 'wrong backup password refused')
  check((await a.call('restoreBackup', 'zaloha-heslo')).ok, 'backup restored')
  check((await a.call('getProfile')).identifier === idA, 'same identity after restore')
  check((await a.call('getMessages', enc)).length === 2, 'messages back after restore')
  await until(async () => (await a.call('listContacts')).some((c: any) => c.pub === idB && c.online), 'reconnects after restore')

  // Restart with the same data key keeps everything; another data key cannot open the keys.
  await a.handle.close()
  const again = new Phone('a', a.dataKey)
  check((await again.start()) === 'ready', 'restart with the same data key')
  check((await again.call('getMessages', enc)).length === 2, 'messages survive a restart')
  await again.handle.close()
  const other = new Phone('a', randomBytes(32))
  check((await other.start()) === 'keys', 'a lost Keystore key is reported, not hidden')
  await other.call('resetData')
  check((await other.call('getStatus')).phase === 'ready', 'start again with a new identity')
  check((await other.call('getProfile')).identifier !== idA, 'new identity after reset')

  await other.handle.close()
  // Relay fallback inside Bare: two phones on separate networks (the fake DHT cannot connect them) meet
  // through a Nostr relay run by the test (argument 2), using bare-ws.
  const relayUrl = Bare.argv[2]
  // Windows Smart App Control may block the unsigned TLS addon of bare-ws; the emulator test covers it then.
  if (relayUrl && !bareSocketsAvailable()) console.log('SKIP relay in Bare: bare-ws cannot load its addons on this computer')
  if (relayUrl && bareSocketsAvailable()) {
    const c = new Phone('c', undefined, { bootstrap: [{ host: 'net-c', port: 1 }], relayUrls: [relayUrl] })
    const d = new Phone('d', undefined, { bootstrap: [{ host: 'net-d', port: 1 }], relayUrls: [relayUrl] })
    check((await c.start()) === 'ready' && (await d.start()) === 'ready', 'two phones on separate networks start')
    const idC = (await c.call('getProfile')).identifier
    const idD = (await d.call('getProfile')).identifier
    await until(async () => (await c.call('getNetDiagnostics')).relay?.connected === 1 && (await d.call('getNetDiagnostics')).relay?.connected === 1, 'bare-ws connects to the relay')
    check(true, 'bare-ws connects to the relay')
    await d.call('setPassword', 'heslo-d')
    check((await c.call('addContact', idD, 'heslo-d', 'Dana')).ok, 'request through the relay sent')
    await until(async () => (await d.call('listRequests')).incoming.some((r: any) => r.pub === idC), 'request arrives through the relay', 30000)
    check((await d.call('acceptRequest', idC, 'Cyril')) === true, 'accepted')
    await until(async () => (await c.call('listContacts')).some((x: any) => x.pub === idD && x.online && x.via === 'relay'), 'contact online through the relay', 30000)
    check(true, 'contact online through the relay')
    check((await c.call('sendMessage', `${idD}:enc`, '<p>přes relay v Bare</p>')).ok, 'message sent')
    await until(async () => (await d.call('getMessages', `${idC}:enc`)).some((m: any) => m.html === '<p>přes relay v Bare</p>'), 'message through the relay', 30000)
    check(true, 'encrypted message through the relay arrives')
    await c.handle.close()
    await d.handle.close()
  }

  await b.handle.close()
  rmSync(base, { recursive: true, force: true })
  console.log('DONE')
  Bare.exit(0)
}

main().catch((error) => fail(String(error?.stack ?? error)))
