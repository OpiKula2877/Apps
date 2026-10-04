// Shared helpers of the Android end-to-end tests: adb, uiautomator lookups, a fresh app install, the desktop peer.
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import { build } from 'esbuild'
import * as z32 from 'z32'

export const root = resolve(import.meta.dirname, '..', '..')
export const ADB = process.env.ADB || join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk', 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb')
export const APK = process.env.OKFETCH_APK || join(root, '..', 'OKfetch - Android', 'OKfetch.apk')
export const PKG = 'cz.opikula.okfetch'

export const adb = (...args) => execFileSync(ADB, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
export const sh = (command) => adb('shell', command)
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function check(condition, message) {
  if (!condition) throw new Error(`CHECK FAILED: ${message}`)
  console.log(`ok - ${message}`)
}

export async function until(test, what, ms = 60_000, step = 1000) {
  const end = Date.now() + ms
  for (;;) {
    const value = await test()
    if (value) return value
    if (Date.now() > end) throw new Error(`timeout: ${what}`)
    await sleep(step)
  }
}

export const screenshotter = (shots) => (name) => {
  const png = execFileSync(ADB, ['exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024 })
  writeFileSync(join(shots, `${name}.png`), png)
}

// --- UI through uiautomator ----------------------------------------------------------

export function nodes() {
  sh('uiautomator dump /sdcard/okfetch-ui.xml >/dev/null 2>&1')
  const xml = sh('cat /sdcard/okfetch-ui.xml')
  return [...xml.matchAll(/<node ([^>]*?)\/?>/g)].map((m) => {
    const attr = (name) => (m[1].match(new RegExp(`${name}="([^"]*)"`)) ?? [])[1] ?? ''
    const [x1, y1, x2, y2] = attr('bounds').match(/\d+/g)?.map(Number) ?? [0, 0, 0, 0]
    return { text: attr('text'), desc: attr('content-desc'), cls: attr('class'), enabled: attr('enabled') !== 'false', x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2), h: y2 - y1 }
  })
}

export const matches = (node, label) => (label instanceof RegExp ? label.test(node.text) || label.test(node.desc) : node.text === label || node.desc === label)

export async function find(label, { scroll = false, ms = 30_000 } = {}) {
  return until(() => {
    const found = nodes().find((n) => matches(n, label) && n.h > 0)
    if (!found && scroll) sh('input swipe 540 1700 540 900 300')
    return found
  }, `UI element ${label}`, ms, 700)
}

export async function tap(label, options) {
  const node = await find(label, options)
  sh(`input tap ${node.x} ${node.y}`)
  await sleep(700)
  return node
}

export const typeText = (text) => sh(`input text '${text.replace(/ /g, '%s')}'`)
export const screenHas = (label) => nodes().some((n) => matches(n, label))

/** Tap the last element with this label (a dialog's button lies after the page's buttons). */
export async function tapLast(label) {
  const node = await until(() => nodes().filter((n) => matches(n, label) && n.h > 0).pop(), `UI element ${label}`, 20_000, 700)
  sh(`input tap ${node.x} ${node.y}`)
  await sleep(700)
}

/** The text input right below a label (inputs without accessible text). */
export async function fieldBelow(label) {
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
export async function inDownloads(want, what) {
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

// --- setup ------------------------------------------------------------------------------

/** A desktop core in Node on the public HyperDHT. */
export async function startDesktopPeer(dir, username, relayOnly = false) {
  // Inside the project, so the bundle finds the packages in node_modules.
  const bundle = join(root, 'out', 'smoke-android-peer.mjs')
  await build({ entryPoints: [join(import.meta.dirname, 'android-peer.ts')], outfile: bundle, bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'warning' })
  const module = await import(`file://${bundle.replace(/\\/g, '/')}`)
  const peer = await module.startPeer(dir, username, relayOnly)
  await until(() => peer.net.status === 'online', 'desktop online on the public DHT')
  return { peer, contactChatId: module.contactChatId }
}

/** Install the APK over a clean state (screenshots allowed for the test) and wait for the core. Returns the phone identifier. */
export async function freshPhone(extraSettings = {}) {
  adb('root')
  await sleep(2000)
  // A clean install, so a different ABI build replaces the old native libraries.
  try {
    adb('uninstall', PKG)
  } catch {
    // not installed
  }
  adb('install', APK)
  sh(`pm clear ${PKG}`)
  const uid = sh(`stat -c %u /data/data/${PKG}`).trim()
  const settings = JSON.stringify({ block_screenshots: false, language: 'cs', theme: 'opikula', background_service: true, ...extraSettings })
  sh(`mkdir -p /data/data/${PKG}/files/config && echo '${settings}' > /data/data/${PKG}/files/config/settings.json && chown -R ${uid}:${uid} /data/data/${PKG}/files && chmod -R 700 /data/data/${PKG}/files`)
  sh(`pm grant ${PKG} android.permission.POST_NOTIFICATIONS`)
  adb('logcat', '-c')
  sh(`am start -n ${PKG}/.MainActivity`)
  await until(() => adb('logcat', '-d', '-s', 'OKfetch:I').includes('core: ready'), 'phone core ready', 60_000)
  const identity = JSON.parse(await until(() => { try { return sh(`cat /data/data/${PKG}/files/okfetch/identity.json`) } catch { return null } }, 'identity.json'))
  await until(() => screenHas('Přidat kontakt'), 'phone UI loaded')
  return { uid, phoneId: z32.encode(Buffer.from(identity.publicKey, 'hex')) }
}
