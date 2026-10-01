// Starts two OKfetch windows with separate data folders that find each other through a local DHT
// (no internet needed). Usage: npm run dev:two  (builds first). Close both windows or press Ctrl+C to stop.
import { spawn, spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import electronPath from 'electron'
import createTestnet from 'hyperdht/testnet.js'

const root = resolve(import.meta.dirname, '..')
const build = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['electron-vite', 'build'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
if (build.status !== 0) process.exit(build.status ?? 1)

const testnet = await createTestnet(3)
const bootstrap = testnet.bootstrap.map((n) => `${n.host}:${n.port}`).join(',')
const children = ['A', 'B'].map((name) =>
  spawn(electronPath, [root], {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      OKFETCH_DATA_DIR: join(root, 'dev-data', name, 'data'),
      OKFETCH_CONFIG_DIR: join(root, 'dev-data', name, 'cfg'),
      OKFETCH_BOOTSTRAP: bootstrap,
      OKFETCH_FAST_KDF: '1'
    }
  })
)

let open = children.length
const finish = async () => {
  children.forEach((child) => child.kill())
  await testnet.destroy()
  process.exit(0)
}
children.forEach((child) =>
  child.on('exit', () => {
    if (--open === 0) void finish()
  })
)
process.on('SIGINT', () => void finish())
