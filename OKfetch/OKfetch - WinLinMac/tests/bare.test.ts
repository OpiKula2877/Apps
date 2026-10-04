// The phone core under the Bare runtime: builds tests/bare/run.ts like the Android worklet and runs it in Bare.
import { execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { startFakeRelay } from './helpers/fakeRelay'

const ROOT = join(__dirname, '..')
const RUNTIME = `bare-runtime-${process.platform}-${process.arch}`
const BARE = join(ROOT, 'mobile-worklet', 'node_modules', RUNTIME, 'bin', process.platform === 'win32' ? 'bare.exe' : 'bare')
// The runtime comes with the worklet packages (`npm install` in mobile-worklet/).
const hasBare = existsSync(BARE)
if (!hasBare) console.warn(`Bare test skipped: ${RUNTIME} is missing – run \`npm install\` in mobile-worklet/.`)

describe('phone core in Bare', () => {
  it.runIf(hasBare)('passes the phone scenario (contact, messages, file, backup, restart, lost key, relay fallback)', async () => {
    execFileSync(process.execPath, [join(ROOT, 'scripts', 'build-worklet.mjs'), '--test'], { cwd: ROOT, stdio: 'pipe' })
    const relay = await startFakeRelay()
    // Async spawn: the relay in this process has to keep answering while Bare runs.
    const run = await new Promise<{ stdout: string; stderr: string; status: number | null }>((resolve) => {
      const child = spawn(BARE, [join(ROOT, 'mobile-worklet', 'build', 'test-bare.js'), relay.url], { cwd: join(ROOT, 'mobile-worklet') })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (d) => (stdout += d))
      child.stderr.on('data', (d) => (stderr += d))
      const timer = setTimeout(() => child.kill(), 150_000)
      child.on('close', (status) => {
        clearTimeout(timer)
        resolve({ stdout, stderr, status })
      })
    })
    await relay.close()
    const output = `${run.stdout}\n${run.stderr}`
    const failed = output.split('\n').find((line) => line.startsWith('FAIL'))
    expect(failed, output.slice(-3000)).toBeUndefined()
    expect(output).toContain('DONE')
    expect(run.status).toBe(0)
  }, 240_000)
})
