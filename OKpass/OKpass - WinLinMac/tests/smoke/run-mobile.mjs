// Phone UI test: the Android web build in a phone-sized browser window (Microsoft Edge),
// with the browser stand-ins for storage and fingerprint. Run: npm run smoke:mobile
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright-core'

const root = resolve(import.meta.dirname, '..', '..')
const shots = process.env.OKPASS_SHOTS || mkdtempSync(join(tmpdir(), 'okpass-mobile-'))
mkdirSync(shots, { recursive: true })
const PORT = 4179

function check(condition, message) {
  if (!condition) throw new Error(`CHECK FAILED: ${message}`)
  console.log(`ok - ${message}`)
}

const server = spawn(`npx vite preview --config vite.mobile.config.ts --port ${PORT} --strictPort`, { cwd: root, shell: true })
await new Promise((ready, fail) => {
  const timer = setTimeout(() => fail(new Error('preview server did not start')), 30000)
  server.stdout.on('data', (chunk) => {
    if (String(chunk).includes(String(PORT))) {
      clearTimeout(timer)
      ready()
    }
  })
})

const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  const context = await browser.newContext({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const page = await context.newPage()
  page.on('pageerror', (error) => console.log('PAGE ERROR', error.message))
  const shot = (name) => page.screenshot({ path: join(shots, `${name}.png`) })
  const button = (name) => page.getByRole('button', { name, exact: true })
  const back = () => page.evaluate(() => window.__okpassBack())
  const unlock = async (key) => {
    await page.locator('#key').fill(key)
    await page.locator('#key').press('Enter')
    await page.locator('.vault-page').waitFor()
  }
  const leaveApp = () =>
    page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    })

  await page.goto(`http://localhost:${PORT}/`)
  await page.getByText('Nový trezor').waitFor()
  check(!(await page.locator('.titlebar').count()), 'no desktop title bar on the phone')
  await shot('m01-key')
  await page.locator('#key').fill('Test.Key-1')
  await page.locator('#key-again').fill('Test.Key-1')
  await button('Vytvořit trezor').click()
  await page.locator('.vault-page').waitFor()

  // Text: list -> detail -> back
  await page.getByRole('button', { name: 'Přidat textový dokument' }).click()
  check(await page.locator('.title-edit').isVisible(), 'new document opens full screen')
  check(!(await page.locator('.tab-pane:not(.hidden) .side').count()), 'list is hidden while the document is open')
  await page.locator('.title-edit').fill('Nákup')
  await page.locator('.editor-content').click()
  await page.keyboard.type('Rohlíky a mléko')
  await shot('m02-text-detail')
  await back()
  check(await page.locator('.list li', { hasText: /^Nákup$/ }).isVisible(), 'back button returns to the list')
  await shot('m03-text-list')

  // Passwords with a renamed field
  await button('Hesla').click()
  await page.getByRole('button', { name: 'Přidat heslo' }).click()
  await page.keyboard.type('seznam.cz')
  const names = page.locator('.tab-pane:not(.hidden) input.field-name')
  await names.nth(0).fill('Web')
  await page.locator('.tab-pane:not(.hidden) input[type="password"]').fill('Kx9!p2-Lm#qR7_zT')
  await shot('m04-password-detail')
  await back()
  check(await page.locator('.list li', { hasText: 'seznam.cz' }).isVisible(), 'entry listed after back')

  // Back closes a dialog first
  await page.getByRole('button', { name: 'Nastavení' }).click()
  await page.locator('.modal').waitFor()
  await shot('m05-settings')
  await back()
  check(!(await page.locator('.modal').count()), 'back closes the settings dialog')
  check(await page.locator('.vault-page').isVisible(), 'vault still open after closing the dialog')

  // Leaving the app saves the edit and locks
  await button('Text').click()
  await page.locator('.list li', { hasText: /^Nákup$/ }).click()
  await page.locator('.editor-content').click()
  await page.keyboard.press('End')
  await page.keyboard.type(' a chleba')
  await leaveApp()
  await page.locator('#key').waitFor()
  check(true, 'leaving the app locks it')
  await unlock('Test.Key-1')
  await page.locator('.list li', { hasText: /^Nákup$/ }).click()
  check((await page.locator('.editor-content').textContent()).includes('a chleba'), 'edit made just before leaving was saved')
  await back()

  // Wrong key
  await page.getByRole('button', { name: /Zamknout/ }).click()
  await unlock('wrong-key')
  check(!(await page.locator('.list li', { hasText: /^Nákup$/ }).count()), 'wrong key shows other content')
  await shot('m06-wrong-key')
  await page.getByRole('button', { name: /Zamknout/ }).click()
  await unlock('Test.Key-1')

  // Fingerprint
  await page.getByRole('button', { name: 'Nastavení' }).click()
  await page.getByRole('tab', { name: 'Zabezpečení' }).click()
  await page.getByRole('button', { name: 'Zapnout' }).click()
  await page.getByText('Stav: zapnuto').waitFor()
  await shot('m07-settings-security')
  await back()
  await page.getByRole('button', { name: /Zamknout/ }).click()
  await page.locator('.vault-page').waitFor()
  check(await page.locator('.list li', { hasText: /^Nákup$/ }).isVisible(), 'fingerprint unlocks the vault it was turned on in')

  // Help opens on the Android tab
  await page.locator('.help-button').click()
  await page.getByText('Nápověda OKpass – Android').waitFor()
  check((await page.locator('.help').textContent()).includes('cz.opikula.okpass'), 'help shows the Android client setup')
  await shot('m08-help')
  console.log(`MOBILE OK – screenshots in ${shots}`)
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  await browser.close()
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/t', '/f'])
  else server.kill()
}
