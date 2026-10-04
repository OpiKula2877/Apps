// End-to-end smoke test of the built app (run `npm run smoke`).
// Two Electron instances with separate folders talk through a local DHT testnet, so nothing leaves the machine.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import electronPath from 'electron'
import createTestnet from 'hyperdht/testnet.js'
import { _electron as electron } from 'playwright-core'

const root = resolve(import.meta.dirname, '..', '..')
const work = mkdtempSync(join(tmpdir(), 'okfetch-smoke-'))
const shots = process.env.OKFETCH_SHOTS || join(work, 'shots')
mkdirSync(shots, { recursive: true })

function check(condition, message) {
  if (!condition) throw new Error(`CHECK FAILED: ${message}`)
  console.log(`ok - ${message}`)
}

// A tiny animated-looking GIF (1×1) is enough to prove the preview path.
const GIF = Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64')
writeFileSync(join(work, 'obrazek.gif'), GIF)

const testnet = await createTestnet(3)
const bootstrap = testnet.bootstrap.map((n) => `${n.host}:${n.port}`).join(',')
const apps = []

async function launch(name, extraEnv = {}) {
  const app = await electron.launch({
    executablePath: electronPath,
    args: [root],
    cwd: root,
    env: {
      ...process.env,
      OKFETCH_DATA_DIR: join(work, name, 'data'),
      OKFETCH_CONFIG_DIR: join(work, name, 'cfg'),
      OKFETCH_BOOTSTRAP: bootstrap,
      OKFETCH_FAST_KDF: '1',
      OKFETCH_RELAY: 'off',
      ...extraEnv
    }
  })
  apps.push(app)
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1180, height: 760 }).catch(() => {})
  await page.locator('.vault-header').waitFor()
  return { app, page }
}

// A window that is covered by another one can be slow to paint: bring it to the front and try again.
async function shot(page, name) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await page.screenshot({ path: join(shots, `${name}.png`), timeout: 15000 })
    } catch (error) {
      if (attempt >= 3) throw error
      await page.bringToFront()
    }
  }
}
const button = (page, name) => page.getByRole('button', { name, exact: true })

