// The phone sends the contact request (run `npm run smoke:android:request`): the APK on an emulator adds a desktop
// core in Node through "Add contact", both on the public HyperDHT. The desktop accepts; messages go both ways.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { adb, check, fieldBelow, find, freshPhone, screenshotter, sh, sleep, startDesktopPeer, tap, typeText, until } from './android-adb.mjs'

const work = mkdtempSync(join(tmpdir(), 'okfetch-android-request-'))
const shots = process.env.OKFETCH_SHOTS || join(work, 'shots')
mkdirSync(shots, { recursive: true })
const screenshot = screenshotter(shots)
const PC_PASSWORD = 'pc-heslo-1'
// OKFETCH_E2E_RELAY=1: both sides skip direct connections, so everything goes through the public Nostr relays
// (what happens between two devices behind random-port NATs, e.g. mobile data).
const RELAY_ONLY = process.env.OKFETCH_E2E_RELAY === '1'

let peer = null
try {
  const desktop = await startDesktopPeer(join(work, 'desktop'), 'PC Tester', RELAY_ONLY)
  peer = desktop.peer
  check((await peer.contacts.setPassword(PC_PASSWORD)) === null, 'desktop online with a receive password')

  const { phoneId } = await freshPhone(RELAY_ONLY ? { relay_only: true } : {})
  check(phoneId.length === 52, 'phone core started')

  // Phone: Add contact → identifier + password of the desktop → Send request.
  await tap('Přidat kontakt')
  for (const [label, text] of [['Identifikátor', peer.me], ['Heslo protistrany', PC_PASSWORD]]) {
    const field = await fieldBelow(label)
    sh(`input tap ${field.x} ${field.y}`)
    await sleep(300)
    typeText(text)
    await sleep(300)
  }
  sh('input keyevent 4') // keyboard away
  await sleep(500)
  screenshot('r01-add-filled')
  await tap('Odeslat žádost')
  await find('Žádost odeslána.', { ms: 30_000 })
  check(true, 'phone accepted the form (request stored, Argon2 done)')
  screenshot('r02-sent')

  // The desktop must get the request.
  const arrived = await until(() => peer.contacts.incoming().some((r) => r.pub === phoneId), 'request at the desktop', 120_000).catch(() => false)
  screenshot('r03-after-wait')
  if (!arrived) {
    console.log('--- phone log (OKfetch, bare) ---')
    console.log(adb('logcat', '-d').split('\n').filter((l) => /OKfetch|bare|okfetch/i.test(l)).slice(-40).join('\n'))
    console.log('--- desktop: online peers ---', peer.net.isOnline(phoneId), 'status', peer.net.status)
  }
  check(arrived, 'request from the phone reaches the desktop')
  check(peer.contacts.accept(phoneId, 'Telefon'), 'desktop accepts')
  if (RELAY_ONLY) {
    await until(() => peer.contacts.list().some((c) => c.pub === phoneId && c.online), 'phone online at the desktop', 90_000)
    check(peer.contacts.list().find((c) => c.pub === phoneId).via === 'relay', 'the connection goes through the public relays')
  }
  await find('PC Tester', { ms: 60_000 })
  check(true, 'phone shows the new contact')

  const enc = desktop.contactChatId(phoneId, 'enc')
  check((await peer.messages.send(enc, '<p>Ahoj telefone</p>')).ok, 'desktop sends a message')
  await tap(/^Šifrovaný$/)
  await find(/Ahoj telefone/, { ms: 60_000 })
  check(true, 'message reaches the phone')
  screenshot('r04-chat')
  console.log(`screenshots: ${shots}`)
} finally {
  await peer?.close().catch(() => undefined)
  rmSync(join(work, 'desktop'), { recursive: true, force: true })
}
