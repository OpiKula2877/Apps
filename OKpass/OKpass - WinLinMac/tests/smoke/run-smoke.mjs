// End-to-end smoke test of the built app (run `npm run smoke`).
// Uses --local-dev with temporary folders, so no Google account is touched.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import electronPath from 'electron'
import { _electron as electron } from 'playwright-core'

const root = resolve(import.meta.dirname, '..', '..')
const work = mkdtempSync(join(tmpdir(), 'okpass-smoke-'))
const shots = process.env.OKPASS_SHOTS || join(work, 'shots')
mkdirSync(shots, { recursive: true })

function check(condition, message) {
  if (!condition) throw new Error(`CHECK FAILED: ${message}`)
  console.log(`ok - ${message}`)
}

async function launch(name, extraEnv = {}) {
  const app = await electron.launch({
    executablePath: electronPath,
    args: [root, '--local-dev', join(work, name, 'drive')],
    cwd: root,
    env: {
      ...process.env,
      OKPASS_CONFIG_DIR: join(work, name, 'cfg'),
      OKPASS_CACHE_DIR: join(work, name, 'cache'),
      ...extraEnv
    }
  })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1180, height: 760 }).catch(() => {})
  return { app, page }
}

const shot = (page, name) => page.screenshot({ path: join(shots, `${name}.png`) })
const button = (page, name) => page.getByRole('button', { name, exact: true })

async function unlock(page, key) {
  await page.locator('#key').fill(key)
  await page.locator('#key').press('Enter')
  await page.locator('.vault-page').waitFor()
}

async function lock(page) {
  await page.keyboard.press('Control+L')
  await page.locator('#key').waitFor()
}

async function closeWithButton(app, page) {
  const closed = new Promise((done) => app.once('close', done))
  await page.locator('.titlebar-close').click()
  await closed
}

