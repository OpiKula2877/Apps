// Build the signed release APK and copy it to ../OKfetch - Android/OKfetch.apk.
// Run `npm run apk` (web build, worklet, cap sync, then this). Needs a JDK 17+ (JAVA_HOME, or the one in
// %LOCALAPPDATA%\OKpass-build) and the Android SDK (android/local.properties or ANDROID_HOME).
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const android = join(root, 'android')
if (!existsSync(join(android, 'keystore.properties'))) {
  console.error('android/keystore.properties is missing – the APK cannot be signed.')
  process.exit(1)
}
if (!existsSync(join(android, 'app', 'libs', 'bare-kit', 'classes.jar'))) {
  console.error('android/app/libs/bare-kit is missing – unpack android/bare-kit from the Bare Kit release (prebuilds.zip) there.')
  process.exit(1)
}

const env = { ...process.env }
if (!env.JAVA_HOME && process.env.LOCALAPPDATA) {
  const tools = join(process.env.LOCALAPPDATA, 'OKpass-build')
  const jdk = existsSync(tools) ? readdirSync(tools).find((name) => name.startsWith('jdk') && statSync(join(tools, name)).isDirectory()) : null
  if (jdk) env.JAVA_HOME = join(tools, jdk)
}

const windows = process.platform === 'win32'
const gradle = windows ? `"${join(android, 'gradlew.bat')}"` : './gradlew'
const result = spawnSync(gradle, ['assembleRelease', '--no-daemon', '--console=plain'], { cwd: android, stdio: 'inherit', shell: windows, env })
if (result.status !== 0) process.exit(result.status ?? 1)

const apk = join(android, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')
const target = join(root, '..', 'OKfetch - Android')
mkdirSync(target, { recursive: true })
copyFileSync(apk, join(target, 'OKfetch.apk'))
console.log(`APK: ${join(target, 'OKfetch.apk')} (${(statSync(apk).size / 1048576).toFixed(1)} MB)`)
