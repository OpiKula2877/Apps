import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// The help shows the SHA-1 of the Android signing key (also on the desktop, for setting up the phone).
const sha1File = resolve(__dirname, 'android/keystore/sha1.txt')
const sha1 = existsSync(sha1File) ? readFileSync(sha1File, 'utf8').trim() : '(SHA-1 viz README)'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react()],
    define: { __SIGNING_SHA1__: JSON.stringify(sha1) }
  }
})
