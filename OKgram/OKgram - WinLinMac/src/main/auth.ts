// Google OAuth for a desktop app: system browser, loopback redirect and PKCE.
// Every Google source (account) has its own refresh token, encrypted with the system key store
// (Windows DPAPI, macOS Keychain, Linux Secret Service) through Electron's safeStorage when the
// system offers it.
import { randomBytes } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname, join } from 'node:path'
import { app, safeStorage } from 'electron'
import { CodeChallengeMethod, OAuth2Client, type Credentials } from 'google-auth-library'
import { AuthError } from '../core/backend'
import type { TokenProvider } from '../core/driveRest'
import { classifyError } from '../core/errors'
import { clientSecretPath, configDir } from './config'
import type { AuthAdapter } from './hooks'

/** Access only to files and folders the app created itself. */
export const SCOPES = ['https://www.googleapis.com/auth/drive.file']
const LOGIN_TIMEOUT_MS = 300_000
const TOKEN_URI = 'https://oauth2.googleapis.com/token'

// tokens/<source id>.bin (or .json without a key store). token.bin / token.json in the settings
// folder is the single token from before sources existed.
const tokenDir = (): string => join(configDir(), 'tokens')
const plainTokenPath = (source: string): string => join(tokenDir(), `${source}.json`)
const secureTokenPath = (source: string): string => join(tokenDir(), `${source}.bin`)
const legacyPaths = (): [string, string] => [join(configDir(), 'token.bin'), join(configDir(), 'token.json')]

export class ClientSecretError extends Error {
  constructor(readonly code: 'invalid' | 'wrong_type') {
    super(code)
    this.name = 'ClientSecretError'
  }
}

/** OAuth client shipped with the app (resources/client_secret.json), used when the user has not chosen their own. */
function bundledSecretPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'client_secret.json')
    : join(app.getAppPath(), 'resources', 'client_secret.json')
}

/** The user's own client file wins over the bundled one. */
function activeSecretPath(): string | null {
  if (existsSync(clientSecretPath())) return clientSecretPath()
  return existsSync(bundledSecretPath()) ? bundledSecretPath() : null
}

export const hasClientSecret = (): boolean => activeSecretPath() !== null

export function importClientSecret(source: string): void {
  let data: unknown
  try {
    data = JSON.parse(readFileSync(source, 'utf8'))
  } catch {
    throw new ClientSecretError('invalid')
  }
  if (!data || typeof data !== 'object') throw new ClientSecretError('invalid')
  if (!('installed' in data)) throw new ClientSecretError('web' in data ? 'wrong_type' : 'invalid')
  mkdirSync(dirname(clientSecretPath()), { recursive: true })
  copyFileSync(source, clientSecretPath())
}

function readClient(): { clientId: string; clientSecret: string } {
  const path = activeSecretPath()
  if (!path) throw new ClientSecretError('invalid')
  const data = JSON.parse(readFileSync(path, 'utf8'))
  const installed = data.installed ?? {}
  if (!installed.client_id) throw new ClientSecretError('invalid')
  return { clientId: installed.client_id, clientSecret: installed.client_secret ?? '' }
}

const secure = (): boolean => {
  try {
    return safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text')
  } catch {
    return false
  }
}

function writeToken(source: string, json: Record<string, unknown>): void {
  mkdirSync(tokenDir(), { recursive: true })
  const text = JSON.stringify(json)
  if (secure()) {
    writeFileSync(secureTokenPath(source), safeStorage.encryptString(text))
    rmSync(plainTokenPath(source), { force: true })
  } else {
    writeFileSync(plainTokenPath(source), text, 'utf8')
    if (process.platform !== 'win32') chmodSync(plainTokenPath(source), 0o600)
  }
}

function readFrom(secureFile: string, plainFile: string): Record<string, unknown> | null {
  try {
    if (existsSync(secureFile)) return JSON.parse(safeStorage.decryptString(readFileSync(secureFile)))
    if (existsSync(plainFile)) return JSON.parse(readFileSync(plainFile, 'utf8'))
  } catch {
    // unreadable (e.g. another user account): sign in again
  }
  return null
}

function readToken(source: string, adoptLegacy: boolean): Record<string, unknown> | null {
  const own = readFrom(secureTokenPath(source), plainTokenPath(source))
  if (own || !adoptLegacy) return own
  // The sign-in from before sources existed belongs to the migrated Google source.
  const [legacySecure, legacyPlain] = legacyPaths()
  const legacy = readFrom(legacySecure, legacyPlain)
  if (legacy) {
    writeToken(source, legacy)
    rmSync(legacySecure, { force: true })
    rmSync(legacyPlain, { force: true })
  }
  return legacy
}

function removeToken(source: string): void {
  rmSync(secureTokenPath(source), { force: true })
  rmSync(plainTokenPath(source), { force: true })
}

