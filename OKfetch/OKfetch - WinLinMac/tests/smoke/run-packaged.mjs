// Starts the packaged app (dist/win-unpacked) and checks that the core runs: native modules, safeStorage and the UI.
// Usage: npm run dist:win -- --dir && node tests/smoke/run-packaged.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'

const exe = resolve(import.meta.dirname, '..', '..', 'dist', 'win-unpacked', 'OKfetch.exe')
const work = mkdtempSync(join(tmpdir(), 'okfetch-packaged-'))
let app
try {
  app = await electron.launch({
    executablePath: exe,
    env: { ...process.env, OKFETCH_DATA_DIR: join(work, 'data'), OKFETCH_CONFIG_DIR: join(work, 'cfg'), OKFETCH_FAST_KDF: '1' }
  })
  const page = await app.firstWindow()
  await page.locator('.vault-header').waitFor({ timeout: 30000 })
  const profile = await page.evaluate(() => window.okfetch.getProfile())
  const security = await page.evaluate(() => window.okfetch.getSecurityInfo())
  if (profile.identifier.length !== 52) throw new Error('no identifier')
  console.log(`ok - packaged app runs, identifier ${profile.identifier.slice(0, 8)}…, key store: ${security.backend} (strong: ${security.strong})`)
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  await app?.close().catch(() => undefined)
  rmSync(work, { recursive: true, force: true })
}