try {
  const a = await launch('adam', { OKFETCH_TEST_PICK_FILE: join(work, 'obrazek.gif') })
  const b = await launch('bara')
  await shot(a.page, '01-empty')

  // --- profiles ------------------------------------------------------------
  await a.page.evaluate(() => window.okfetch.setUsername('Adam'))
  await b.page.evaluate(() => window.okfetch.setUsername('Bára'))
  check((await b.page.evaluate(() => window.okfetch.setPassword('Tajne-Heslo-1'))) === null, 'receive password accepted')
  const bProfile = await b.page.evaluate(() => window.okfetch.getProfile())
  check(bProfile.identifier.length === 52, 'identifier has 52 characters')

  // --- add contact through the UI ---------------------------------------------
  await button(a.page, 'Přidat kontakt').click()
  const inputs = a.page.locator('.modal input')
  await inputs.nth(0).fill(bProfile.identifier)
  await a.page.locator('.modal input[type="password"]').fill('Spatne-Heslo')
  await button(a.page, 'Odeslat žádost').click()
  await a.page.getByText('Špatné heslo.').waitFor()
  check(true, 'wrong password is reported to the requester')
  await shot(a.page, '02-wrong-password')
  await a.page.getByRole('button', { name: 'Skrýt' }).click()

  await button(a.page, 'Přidat kontakt').click()
  await a.page.locator('.modal input').nth(0).fill(bProfile.identifier)
  await a.page.locator('.modal input[type="password"]').fill('Tajne-Heslo-1')
  await button(a.page, 'Odeslat žádost').click()
  await b.page.locator('.request-card', { hasText: 'Adam' }).waitFor()
  await shot(b.page, '03-request')
  await b.page.locator('.request-card', { hasText: 'Adam' }).getByRole('button', { name: 'Přijmout' }).click()
  await a.page.locator('.contact', { hasText: 'Bára' }).waitFor()
  await b.page.locator('.contact', { hasText: 'Adam' }).waitFor()
  check(true, 'request accepted: both sides have the contact')
  await a.page.locator('.contact', { hasText: 'Bára' }).locator('.status-dot.online').waitFor()
  check(true, 'presence dot is online')

  // --- encrypted chat ------------------------------------------------------------
  await a.page.locator('.contact', { hasText: 'Bára' }).locator('.kind-row', { hasText: /^Šifrovaný/ }).click()
  await a.page.locator('.chat-slot:not(.hidden) .editor-content').click()
  await a.page.keyboard.type('Ahoj Báro, tajná zpráva')
  await a.page.keyboard.press('Enter')
  await b.page.locator('.contact', { hasText: 'Adam' }).locator('.badge').waitFor()
  check(true, 'unread badge appears at the receiver')
  await shot(b.page, '04-unread')
  await b.page.locator('.contact', { hasText: 'Adam' }).locator('.kind-row', { hasText: /^Šifrovaný/ }).click()
  await b.page.locator('.bubble-text', { hasText: 'tajná zpráva' }).waitFor()
  check(true, 'encrypted message arrives')
  await a.page.locator('.bubble-meta .read-mark').waitFor()
  check(true, 'sender sees double check (read)')

  // --- GIF in the plain chat ------------------------------------------------------
  await a.page.locator('.contact', { hasText: 'Bára' }).locator('.kind-row', { hasText: /^Nešifrovaný/ }).click()
  await a.page.locator('.chat-slot:not(.hidden)').getByRole('button', { name: 'Poslat soubor' }).click()
  await b.page.locator('.contact', { hasText: 'Adam' }).locator('.kind-row', { hasText: /^Nešifrovaný/ }).click()
  await b.page.getByRole('button', { name: 'Přijmout', exact: true }).last().click()
  await b.page.locator('.chat-slot:not(.hidden) .media-thumb img').waitFor()
  check(true, 'received GIF is shown inside the chat')
  await shot(b.page, '05-gif')

  // --- selection and deletion rules ---------------------------------------------------
  await b.page.locator('.chat-slot:not(.hidden) .composer .editor-content').click()
  await b.page.keyboard.type('odpověď od Báry')
  await b.page.keyboard.press('Enter')
  await a.page.locator('.chat-slot:not(.hidden) .bubble-text', { hasText: 'odpověď od Báry' }).waitFor()
  await a.page.getByRole('button', { name: 'Vybrat zprávy' }).click()
  await a.page.locator('.chat-slot:not(.hidden) .message-row.theirs .bubble').click()
  check(await a.page.getByRole('button', { name: 'Smazat pro oba' }).isDisabled(), 'delete for both is locked when a foreign message is selected')
  await shot(a.page, '06-selection')
  await a.page.getByRole('button', { name: 'Zrušit', exact: true }).click()

  // --- search ---------------------------------------------------------------------------
  await a.page.keyboard.press('Control+F')
  await a.page.locator('.chat-search input').fill('odpověď')
  await a.page.locator('.chat-slot:not(.hidden) mark.active').waitFor()
  check(true, 'search highlights the match')
  await a.page.keyboard.press('Escape')

  // --- settings, themes, help ---------------------------------------------------------
  await button(a.page, 'Nastavení').click()
  await shot(a.page, '07-settings-profile')
  await a.page.getByRole('tab', { name: 'Vzhled' }).click()
  await shot(a.page, '08-settings-appearance')
  await a.page.getByRole('tab', { name: 'Zabezpečení' }).click()
  await shot(a.page, '09-settings-security')
  await button(a.page, 'Fetch').click()
  for (const theme of ['light', 'dark', 'opikula', 'custom']) {
    await a.page.evaluate((t) => window.okfetch.updateSettings({ theme: t }), theme)
    await a.page.reload()
    await a.page.locator('.vault-header').waitFor()
    await shot(a.page, `10-theme-${theme}`)
  }
  await a.page.evaluate(() => window.okfetch.updateSettings({ theme: 'opikula' }))
  await a.page.reload()
  await a.page.locator('.help-button').click()
  await a.page.getByText('Nápověda OKfetch – Windows').waitFor()
  await shot(a.page, '11-help')
  await a.page.keyboard.press('Escape')

  console.log(`SMOKE OK – screenshots in ${shots}`)
} catch (error) {
  console.error(error)
  process.exitCode = 1
  // What each window showed when it failed.
  for (const [i, app] of apps.entries()) {
    const page = await app.firstWindow().catch(() => null)
    if (!page) continue
    await page.screenshot({ path: join(shots, `failed-${i}.png`), timeout: 5000 }).catch(() => undefined)
    console.error(`--- window ${i}:`, (await page.locator('.modal').innerText({ timeout: 1000 }).catch(() => '(no dialog)')).slice(0, 400))
  }
  console.error(`screenshots in ${shots}`)
} finally {
  await Promise.all(apps.map((app) => app.close().catch(() => undefined)))
  await testnet.destroy()
  if (!process.env.OKFETCH_SHOTS) rmSync(work, { recursive: true, force: true })
}
