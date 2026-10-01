// Web build of the renderer for the Android app (Capacitor), output in dist-mobile/.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const sha1File = resolve(__dirname, 'android/keystore/sha1.txt')
const sha1 = existsSync(sha1File) ? readFileSync(sha1File, 'utf8').trim() : '(SHA-1 viz README)'

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [react()],
  define: { __SIGNING_SHA1__: JSON.stringify(sha1) },
  build: {
    outDir: resolve(__dirname, 'dist-mobile'),
    emptyOutDir: true,
    target: 'es2022'
  }
})
