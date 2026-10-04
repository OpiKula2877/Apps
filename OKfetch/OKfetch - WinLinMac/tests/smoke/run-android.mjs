// End-to-end test of the APK (run `npm run smoke:android`): a running emulator (or a phone with root via adb)
// against a desktop core in Node, both on the public HyperDHT. The phone is driven through adb + uiautomator
// (WebView text is visible there). Checks: receive password, request from the desktop, accept, messages both
// ways (encrypted), a file to the phone, and a notification while the app is in the background.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import * as z32 from 'z32'

const root = resolve(import.meta.dirname, '..', '..')
const work = mkdtempSync(join(tmpdir(), 'okfetch-android-'))
const shots = process.env.OKFETCH_SHOTS || join(work, 'shots')
mkdirSync(shots, { recursive: true })
const ADB = process.env.ADB || join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk', 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb')
const APK = join(root, '..', 'OKfetch - Android', 'OKfetch.apk')
const PKG = 'cz.opikula.okfetch'
const PHONE_PASSWORD = 'telefon-heslo-1'

const adb = (...args) => execFileSync(ADB, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const sh = (command) => adb('shell', command)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function check(condition, message) {
  if (!condition) throw new Error(`CHECK FAILED: ${message}`)
  console.log(`ok - ${message}`)
}

async function until(test, what, ms = 60_000, step = 1000) {
  const end = Date.now() + ms
  for (;;) {
    const value = await test()
    if (value) return value
    if (Date.now() > end) throw new Error(`timeout: ${what}`)
    await sleep(step)
  }
}

function screenshot(name) {
  const png = execFileSync(ADB, ['exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024 })
  writeFileSync(join(shots, `${name}.png`), png)
}

// --- UI through uiautomator ----------------------------------------------------------

function nodes() {
  sh('uiautomator dump /sdcard/okfetch-ui.xml >/dev/null 2>&1')
  const xml = sh('cat /sdcard/okfetch-ui.xml')
  return [...xml.matchAll(/<node ([^>]*?)\/?>/g)].map((m) => {
    const attr = (name) => (m[1].match(new RegExp(`${name}="([^"]*)"`)) ?? [])[1] ?? ''
    const [x1, y1, x2, y2] = attr('bounds').match(/\d+/g)?.map(Number) ?? [0, 0, 0, 0]
    return { text: attr('text'), desc: attr('content-desc'), cls: attr('class'), enabled: attr('enabled') !== 'false', x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2), h: y2 - y1 }
  })
}

const matches = (node, label) => (label instanceof RegExp ? label.test(node.text) || label.test(node.desc) : node.text === label || node.desc === label)

async function find(label, { scroll = false, ms = 30_000 } = {}) {
  return until(() => {
    const found = nodes().find((n) => matches(n, label) && n.h > 0)
    if (!found && scroll) sh('input swipe 540 1700 540 900 300')
    return found
  }, `UI element ${label}`, ms, 700)
}

async function tap(label, options) {
  const node = await find(label, options)
  sh(`input tap ${node.x} ${node.y}`)
  await sleep(700)
  return node
}

const typeText = (text) => sh(`input text '${text.replace(/ /g, '%s')}'`)
const screenHas = (label) => nodes().some((n) => matches(n, label))

/** Tap the last element with this label (a dialog's button lies after the page's buttons). */
async function tapLast(label) {
  const node = await until(() => nodes().filter((n) => matches(n, label) && n.h > 0).pop(), `UI element ${label}`, 20_000, 700)
  sh(`input tap ${node.x} ${node.y}`)
  await sleep(700)
}

/** The text input right below a label (inputs without accessible text). */
async function fieldBelow(label) {
  return until(() => {
    const list = nodes()
    const caption = list.find((n) => n.text === label && n.h > 0)
    const field = caption && list.filter((n) => n.cls === 'android.widget.EditText' && n.h > 0 && n.y > caption.y).sort((a, b) => a.y - b.y)[0]
    if (field && field.y < 2200) return field
    sh('input swipe 540 1700 540 1100 300')
    return null
  }, `input below ${label}`, 30_000, 800)
}

/** In the system document screen: open Downloads and return the node of the wanted file (or button). */
async function inDownloads(want, what) {
  return until(() => {
    const list = nodes()
    const target = list.find((n) => want(n) && n.enabled)
    if (target) return target
    const downloads = list.find((n) => n.text === 'Downloads' && n.h > 0)
    if (downloads) {
      sh(`input tap ${downloads.x} ${downloads.y}`)
      return null
    }
    const roots = list.find((n) => n.desc === 'Show roots')
    if (roots) sh(`input tap ${roots.x} ${roots.y}`)
    return null
  }, what, 40_000, 1200)
}

// --- run ------------------------------------------------------------------------------

let peer = null
try {
  // Desktop side.
  // Inside the project, so the bundle finds the packages in node_modules.
  const bundle = join(root, 'out', 'smoke-android-peer.mjs')
  await build({ entryPoints: [join(import.meta.dirname, 'android-peer.ts')], outfile: bundle, bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'warning' })
  const { startPeer, contactChatId } = await import(`file://${bundle.replace(/\\/g, '/')}`)
  peer = await startPeer(join(work, 'desktop'), 'PC Tester')
  await until(() => peer.net.status === 'online', 'desktop online on the public DHT')
  check(true, 'desktop core online on the public HyperDHT')

  // Phone: fresh install state, screenshots allowed for the test.
  adb('root')
  await sleep(2000)
  adb('install', '-r', APK)
  sh(`pm clear ${PKG}`)
  const uid = sh(`stat -c %u /data/data/${PKG}`).trim()
  sh(`mkdir -p /data/data/${PKG}/files/config && echo '{"block_screenshots":false,"language":"cs","theme":"opikula","background_service":true}' > /data/data/${PKG}/files/config/settings.json && chown -R ${uid}:${uid} /data/data/${PKG}/files && chmod -R 700 /data/data/${PKG}/files`)
  sh(`pm grant ${PKG} android.permission.POST_NOTIFICATIONS`)
  adb('logcat', '-c')
  sh(`am start -n ${PKG}/.MainActivity`)
  await until(() => adb('logcat', '-d', '-s', 'OKfetch:I').includes('core: ready'), 'phone core ready', 60_000)
  check(true, 'phone core started (Bare worklet)')
  const identity = JSON.parse(await until(() => { try { return sh(`cat /data/data/${PKG}/files/okfetch/identity.json`) } catch { return null } }, 'identity.json'))
  const phoneId = z32.encode(Buffer.from(identity.publicKey, 'hex'))
  check(phoneId.length === 52, `phone identifier ${phoneId.slice(0, 8)}…`)
  await until(() => screenHas('Přidat kontakt'), 'phone UI loaded')
  screenshot('a01-start')

  // Phone: receive password in Settings → Profile.
  await tap('Nastavení')
  await tap('Profil')
  // The password input has no accessible text: take the input right above the "Set password" button.
  const button = await find('Nastavit heslo', { scroll: true })
  const field = nodes().filter((n) => n.cls === 'android.widget.EditText' && n.h > 0 && n.y < button.y).sort((a, b) => b.y - a.y)[0]
  check(Boolean(field), 'password field found')
  sh(`input tap ${field.x} ${field.y}`)
  await sleep(500)
  typeText(PHONE_PASSWORD)
  sh('input keyevent 4') // hide the keyboard
  await tap('Nastavit heslo', { scroll: true })
  await until(() => screenHas(/Heslo je nastavené|Heslo je nastaveno/), 'password saved on the phone', 15_000).catch(() => null)
  screenshot('a02-password')
  sh('input keyevent 4')
  await sleep(400)
  sh('input keyevent 4')
  await find('Přidat kontakt')

  // Desktop sends a contact request to the phone; the phone accepts it.
  const added = await peer.contacts.add(phoneId, PHONE_PASSWORD, 'Telefon')
  check(added.ok, 'desktop sends the request (password proof)')
  await find('PC Tester', { ms: 120_000 })
  check(true, 'request from the desktop reaches the phone over the public DHT')
  screenshot('a03-request')
  await tap('Přijmout')
  await until(() => peer.contacts.list().some((c) => c.pub === phoneId && c.online), 'phone accepted and online at the desktop', 90_000)
  check(true, 'phone accepted; both sides are contacts and online')

  // Desktop → phone (encrypted chat).
  const enc = contactChatId(phoneId, 'enc')
  check((await peer.messages.send(enc, '<p>Ahoj z PC, šifrovaně</p>')).ok, 'desktop sends an encrypted message')
  await tap(/^Šifrovaný$/)
  await find(/Ahoj z PC, šifrovaně/, { ms: 60_000 })
  check(true, 'phone shows the encrypted message from the desktop')
  screenshot('a04-chat')

  // Phone → desktop.
  const editor = await until(() => nodes().filter((n) => n.cls === 'android.widget.EditText').pop(), 'composer')
  sh(`input tap ${editor.x} ${editor.y}`)
  await sleep(400)
  typeText('Ahoj z telefonu')
  await tap('Odeslat')
  await until(() => peer.messages.list(enc).some((m) => !m.mine && m.html.includes('Ahoj z telefonu')), 'phone message at the desktop', 60_000)
  check(true, 'desktop receives the message typed on the phone')
  await until(() => peer.messages.list(enc).some((m) => m.mine && m.status === 'read'), 'read receipt from the phone', 30_000)
  check(true, 'phone sends the read receipt (✓✓ at the desktop)')

  // File desktop → phone.
  const gif = join(work, 'obrazek.gif')
  writeFileSync(gif, Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64'))
  const offer = await peer.transfers.sendFile(enc, gif)
  check(offer.ok, 'desktop offers a GIF')
  await tap('Přijmout', { ms: 60_000 })
  await until(() => peer.messages.list(enc).some((m) => m.file?.state === 'done'), 'file delivered to the phone', 60_000)
  check(true, 'phone accepts and receives the file (encrypted blocks, hash checked)')
  await sleep(1500)
  screenshot('a05-file')

  // Background: a message arrives as a notification.
  sh('input keyevent 3')
  await sleep(1500)
  check((await peer.messages.send(enc, '<p>Zprava na pozadi</p>')).ok, 'desktop sends while the app is in the background')
  await until(() => sh('dumpsys notification --noredact').includes('Zprava na pozadi'), 'notification on the phone', 60_000)
  check(true, 'phone shows a notification for the message (app in the background)')
  sh('cmd statusbar expand-notifications')
  await sleep(1500)
  screenshot('a06-notification')
  sh('cmd statusbar collapse')

  // Back into the app from the notification shade.
  sh(`am start -n ${PKG}/.MainActivity`)
  await find('Odeslat', { ms: 20_000 })

  // The phone sends a file through the system file picker (Downloads → logo-z-telefonu.png).
  sh('mkdir -p /sdcard/Download')
  adb('push', join(root, 'resources', 'icon.png'), '/sdcard/Download/logo-z-telefonu.png')
  sh('content call --uri content://media --method scan_volume --arg external_primary >/dev/null 2>&1 || true')
  await tap('Poslat soubor')
  await tap(/^Soubor$/)
  const picked = await inDownloads((n) => n.text === 'logo-z-telefonu.png', 'file in the system picker')
  sh(`input tap ${picked.x} ${picked.y}`)
  await until(() => peer.messages.list(enc).some((m) => !m.mine && m.file?.name === 'logo-z-telefonu.png'), 'offer from the phone at the desktop', 60_000)
  const phoneOffer = peer.messages.list(enc).find((m) => !m.mine && m.file?.name === 'logo-z-telefonu.png')
  check(true, 'phone offers a file picked in the system picker')
  check(await peer.transfers.accept(enc, phoneOffer.id), 'desktop accepts the phone file')
  await until(() => peer.messages.list(enc).some((m) => m.id === phoneOffer.id && m.file?.state === 'done'), 'phone file at the desktop', 60_000)
  check(true, 'desktop receives the phone file (hash checked)')
  await until(() => sh(`ls /data/data/${PKG}/files/okfetch/outgoing 2>/dev/null | wc -l`).trim() === '0', 'outgoing copy removed', 30_000)
  check(true, 'the outgoing copy on the phone is removed after the transfer')

  // An image from the desktop shows right in the chat (served from files/ only).
  const logo = join(work, 'logo.png')
  writeFileSync(logo, readFileSync(join(root, 'resources', 'icon.png')))
  const imageOffer = await peer.transfers.sendFile(enc, logo)
  check(imageOffer.ok, 'desktop offers an image')
  await tapLast('Přijmout')
  await until(() => peer.messages.list(enc).some((m) => m.id === imageOffer.id && m.file?.state === 'done'), 'image delivered', 60_000)
  await sleep(2500)
  screenshot('a07-image')
  check(screenHas(/^logo\.png$/), 'received image is shown in the chat')

  // "Share to OKfetch" with text from another app.
  sh(`am start -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT 'Sdileny text z jine aplikace' -n ${PKG}/.MainActivity`)
  await find('Sdílet do…', { ms: 20_000 })
  screenshot('a08-share')
  await tapLast(/^Šifrovaný$/) // the dialog's button, not the chat header behind it
  // The editor's text is not visible to uiautomator: the desktop checks what arrives.
  await sleep(1000)
  await tap('Odeslat')
  await until(() => peer.messages.list(enc).some((m) => !m.mine && m.html.includes('Sdileny text z jine aplikace')), 'shared text at the desktop', 60_000)
  check(true, 'text shared from another app goes to the chosen chat')

  // okfetch: link (QR read by another app) opens "Add contact" filled in.
  const otherId = 'ybndrfg8ejkmcpqxot1uwisza345h769ybndrfg8ejkmcpqxot1o'
  sh(`am start -a android.intent.action.VIEW -d 'okfetch:add?id=${otherId}&name=Dana'`)
  await find('Naskenovat QR', { ms: 20_000 })
  check(screenHas(otherId) && screenHas('Dana'), 'okfetch: link fills Add contact')
  screenshot('a09-link')
  // Back: keyboard, then the dialog, then the chat.
  await until(() => {
    if (screenHas('Přidat kontakt') && !screenHas('Naskenovat QR')) return true
    sh('input keyevent 4')
    return false
  }, 'back to the list', 15_000, 900)

  // Backup through the system save dialog, then restore it through the picker.
  await tap('Nastavení')
  await tap('Pozadí, notifikace a záloha')
  for (const label of ['Heslo zálohy', 'Heslo zálohy znovu']) {
    const field = await fieldBelow(label)
    sh(`input tap ${field.x} ${field.y}`)
    await sleep(300)
    typeText('zaloha-heslo-1')
    sh('input keyevent 4')
    await sleep(400)
  }
  await tap('Zálohovat', { scroll: true })
  const save = await inDownloads((n) => /^(SAVE|Save)$/.test(n.text), 'system save dialog')
  sh(`input tap ${save.x} ${save.y}`)
  await find('Záloha je uložená.', { ms: 30_000 })
  check(true, 'backup saved through the system save dialog')
  const before = peer.messages.list(enc).length
  const restoreField = await fieldBelow('Vyberete soubor .okfb a zadáte heslo zálohy. Současná data se nahradí.')
  sh(`input tap ${restoreField.x} ${restoreField.y}`)
  await sleep(300)
  typeText('zaloha-heslo-1')
  sh('input keyevent 4')
  await sleep(400)
  // "Obnovit" is also the heading of the section: tap the buttons only.
  const restoreButton = await until(() => nodes().find((n) => n.text === 'Obnovit' && n.cls === 'android.widget.Button' && n.h > 0), 'restore button', 20_000, 700)
  sh(`input tap ${restoreButton.x} ${restoreButton.y}`)
  await sleep(900)
  // uiautomator gets a stale WebView tree for this dialog (the browser shows it fine), so tap its confirm
  // button by position: the dialog fills the screen and the button sits bottom right.
  const [width, height] = sh('wm size').match(/(\d+)x(\d+)/).slice(1).map(Number)
  sh(`input tap ${Math.round(width * 0.85)} ${Math.round(height * 0.935)}`)
  const backupFile = await inDownloads((n) => /^OKfetch-zaloha-.*\.okfb$/.test(n.text), 'backup in the picker')
  sh(`input tap ${backupFile.x} ${backupFile.y}`)
  await find('Záloha je obnovená.', { ms: 60_000 })
  check(true, 'backup restored through the system picker')
  await until(() => peer.contacts.list().some((c) => c.pub === phoneId && c.online), 'phone back online after restore', 120_000)
  check((await peer.messages.send(enc, '<p>Po obnove</p>')).ok && peer.messages.list(enc).length === before + 1, 'same identity after restore: the desktop reaches the phone again')

  // App lock: the device PIN (the emulator has no fingerprint) guards the app on start.
  sh('locksettings set-pin 1357')
  try {
    sh(`am force-stop ${PKG}`)
    sh(`echo '{"block_screenshots":false,"language":"cs","theme":"opikula","background_service":true,"app_lock":true}' > /data/data/${PKG}/files/config/settings.json`)
    sh(`chown ${uid}:${uid} /data/data/${PKG}/files/config/settings.json`)
    sh(`am start -n ${PKG}/.MainActivity`)
    await sleep(5000)
    screenshot('a10-locked')
    check(!screenHas('Přidat kontakt'), 'nothing of the app is visible while locked')
    typeText('1357')
    sh('input keyevent 66')
    await find('Přidat kontakt', { ms: 20_000 })
    check(true, 'the device PIN unlocks the app')
  } finally {
    sh('locksettings clear --old 1357')
  }

  console.log(`screenshots: ${shots}`)
} finally {
  await peer?.close().catch(() => undefined)
  rmSync(join(work, 'desktop'), { recursive: true, force: true })
}
