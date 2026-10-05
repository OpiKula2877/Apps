// UI preview in a plain browser with sample data (npm run preview:ui).
// The real renderer, with api.ts and urls.ts swapped for tests/preview/.
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^(\.\.?\/)+api$/, replacement: resolve(__dirname, 'tests/preview/api.ts') },
      { find: /^(\.\.?\/)+urls$/, replacement: resolve(__dirname, 'tests/preview/urls.ts') }
    ]
  },
  build: {
    outDir: resolve(__dirname, 'out/preview'),
    emptyOutDir: true,
    target: 'esnext'
  },
  preview: { port: 4790, strictPort: true }
})
