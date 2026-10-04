// Prints the network diagnostics of the phone (Settings → network) and of a desktop core next to it.
// A tool for finding out why two devices cannot connect, not a pass/fail test.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { find, freshPhone, nodes, sh, sleep, startDesktopPeer, tap } from './android-adb.mjs'

const work = mkdtempSync(join(tmpdir(), 'okfetch-android-diag-'))
let peer = null
try {
  ;({ peer } = await startDesktopPeer(join(work, 'desktop'), 'PC Tester'))
  console.log('desktop:', JSON.stringify(peer.net.diagnostics()))
  await freshPhone()
  await tap('Nastavení')
  await tap(/^Pozadí, notifikace a záloha$/)
  await find('Síť a diagnostika spojení', { scroll: true })
  for (let i = 0; i < 3; i++) sh('input swipe 540 1500 540 1100 300')
  await sleep(4500)
  const texts = nodes().map((n) => n.text).filter(Boolean)
  const start = texts.indexOf('Stav')
  console.log('phone:', texts.slice(start, start + 12).join(' | '))
} finally {
  await peer?.close().catch(() => undefined)
  rmSync(join(work, 'desktop'), { recursive: true, force: true })
}
