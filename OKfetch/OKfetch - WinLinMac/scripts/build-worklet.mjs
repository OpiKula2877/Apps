// Builds the core for the Android worklet (Bare runtime).
//   node scripts/build-worklet.mjs          -> android/app/src/main/assets/okfetch.bundle + linked addons
//   node scripts/build-worklet.mjs --test   -> mobile-worklet/build/test-bare.js (Bare on this computer, fake network)
// esbuild compiles our TypeScript and maps Node built-ins to their Bare modules; bare-pack then bundles the
// npm packages and bare-link copies the native addons (sodium-native, udx-native, bare-fs, ...) for Android.
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'

const root = resolve(import.meta.dirname, '..')
const worklet = join(root, 'mobile-worklet')
const test = process.argv.includes('--test')

const alias = {
  'node:fs': 'bare-fs',
  'node:path': 'bare-path',
  'node:os': 'bare-os',
  ...(test ? { hyperswarm: join(root, 'tests', 'bare', 'fakeSwarm.ts') } : {})
}

const outfile = join(worklet, 'build', test ? 'test-bare.js' : 'okfetch-worklet.js')
mkdirSync(join(worklet, 'build'), { recursive: true })
await build({
  entryPoints: [join(root, test ? 'tests/bare/run.ts' : 'src/mobile/main.ts')],
  outfile,
  bundle: true,
  format: 'cjs',
  platform: 'neutral',
  target: 'es2022',
  mainFields: ['main', 'module'],
  packages: 'external',
  alias,
  logLevel: 'warning'
})

if (!test) {
  const assets = join(root, 'android', 'app', 'src', 'main', 'assets')
  mkdirSync(assets, { recursive: true })
  // The tools' own scripts run through Node directly: .cmd shims would split the paths with spaces.
  const run = (name, args) => execFileSync(process.execPath, [join(worklet, 'node_modules', name, 'bin.js'), ...args], { cwd: worklet, stdio: 'inherit' })
  run('bare-pack', ['--preset', 'android', '--out', join(assets, 'okfetch.bundle'), outfile])
  run('bare-link', ['--preset', 'android', '--out', join(root, 'android', 'app', 'src', 'main', 'addons')])
  console.log('worklet bundle ->', join(assets, 'okfetch.bundle'))
}
