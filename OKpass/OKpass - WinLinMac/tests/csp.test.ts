import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

// On the phone the UI itself talks to Google; the page policy must allow it (and WebAssembly for Argon2id).
it('lets the phone build reach Google Drive and run WebAssembly', () => {
  const html = readFileSync(join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8')
  const csp = /Content-Security-Policy"\s+content="([^"]+)"/.exec(html)![1]
  const connect = /connect-src ([^;]+)/.exec(csp)![1]
  expect(connect).toContain('https://www.googleapis.com')
  expect(connect).toContain('https://oauth2.googleapis.com')
  expect(csp).toContain("'wasm-unsafe-eval'")
})
