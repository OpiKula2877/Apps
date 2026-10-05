// End-to-end smoke test of the built app (run `npm run smoke`).
// Uses a local library in a temporary folder, so no Google account is touched.
// Screenshots land in tests/smoke/output (or OKGRAM_SHOTS).
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import electronPath from 'electron'
import { _electron as electron } from 'playwright-core'

const root = resolve(import.meta.dirname, '..', '..')
const work = mkdtempSync(join(tmpdir(), 'okgram-smoke-'))
const shots = process.env.OKGRAM_SHOTS || join(import.meta.dirname, 'output')
const library = join(work, 'library')
mkdirSync(shots, { recursive: true })
mkdirSync(join(library, 'Léto 2026'), { recursive: true })

function check(condition, message) {
  if (!condition) throw new Error(`CHECK FAILED: ${message}`)
  console.log(`ok - ${message}`)
}

// --- test pictures: small landscapes drawn pixel by pixel --------------------
function png(width, height, draw) {
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0
    for (let x = 0; x < width; x++) {
      const [r, g, b] = draw(x / width, y / height)
      const at = y * (width * 3 + 1) + 1 + x * 3
      raw[at] = r
      raw[at + 1] = g
      raw[at + 2] = b
    }
  }
  const chunk = (type, data) => {
    const head = Buffer.alloc(8)
    head.writeUInt32BE(data.length)
    head.write(type, 4, 'ascii')
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])))
    return Buffer.concat([head, data, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width)
  ihdr.writeUInt32BE(height, 4)
  ihdr.set([8, 2, 0, 0, 0], 8)
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

function landscape(hue, sunX, hills) {
  const sky = (t) => [Math.round(40 + 160 * t * hue[0]), Math.round(60 + 120 * t * hue[1]), Math.round(120 + 100 * hue[2])]
  return (x, y) => {
    const dx = x - sunX
    const dy = y - 0.3
    if (dx * dx + dy * dy < 0.006) return [255, 214, 90]
    const ground = 0.62 + 0.08 * Math.sin(x * hills * Math.PI)
    if (y > ground) return [Math.round(30 + 40 * hue[0]), Math.round(90 + 60 * (1 - y)), Math.round(40 + 30 * hue[2])]
    return sky(1 - y)
  }
}

const hues = [
  [1, 0.4, 0.3], [0.2, 0.6, 1], [0.9, 0.9, 0.2], [0.5, 0.3, 0.9], [0.1, 0.9, 0.6], [1, 0.7, 0.8],
  [0.6, 0.6, 0.6], [0.95, 0.5, 0.1], [0.3, 0.8, 0.4], [0.7, 0.2, 0.5], [0.4, 0.4, 1], [0.8, 0.8, 0.9]
]
hues.forEach((hue, i) => {
  const wide = i % 3 !== 2
  writeFileSync(join(library, `Výlet ${String(i + 1).padStart(2, '0')}.png`), png(wide ? 480 : 300, wide ? 320 : 420, landscape(hue, 0.2 + (i % 5) * 0.15, 2 + (i % 4))))
})
for (let i = 0; i < 3; i++) writeFileSync(join(library, 'Léto 2026', `Moře ${i + 1}.png`), png(400, 300, landscape([0.1, 0.5 + i * 0.2, 1], 0.7, 1 + i)))
writeFileSync(
  join(library, 'logo.svg'),
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><rect width="200" height="200" rx="36" fill="#000"/><circle cx="78" cy="100" r="38" fill="none" stroke="#fff" stroke-width="16"/><path d="M124 58v84M124 100l40-42M124 100l40 42" stroke="#fff" stroke-width="16" fill="none"/></svg>'
)
writeFileSync(join(library, 'tečka.gif'), Buffer.from('47494638396101000100800000ffffff00000021f90401000000002c00000000010001000002024401003b', 'hex'))
writeFileSync(join(library, 'poznámky.txt'), 'not media')

const cfg = join(work, 'cfg')
mkdirSync(cfg, { recursive: true })
writeFileSync(join(cfg, 'settings.json'), JSON.stringify({ sources: [{ id: 'local0', kind: 'local', name: 'Knihovna', path: library }], sync_minutes: 0, theme: 'opikula' }))

const shot = (page, name) => page.screenshot({ path: join(shots, `${name}.png`) })
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

/** A two-second WebM made in the window with a canvas and MediaRecorder. */
async function recordVideo(page) {
  return page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = 360
    const ctx = canvas.getContext('2d')
    const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: 'video/webm;codecs=vp8' })
    const chunks = []
    recorder.ondataavailable = (e) => chunks.push(e.data)
    recorder.start(100)
    for (let frame = 0; frame < 60; frame++) {
      ctx.fillStyle = `hsl(${frame * 6}, 70%, 35%)`
      ctx.fillRect(0, 0, 640, 360)
      ctx.fillStyle = '#c8102e'
      ctx.beginPath()
      ctx.arc(60 + frame * 9, 180, 50, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#fff'
      ctx.font = 'bold 48px monospace'
      ctx.fillText('OKgram', 220, 80)
      await new Promise((r) => setTimeout(r, 33))
    }
    recorder.stop()
    await new Promise((r) => (recorder.onstop = r))
    const blob = new Blob(chunks, { type: 'video/webm' })
    const url = await new Promise((r) => {
      const reader = new FileReader()
      reader.onload = () => r(reader.result)
      reader.readAsDataURL(blob)
    })
    return String(url).split(',')[1]
  })
}

