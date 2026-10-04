// Phone UI test (run `npm run smoke:mobile`): the Android web build in a phone-sized browser (Edge or Chrome
// through Playwright) with the fake core of webFake.ts. Checks the phone layout, the back button, dialogs,
// QR scan, the share flow, settings sections, the lock switch, the system theme and the Android-only help.
import { execFileSync } from 'node:child_process'
import { createReadStream, existsSync, mkdirSync, mkdtempSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { extname, join, resolve } from 'node:path'
import { chromium } from 'playwright-core'

const root = resolve(import.meta.dirname, '..', '..')
const dist = join(root, 'dist-mobile')
const shots = process.env.OKFETCH_SHOTS || join(mkdtempSync(join(tmpdir(), 'okfetch-mobile-')), 'shots')
mkdirSync(shots, { recursive: true })

function check(condition, message) {
  if (!condition) throw new Error(`CHECK FAILED: ${message}`)
  console.log(`ok - ${message}`)
}

if (!process.argv.includes('--no-build')) {
  execFileSync(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--config', 'vite.mobile.config.ts'], { cwd: root, stdio: 'ignore' })
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.png': 'image/png', '.svg': 'image/svg+xml' }
const server = createServer((req, res) => {
  const path = join(dist, decodeURIComponent(new URL(req.url, 'http://x').pathname))
  const file = existsSync(path) && statSync(path).isFile() ? path : join(dist, 'index.html')
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' })
  createReadStream(file).pipe(res)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const url = `http://127.0.0.1:${server.address().port}/`

const channel = process.env.OKFETCH_BROWSER || 'msedge'
const browser = await chromium.launch({ channel })
const context = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark' })
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(String(error)))
page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))

const shot = (name) => page.screenshot({ path: join(shots, `${name}.png`) })
const back = () => page.evaluate(() => window.__okfetchBack())
const noSideScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
const widthOf = (selector) => page.locator(selector).first().evaluate((el) => el.getBoundingClientRect().width)

try {
  await page.goto(url)
  await page.locator('.phone-header').waitFor()
  check(await page.locator('.window.phone.android').count() === 1, 'phone layout on a 375 px screen')
  check(await page.locator('.titlebar').count() === 0, 'no desktop title bar on the phone')
  check(await page.locator('.phone-brand .logo').isVisible(), 'logo in the phone header')
  check(await page.locator('.net-dot.net-online').isVisible(), 'online dot next to the logo')
  check(await page.locator('.chat-tabs, .chat-tab-strip').count() === 0, 'no chat tabs on the phone')
  check(await page.locator('.side').isVisible(), 'list of contacts fills the screen')
  check(await noSideScroll(), 'list fits the width')
  await shot('01-list')

  // Open a chat: full screen, back arrow, list hidden, "?" hidden.
  await page.locator('.contact', { hasText: 'Alena' }).locator('.kind-row').first().click()
  await page.locator('.chat-toolbar .chat-title').waitFor()
  check(!(await page.locator('.side').isVisible()), 'chat replaces the list')
  check(await page.locator('.chat-title', { hasText: 'Alena' }).isVisible(), 'chat header shows the contact')
  check(!(await page.locator('.help-button').isVisible()), '"?" hidden in the chat (does not cover Send)')
  check(await noSideScroll(), 'chat fits the width')
  await page.waitForFunction(() => window.__okfetchFake.calls.some((c) => c.method === 'markRead'))
  check(true, 'open chat marks messages read')
  await shot('02-chat')

  // Composer: Enter makes a new line on the phone, the button sends.
  const editor = page.locator('.composer .editor-content')
  await editor.click()
  await page.keyboard.type('Prvni radek')
  await page.keyboard.press('Enter')
  await page.keyboard.type('druhy radek')
  check(!(await page.evaluate(() => window.__okfetchFake.calls.some((c) => c.method === 'sendMessage'))), 'Enter does not send on the phone')
  check(await page.locator('.composer .editor-toolbar').count() === 0, 'formatting hidden until "Aa"')
  await page.locator('.format-toggle').click()
  check(await page.locator('.composer .editor-toolbar').isVisible(), '"Aa" shows the formatting bar')
  await page.locator('.send-button').click()
  await page.waitForFunction(() => window.__okfetchFake.calls.some((c) => c.method === 'sendMessage'))
  const sent = await page.evaluate(() => window.__okfetchFake.calls.find((c) => c.method === 'sendMessage').args[1])
  check(sent.includes('Prvni radek') && sent.includes('druhy radek') && /<p>.*<\/p><p>.*<\/p>/.test(sent), 'Send button sends both lines')

  // Attach menu: bottom sheet with File / Take photo; Back closes it.
  await page.locator('.attach-wrap .icon-button').click()
  check(await page.locator('.sheet.attach-menu').isVisible(), 'paperclip opens File / Take photo')
  await back()
  check(await page.locator('.sheet').count() === 0, 'Back closes the attach menu first')
  check(await page.locator('.chat-title').isVisible(), '…and keeps the chat open')

  // Long press (contextmenu) on a message starts selecting.
  await page.locator('.message-row.theirs .bubble').first().dispatchEvent('contextmenu')
  check(await page.locator('.selection-bar, .message-row.selected').count() > 0, 'holding a message selects it')
  const barRight = await page.locator('.selection-bar button').evaluateAll((buttons) => Math.max(...buttons.map((b) => b.getBoundingClientRect().right)))
  check(barRight <= 375, `all delete buttons fit on the screen (right edge ${Math.round(barRight)} px)`)
  await shot('03-selecting')
  await page.locator('.chat-toolbar .icon-button.toggled').click()

  // Back: chat → list.
  await back()
  check(await page.locator('.side').isVisible(), 'Back returns from the chat to the list')
  check(await page.locator('.help-button').isVisible(), '"?" is back on the list')

  // A long chat scrolls inside; the composer stays on the screen.
  const composerOnScreen = () =>
    page.evaluate(() => {
      const box = document.querySelector('.composer .editor-area')?.getBoundingClientRect()
      return Boolean(box) && box.bottom <= window.innerHeight && box.height >= 36 && document.documentElement.scrollHeight <= window.innerHeight + 1
    })
  await page.locator('.contact', { hasText: 'Bob' }).locator('.kind-row').first().click()
  await page.locator('.chat-title', { hasText: 'Bob' }).waitFor()
  await page.waitForTimeout(300)
  check(await composerOnScreen(), 'long chat: the composer stays on the phone screen')
  await back()
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.locator('.contact', { hasText: 'Bob' }).locator('.kind-row').first().click()
  await page.waitForTimeout(300)
  check(await composerOnScreen(), 'long chat: the composer stays in the window at desktop width')
  await page.locator('.chat-tab .icon-button, .chat-tab button').last().click().catch(() => undefined)
  await page.setViewportSize({ width: 375, height: 812 })
  await page.waitForTimeout(300)
  if (await page.locator('.chat-title').isVisible()) await back()

  // Add contact: full screen, QR scan fills the identifier and the name.
  await page.locator('.side .primary').first().click()
  await page.locator('.modal').waitFor()
  check(Math.abs((await widthOf('.modal')) - 375) < 2, 'dialogs fill the screen')
  const id = 'ybndrfg8ejkmcpqxot1uwisza345h769ybndrfg8ejkmcpqxot1o'
  await page.evaluate((text) => { window.__okfetchFake.scan = text }, `okfetch:add?id=${id}&name=Dana`)
  await page.locator('.scan-button').click()
  await page.waitForFunction((value) => document.querySelector('.modal input.mono')?.value === value, id)
  check(await page.locator('.modal input[maxlength="64"]').inputValue() === 'Dana', 'QR scan fills identifier and name')
  await shot('04-add-contact')
  await back()
  check(await page.locator('.modal').count() === 0, 'Back closes the dialog')

  // Help: Android only, fits the screen.
  await page.locator('.help-button').click()
  await page.locator('.help-dialog').waitFor()
  check(await page.locator('.help-dialog .tab').count() === 0, 'help has no Windows / Linux / macOS tabs')
  check((await page.locator('.help-dialog .help').innerText()).includes('Android'), 'help is about Android')
  check(await page.locator('.help-dialog .help').evaluate((el) => el.scrollWidth <= el.clientWidth + 1), 'help text stays inside the screen')
  check(Math.abs((await widthOf('.help-dialog')) - 375) < 2, 'help fills the screen')
  await shot('05-help')
  await back()

  // Share to OKfetch: a file and a text go to the chosen chat.
  await page.evaluate(() => {
    window.__okfetchFake.launch.push({ type: 'share', text: 'Sdileny text', files: [{ path: '/data/okfetch/outgoing/ab/foto.jpg', name: 'foto.jpg', size: 2048 }] })
  })
  // The web stand-in of the plugin fires "launch", as Java does when a share arrives (webFake.ts / webNative.ts).
  await page.evaluate(() => window.__okfetchFireLaunch())
  await page.locator('.share-dialog').waitFor()
  check(await page.locator('.share-dialog .share-group').count() === 0, 'files are not offered to groups')
  await shot('06-share')
  await page.locator('.share-contact', { hasText: 'Bob' }).locator('button').first().click()
  await page.waitForFunction(() => window.__okfetchFake.calls.some((c) => c.method === 'sendPrepared'))
  const prepared = await page.evaluate(() => window.__okfetchFake.calls.find((c) => c.method === 'sendPrepared').args)
  check(prepared[1] === '/data/okfetch/outgoing/ab/foto.jpg' && prepared[0].endsWith(':enc'), 'shared file offered in the chosen chat')
  await page.waitForFunction(() => document.querySelector('.composer .editor-content')?.textContent?.includes('Sdileny text'))
  check(true, 'shared text waits in the composer')
  await back()

  // Settings: sections, lock, system theme.
  await page.locator('.phone-header .icon-button[aria-label="Nastavení"]').click()
  await page.locator('.section-list').waitFor()
  check(await page.locator('.section-item').count() === 4, 'settings shows four sections')
  await shot('07-settings')
  await page.locator('.section-item').nth(0).click()
  await page.locator('.qr-box svg').waitFor()
  check(true, 'profile shows the QR code')
  await shot('08-profile-qr')
  await back()
  await page.locator('.section-item').nth(2).click()
  await page.locator('text=Odemykat otiskem prstu').click()
  await page.waitForFunction(() => window.__okfetchFake.settings.app_lock === true)
  check(true, 'switching the lock on asks once and saves it')
  check(await page.locator('text=Blokovat snímky obrazovky').isVisible(), 'screenshot switch in Security')
  await shot('09-security')
  await back()
  await page.locator('.section-item').nth(1).click()
  check(await page.locator('text=Vlastní titulek okna, text=Okraj okna').count() === 0, 'desktop-only switches hidden')
  await page.locator('text=Podle systému').click()
  await page.waitForFunction(() => window.__okfetchFake.settings.theme === 'system')
  const darkBg = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim())
  await page.emulateMedia({ colorScheme: 'light' })
  await page.waitForFunction((before) => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() !== before, darkBg)
  const lightBg = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim())
  check(darkBg.toUpperCase() === '#1B1B1F' && lightBg.toUpperCase() === '#F4F4F6', 'system theme follows the phone light / dark mode')
  await shot('10-system-theme-light')
  await page.emulateMedia({ colorScheme: 'dark' })
  await back()
  await page.locator('.section-item').nth(3).click()
  check(await page.locator('text=Běžet na pozadí').isVisible(), 'background switch in the phone system section')
  check(await page.locator('text=Zálohovat').isVisible(), 'backup in the phone system section')
  check(await page.locator('text=Spouštět se systémem').count() === 0, 'no desktop autostart / tray / storage path')
  await shot('11-phone-system')
  await back()
  await back()
  check(await page.locator('.side').isVisible(), 'Back leaves Settings')

  check(errors.length === 0, `no page errors (${errors.join(' | ')})`)
  console.log(`screenshots: ${shots}`)
} finally {
  await browser.close()
  server.close()
}
