// Web build of the renderer for the Android app (Capacitor), output in dist-mobile/.
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, 'dist-mobile'),
    emptyOutDir: true,
    target: 'es2022'
  }
})