let app
try {
  app = await electron.launch({
    executablePath: electronPath,
    args: [root],
    cwd: root,
    env: { ...process.env, OKGRAM_CONFIG_DIR: cfg, OKGRAM_CACHE_DIR: join(work, 'cache') }
  })
  const errors = []
  const page = await app.firstWindow()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ width: 1280, height: 800 }).catch(() => {})
  await page.locator('.grid-cell').first().waitFor({ timeout: 30000 })
  await sleep(1500)
  check((await page.locator('.grid-cell').count()) === 17, 'media tab shows all 17 supported files (subfolder included, .txt skipped)')
  await shot(page, '01-media')

  writeFileSync(join(library, 'Klip.webm'), Buffer.from(await recordVideo(page), 'base64'))
  await page.locator('.grid-cell', { hasText: 'Klip.webm' }).waitFor({ timeout: 20000 })
  check(true, 'a file copied into the folder appears by itself')
  await sleep(4000)
  check((await page.locator('.grid-cell', { hasText: 'Klip.webm' }).locator('img').count()) === 1, 'video got a thumbnail')

  // right-click menu: star and colour frame
  await page.locator('.grid-cell', { hasText: 'Výlet 01.png' }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Barevný rámeček' }).hover()
  await sleep(200)
  await shot(page, '02-context-menu')
  await page.getByRole('menuitem', { name: 'Červený' }).click()
  await page.locator('.grid-cell', { hasText: 'Výlet 02.png' }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Přidat hvězdičku' }).click()
  await sleep(300)
  check((await page.locator('.badge-star').count()) === 1, 'star badge shows')
  check((await page.locator('.thumb.framed').count()) === 1, 'colour frame shows')

  // search and filters
  await page.getByPlaceholder('Hledat', { exact: true }).fill('moře')
  await sleep(200)
  check((await page.locator('.grid-cell').count()) === 3, 'search finds the three files in the subfolder')
  await page.getByPlaceholder('Hledat', { exact: true }).fill('')
  await page.getByRole('button', { name: /Oblíbené/ }).first().click()
  check((await page.locator('.grid-cell').count()) === 1, 'favourites filter')
  await page.getByRole('button', { name: /Oblíbené/ }).first().click()

  // selection
  await page.locator('.grid-cell', { hasText: 'Výlet 03.png' }).click({ modifiers: ['Control'] })
  await page.locator('.grid-cell', { hasText: 'Výlet 05.png' }).click({ modifiers: ['Shift'] })
  await sleep(200)
  check((await page.getByText('Vybráno: 3').count()) === 1, 'ctrl+click and shift+click select a range')
  await shot(page, '03-selection')
  await page.keyboard.press('Escape')

  // list view
  await page.getByRole('button', { name: 'Seznam', exact: true }).click()
  await sleep(400)
  await shot(page, '04-list')
  await page.getByRole('button', { name: 'Mřížka', exact: true }).click()

  // albums
  await page.getByRole('button', { name: 'Alba', exact: true }).click()
  await page.getByRole('button', { name: 'Vytvořit první album' }).click()
  await page.getByPlaceholder('např. Dovolená 2026').fill('Hory 2026')
  await page.getByRole('radio', { name: 'Hory' }).click()
  await page.getByRole('radio', { name: 'Modrý' }).click()
  await shot(page, '05-album-dialog')
  await page.getByRole('button', { name: 'Vytvořit', exact: true }).click()
  await page.getByRole('heading', { name: 'Hory 2026' }).waitFor()
  await page.getByRole('button', { name: 'Média', exact: true }).click()
  for (const name of ['Výlet 04.png', 'Výlet 07.png', 'Klip.webm']) {
    await page.locator('.grid-cell', { hasText: name }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Přidat do alba' }).hover()
    await page.getByRole('menuitem', { name: 'Hory 2026' }).click()
  }
  await page.getByRole('button', { name: 'Alba', exact: true }).click()
  await sleep(800)
  check((await page.locator('.tab-pane:not(.hidden) .grid-cell').count()) === 3, 'album holds the three added files')
  await shot(page, '06-album')
  await page.locator('.tree-row', { hasText: 'Oblíbené' }).click()
  await sleep(300)
  check((await page.locator('.tab-pane:not(.hidden) .grid-cell').count()) === 1, 'smart album Favourites')

  // viewer window
  await page.getByRole('button', { name: 'Média', exact: true }).click()
  const opened = app.waitForEvent('window')
  await page.locator('.grid-cell', { hasText: 'Výlet 01.png' }).click()
  const viewer = await opened
  viewer.on('pageerror', (error) => errors.push(`viewer: ${error.message}`))
  await viewer.locator('.image-full').waitFor()
  await sleep(1200)
  await shot(viewer, '07-viewer')
  await viewer.keyboard.press('i')
  await viewer.keyboard.press('ArrowRight')
  await sleep(800)
  await shot(viewer, '08-viewer-info')
  await page.locator('.grid-cell', { hasText: 'Klip.webm' }).click()
  await viewer.locator('video').waitFor()
  await sleep(1500)
  check(await viewer.locator('video').evaluate((v) => v.readyState >= 2 && !v.error), 'video plays in the viewer')
  await shot(viewer, '09-video')
  await viewer.locator('.titlebar-close').click()

  // settings and help
  await page.getByRole('button', { name: 'Nastavení' }).click()
  await shot(page, '10-settings')
  await page.getByRole('tab', { name: 'Vzhled' }).click()
  await page.getByRole('radio', { name: 'Světlý' }).check()
  await sleep(300)
  await shot(page, '11-settings-light')
  await page.getByRole('radio', { name: 'OpiKula style' }).check()
  await page.getByRole('tab', { name: 'Úložiště' }).click()
  await sleep(800)
  await shot(page, '12-settings-storage')
  await page.getByRole('button', { name: 'Zavřít', exact: true }).click()
  await page.locator('.help-button').click()
  await sleep(300)
  await shot(page, '13-help')
  await page.getByRole('button', { name: 'Zavřít', exact: true }).click()
  await sleep(1500)

  const data = JSON.parse(readFileSync(join(library, 'okgram.json'), 'utf8'))
  check(data.albums.length === 1 && data.albums[0].items.length === 3 && data.albums[0].icon === 'mountain', 'okgram.json holds the album')
  check(data.items['Výlet 02.png']?.star === true && data.items['Výlet 01.png']?.color === 'red', 'okgram.json holds the star and frame')

  // a second folder as another source: the album shows files from both, the tick filters
  const second = join(work, 'second')
  mkdirSync(second)
  writeFileSync(join(second, 'Druhá.png'), png(300, 200, landscape([0.9, 0.2, 0.2], 0.5, 3)))
  await page.getByRole('button', { name: 'Přidat zdroj' }).click()
  await page.getByRole('button', { name: /Složka v počítači/ }).click()
  await shot(page, '14-add-source')
  // The folder picker is a system dialog: answer it from the main process.
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
  }, second)
  await page.getByRole('button', { name: 'Vybrat…' }).click()
  await page.getByRole('dialog').locator('input:not([type])').nth(1).fill('Druhá složka')
  await page.getByRole('button', { name: 'Přidat', exact: true }).click()
  await page.locator('.source-row', { hasText: 'Druhá složka' }).waitFor()
  await sleep(800)
  check((await page.locator('.source-row').count()) === 2, 'second source added')
  check((await page.locator('.tab-pane:not(.hidden) .grid-cell').count()) === 19, 'media of both sources are shown')
  await page.locator('.source-row', { hasText: 'Druhá složka' }).getByRole('checkbox').uncheck()
  await sleep(400)
  check((await page.locator('.tab-pane:not(.hidden) .grid-cell').count()) === 18, 'unticked source is hidden')
  await page.locator('.source-row', { hasText: 'Druhá složka' }).getByRole('checkbox').check()
  await page.getByRole('button', { name: /^Nahrát/ }).first().click()
  await page.getByText('Kam nahrát?').waitFor()
  check(true, 'upload asks which source when several are ticked')
  await shot(page, '15-upload-target')
  await page.getByRole('dialog').getByRole('button', { name: 'Zrušit' }).click()

  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
  check(existsSync(join(work, 'cache')), 'thumbnail cache was written')
  const closed = new Promise((done) => app.once('close', done))
  await page.locator('.titlebar-close').click()
  await closed
  app = null
  console.log(`\nSMOKE OK – screenshots in ${shots}`)
} finally {
  if (app) await app.close().catch(() => {})
  rmSync(work, { recursive: true, force: true })
}