function saveToken(source: string, client: OAuth2Client, update: Credentials = {}): void {
  const credentials = { ...client.credentials, ...update }
  if (!credentials.refresh_token) return
  const { clientId } = readClient()
  writeToken(source, {
    token: credentials.access_token ?? null,
    refresh_token: credentials.refresh_token,
    token_uri: TOKEN_URI,
    client_id: clientId,
    scopes: SCOPES,
    expiry: credentials.expiry_date ? new Date(credentials.expiry_date).toISOString() : null
  })
}

function makeClient(source: string, redirectUri?: string): OAuth2Client {
  const { clientId, clientSecret } = readClient()
  const client = new OAuth2Client({ clientId, clientSecret, redirectUri })
  client.on('tokens', (tokens) => saveToken(source, client, tokens))
  return client
}

/** Stored credentials of one source, refreshed when possible. Offline, they are returned unrefreshed. */
export async function loadCredentials(source: string, adoptLegacy: boolean): Promise<OAuth2Client | null> {
  if (!hasClientSecret()) return null
  const stored = readToken(source, adoptLegacy)
  if (!stored || typeof stored.refresh_token !== 'string') return null
  const client = makeClient(source)
  const expiry = typeof stored.expiry === 'string' ? Date.parse(stored.expiry.endsWith('Z') ? stored.expiry : `${stored.expiry}Z`) : NaN
  client.setCredentials({
    access_token: typeof stored.token === 'string' ? stored.token : undefined,
    refresh_token: stored.refresh_token,
    expiry_date: Number.isFinite(expiry) ? expiry : 1
  })
  try {
    await client.getAccessToken()
  } catch (error) {
    if (classifyError(error) instanceof AuthError) {
      removeToken(source)
      return null
    }
  }
  return client
}

const page = (text: string): string =>
  `<!doctype html><meta charset="utf-8"><title>OKgram</title><body style="font-family:monospace;background:#0E0A0A;color:#F2E6E6;display:grid;place-items:center;height:100vh;margin:0"><p>${text.replace(/</g, '&lt;')}</p></body>`

/** Open the browser for Google sign-in and wait for the result. */
export async function loginInteractive(source: string, open: (url: string) => Promise<void>, successText: string): Promise<OAuth2Client> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  try {
    const client = makeClient(source, redirectUri)
    const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync()
    const state = randomBytes(16).toString('hex')
    const url = client.generateAuthUrl({
      access_type: 'offline',
      // Always offer the account chooser, so another Google account can be connected.
      prompt: 'select_account consent',
      scope: SCOPES,
      state,
      code_challenge_method: CodeChallengeMethod.S256,
      code_challenge: codeChallenge
    })
    const code = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('login timed out')), LOGIN_TIMEOUT_MS)
      server.on('request', (req, res) => {
        const params = new URL(req.url ?? '/', redirectUri).searchParams
        if (params.get('state') !== state) {
          res.writeHead(400).end()
          return
        }
        clearTimeout(timer)
        const received = params.get('code')
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page(received ? successText : 'Error'))
        if (received) resolve(received)
        else reject(new Error(params.get('error') ?? 'login failed'))
      })
      open(url).catch(reject)
    })
    const { tokens } = await client.getToken({ code, codeVerifier })
    client.setCredentials(tokens)
    saveToken(source, client)
    return client
  } finally {
    server.close()
  }
}

/** Revoke the token at Google (best effort) and forget it locally. */
export async function logout(source: string, client: OAuth2Client | null): Promise<void> {
  const token = client?.credentials.refresh_token ?? client?.credentials.access_token
  if (token) {
    try {
      await fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', body: new URLSearchParams({ token }), signal: AbortSignal.timeout(10_000) })
    } catch {
      // offline: the local token is removed anyway
    }
  }
  removeToken(source)
}

interface NodeTokens extends TokenProvider {
  client: OAuth2Client
}

function tokenProvider(client: OAuth2Client): NodeTokens {
  return {
    client,
    async getToken() {
      const { token } = await client.getAccessToken()
      if (!token) throw new AuthError('no access token')
      return token
    },
    invalidate() {
      client.setCredentials({ ...client.credentials, access_token: undefined, expiry_date: 1 })
    }
  }
}

/** Desktop sign-in: the OAuth client file and the system browser. */
export function createAuth(open: (url: string) => Promise<void>, pickJson: () => Promise<string | null>): AuthAdapter {
  return {
    hasClientSecret: async () => hasClientSecret(),
    async chooseClientSecret() {
      const path = await pickJson()
      if (!path) return 'cancel'
      try {
        importClientSecret(path)
      } catch (error) {
        return error instanceof ClientSecretError ? error.code : 'invalid'
      }
      return 'ok'
    },
    async load(source, adoptLegacy) {
      const client = await loadCredentials(source, adoptLegacy)
      return client ? tokenProvider(client) : null
    },
    login: async (source, successText) => tokenProvider(await loginInteractive(source, open, successText)),
    logout: (source, tokens) => logout(source, (tokens as NodeTokens | null)?.client ?? null)
  }
}
