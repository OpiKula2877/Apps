// Android-only parts: Google authorization, fingerprint, system bars and sharing.
import { registerPlugin } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { Preferences } from '@capacitor/preferences'
import { Share } from '@capacitor/share'
import { fromBase64, toBase64 } from '../../../core/bytes'
import { AuthError, BackendError, OfflineError } from '../../../core/backend'
import type { AuthAdapter, BiometricAdapter, TokenProvider } from '../../../core/platform'
import type { Translate } from '../i18n'

interface OkpassAuthPlugin {
  /** Access token for drive.file; interactive=false never shows UI. */
  authorize(options: { interactive: boolean }): Promise<{ accessToken: string }>
}

interface OkpassBiometricPlugin {
  status(): Promise<{ available: boolean; enabled: boolean }>
  store(options: { data: string; title: string; subtitle: string; cancel: string }): Promise<void>
  unlock(options: { title: string; subtitle: string; cancel: string }): Promise<{ data: string }>
  clear(): Promise<void>
}

interface OkpassWindowPlugin {
  setColors(options: { background: string; light: boolean }): Promise<void>
}

const OkpassAuth = registerPlugin<OkpassAuthPlugin>('OkpassAuth')
const OkpassBiometric = registerPlugin<OkpassBiometricPlugin>('OkpassBiometric')
export const OkpassWindow = registerPlugin<OkpassWindowPlugin>('OkpassWindow')

const SIGNED_IN = 'signedIn'
const TOKEN_LIFETIME_MS = 45 * 60_000

function authError(error: unknown): Error {
  const code = (error as { code?: string })?.code
  const message = String((error as Error)?.message ?? error)
  if (code === 'OFFLINE') return new OfflineError(message)
  if (code === 'NEEDS_CONSENT' || code === 'CANCELED') return new AuthError(message)
  return new BackendError(message)
}

class AndroidTokens implements TokenProvider {
  private token: string | null = null
  private expires = 0

  set(token: string): void {
    this.token = token
    this.expires = Date.now() + TOKEN_LIFETIME_MS
  }

  get current(): string | null {
    return this.token
  }

  async getToken(): Promise<string> {
    if (this.token && Date.now() < this.expires) return this.token
    try {
      // Google hands out a fresh token without any UI once access was granted.
      this.set((await OkpassAuth.authorize({ interactive: false })).accessToken)
      return this.token!
    } catch (error) {
      throw authError(error)
    }
  }

  invalidate(): void {
    this.token = null
  }
}

export function createAndroidAuth(): AuthAdapter {
  return {
    needsClientSecret: false,
    hasClientSecret: async () => true,
    chooseClientSecret: async () => 'cancel',
    async load() {
      const { value } = await Preferences.get({ key: SIGNED_IN })
      if (value !== '1') return null
      const tokens = new AndroidTokens()
      try {
        await tokens.getToken()
      } catch (error) {
        if (error instanceof AuthError) {
          await Preferences.remove({ key: SIGNED_IN })
          return null
        }
        // Offline: keep going with the local copy; the token is fetched later.
      }
      return tokens
    },
    async login() {
      const tokens = new AndroidTokens()
      try {
        tokens.set((await OkpassAuth.authorize({ interactive: true })).accessToken)
      } catch (error) {
        throw authError(error)
      }
      await Preferences.set({ key: SIGNED_IN, value: '1' })
      return tokens
    },
    async logout(tokens) {
      const token = (tokens as AndroidTokens | null)?.current
      if (token) {
        try {
          await fetch('https://oauth2.googleapis.com/revoke', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token }).toString(),
            signal: AbortSignal.timeout(10_000)
          })
        } catch {
          // offline: Google forgets the grant when the token expires
        }
      }
      await Preferences.remove({ key: SIGNED_IN })
    }
  }
}

export function createAndroidBiometric(t: () => Translate): BiometricAdapter {
  const texts = () => ({ title: t()('bio.prompt_title'), subtitle: t()('bio.prompt_subtitle'), cancel: t()('bio.prompt_cancel') })
  return {
    available: async () => (await OkpassBiometric.status()).available,
    enabled: async () => (await OkpassBiometric.status()).enabled,
    async store(secret) {
      try {
        await OkpassBiometric.store({ data: toBase64(secret), ...texts() })
        return true
      } catch {
        return false
      }
    },
    async unlock() {
      try {
        return fromBase64((await OkpassBiometric.unlock(texts())).data)
      } catch {
        return null
      }
    },
    clear: () => OkpassBiometric.clear()
  }
}

/** Offer the encrypted file through the Android share sheet (save to files, send, …). */
export async function shareFile(name: string, data: Uint8Array): Promise<boolean> {
  await Filesystem.writeFile({ path: name, data: toBase64(data), directory: Directory.Cache })
  const { uri } = await Filesystem.getUri({ path: name, directory: Directory.Cache })
  try {
    await Share.share({ title: name, files: [uri] })
    return true
  } catch {
    return false
  }
}