try {
  // --- first run: create vault, write content ------------------------------
  let { app, page } = await launch('main')
  await page.getByText('Nový trezor').waitFor()
  await shot(page, '01-key-create')
  await page.locator('#key').fill('Test.Key-1')
  await page.locator('#key-again').fill('Test.Key-2')
  await button(page, 'Vytvořit trezor').click()
  check(await page.getByText('Klíče se neshodují.').isVisible(), 'mismatched keys are refused')
  await page.locator('#key-again').fill('Test.Key-1')
  await button(page, 'Vytvořit trezor').click()
  await page.locator('.vault-page').waitFor()

  await page.getByRole('button', { name: 'Přidat textový dokument' }).click()
  await page.locator('.title-edit').fill('Plán projektu')
  await page.locator('.editor-content').click()
  await page.keyboard.type('Hlavní cíle')
  await page.keyboard.press('Control+1')
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Normální odstavec, ')
  await page.keyboard.press('Control+B')
  await page.keyboard.type('tučně')
  await page.keyboard.press('Control+B')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Tab')
  await page.keyboard.type('Odsazený řádek')
  check((await page.locator('.editor-content h1').textContent()) === 'Hlavní cíle', 'heading created with Ctrl+1')
  check((await page.locator('.editor-content p[data-indent="1"]').count()) === 1, 'Tab indents the paragraph')
  await shot(page, '02-text')

  await button(page, 'Hesla').click()
  await page.getByRole('button', { name: 'Přidat heslo' }).click()
  const fields = page.locator('.entry-editor .field-grid')
  await page.keyboard.type('github.com')
  await fields.getByLabel('Uživatelské jméno').last().fill('opikula')
  await fields.locator('input[type="password"]').fill('Kx9!p2-Lm#qR7_zT')
  const labels = fields.locator('input.field-name')
  await labels.nth(0).fill('Web')
  await labels.nth(2).fill('Heslo k účtu')
  await page.getByRole('button', { name: 'Přidat další sloupec' }).click()
  await page.keyboard.type('PIN')
  await labels.nth(3).press('Tab')
  await page.keyboard.type('4821')
  check((await fields.locator('input[type="password"]').count()) === 1, 'renamed password field stays hidden')
  await shot(page, '03-passwords')

  // Edit and close at once: the change must survive (flush before close).
  await labels.nth(1).fill('Login')
  await closeWithButton(app, page)

  // --- second start: everything is still there ----------------------------
  ;({ app, page } = await launch('main'))
  await page.locator('#key').waitFor()
  check(!(await page.locator('#key-again').isVisible()), 'existing vault asks for the key once')
  await unlock(page, ' Test .Key-1 ')
  check(await page.locator('.list li', { hasText: 'Plán projektu' }).isVisible(), 'document kept after restart (key with spaces)')
  check((await page.locator('.editor-content p[data-indent="1"]').count()) === 1, 'indentation kept after restart')
  await button(page, 'Hesla').click()
  const names = await page.locator('.entry-editor input.field-name').evaluateAll((els) => els.map((e) => e.value))
  check(JSON.stringify(names) === JSON.stringify(['Web', 'Login', 'Heslo k účtu', 'PIN']), `renamed labels kept: ${names}`)
  await page.locator('.entry-editor input.field-name').first().fill('')
  check((await page.locator('.entry-editor input.field-name').first().getAttribute('placeholder')) === 'Název / URL', 'cleared label shows the default again')

  // --- wrong key shows other data, saving there writes nothing --------------
  await lock(page)
  await unlock(page, 'wrong-key')
  const fakeDocs = await page.locator('.tab-pane:not(.hidden) .list li').count()
  check(fakeDocs > 0, `wrong key shows plausible documents (${fakeDocs})`)
  check(!(await page.locator('.list li', { hasText: 'Plán projektu' }).isVisible()), 'wrong key does not show real documents')
  await shot(page, '04-wrong-key')
  await page.getByRole('button', { name: 'Přidat textový dokument' }).click()
  await page.keyboard.press('Control+S')
  await page.locator('.status-pill.state-saved').waitFor()
  check(true, 'fake session reports saved')

  // --- decoy key ------------------------------------------------------------
  await lock(page)
  await unlock(page, 'Test.Key-1')
  check(await page.locator('.list li', { hasText: 'Plán projektu' }).isVisible(), 'real data intact after fake session')
  await page.getByRole('button', { name: 'Nastavení' }).click()
  await page.getByRole('tab', { name: 'Zabezpečení' }).click()
  await page.getByRole('button', { name: 'Nastavit druhý klíč…' }).click()
  const decoyInputs = page.locator('.modal input[type="password"]')
  await decoyInputs.nth(0).fill('Decoy.Key')
  await decoyInputs.nth(1).fill('Decoy.Key')
  await page.locator('.modal').last().getByRole('button', { name: 'Uložit' }).click()
  await page.getByText('Stav: nastaven').waitFor()
  await shot(page, '05-settings-security')
  await page.getByRole('tab', { name: 'Vzhled' }).click()
  await shot(page, '06-settings-appearance')
  await page.keyboard.press('Escape')
  await lock(page)
  await unlock(page, 'Decoy.Key')
  check(!(await page.locator('.list li', { hasText: 'Plán projektu' }).isVisible()), 'decoy key opens a different vault')
  await shot(page, '07-decoy')

  // --- help & themes --------------------------------------------------------
  await page.locator('.help-button').click()
  await page.getByText('Nápověda OKpass – Windows').waitFor()
  await shot(page, '08-help')
  await page.keyboard.press('Escape')
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => window.okpass.updateSettings({ theme: t }), theme)
    await page.reload()
    await page.locator('.vault-page').waitFor()
    await shot(page, `09-theme-${theme}`)
  }
  await page.evaluate(() => window.okpass.updateSettings({ theme: 'opikula', language: 'en' }))
  await page.reload()
  await page.getByRole('button', { name: 'Passwords', exact: true }).waitFor()
  check(true, 'English UI after language switch')
  await page.evaluate(() => window.okpass.updateSettings({ language: 'cs' }))
  await closeWithButton(app, page)

  // --- offline first start without a local copy ------------------------------
  mkdirSync(join(work, 'offline', 'drive'), { recursive: true })
  writeFileSync(join(work, 'offline', 'drive', 'OFFLINE'), '')
  ;({ app, page } = await launch('offline'))
  await page.getByRole('button', { name: 'Zkusit znovu' }).waitFor()
  check(true, 'offline start without a copy shows retry')
  await shot(page, '10-offline')
  await app.close()

  console.log(`SMOKE OK – screenshots in ${shots}`)
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  if (!process.env.OKPASS_SHOTS) rmSync(work, { recursive: true, force: true })
}
