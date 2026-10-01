// Build the signed release APK and copy it to ../OKpass - Android/OKpass.apk.
// Needs JAVA_HOME (JDK 17+) and the Android SDK (android/local.properties or ANDROID_HOME).
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const android = join(root, 'android')
if (!existsSync(join(android, 'keystore.properties'))) {
  console.error('android/keystore.properties is missing – the APK cannot be signed.')
  process.exit(1)
}

const windows = process.platform === 'win32'
const gradle = windows ? `"${join(android, 'gradlew.bat')}"` : './gradlew'
const result = spawnSync(gradle, ['assembleRelease', '--no-daemon', '--console=plain'], {
  cwd: android,
  stdio: 'inherit',
  shell: windows
})
if (result.status !== 0) process.exit(result.status ?? 1)

const apk = join(android, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')
const target = join(root, '..', 'OKpass - Android')
mkdirSync(target, { recursive: true })
copyFileSync(apk, join(target, 'OKpass.apk'))
console.log(`APK: ${join(target, 'OKpass.apk')}`)
