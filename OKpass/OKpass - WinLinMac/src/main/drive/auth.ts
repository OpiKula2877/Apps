// Google OAuth login for a desktop app: system browser, loopback redirect and PKCE.
import { randomBytes } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname } from 'node:path'
import { CodeChallengeMethod, OAuth2Client, type Credentials } from 'google-auth-library'
import { clientSecretPath, tokenPath } from '../config'
import { AuthError } from '../../core/backend'
import { classifyError } from '../../core/errors'
import type { AuthAdapter, TokenProvider } from '../../core/platform'

/** Access only to files and folders the app created itself. */
export const SCOPES = ['https://www.googleapis.com/auth/drive.file']
const LOGIN_TIMEOUT_MS = 300_000
const TOKEN_URI = 'https://oauth2.googleapis.com/token'

export class ClientSecretError extends Error {
  constructor(readonly code: 'invalid' | 'wrong_type') {
    super(code)
    this.name = 'ClientSecretError'
  }
}

export const hasClientSecret = (): boolean => existsSync(clientSecretPath())

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
  const data = JSON.parse(readFileSync(clientSecretPath(), 'utf8'))
  const installed = data.installed ?? {}
  if (!installed.client_id) throw new ClientSecretError('invalid')
  return { clientId: installed.client_id, clientSecret: installed.client_secret ?? '' }
}

/** Store the token in the same format the Python version used. */
function saveToken(client: OAuth2Client, update: Credentials = {}): void {
  const credentials = { ...client.credentials, ...update }
  if (!credentials.refresh_token) return
  const { clientId, clientSecret } = readClient()
  const json = {
    token: credentials.access_token ?? null,
    refresh_token: credentials.refresh_token,
    token_uri: TOKEN_URI,
    client_id: clientId,
    client_secret: clientSecret,
    scopes: SCOPES,
    expiry: credentials.expiry_date ? new Date(credentials.expiry_date).toISOString() : null
  }
  mkdirSync(dirname(tokenPath()), { recursive: true })
  writeFileSync(tokenPath(), JSON.stringify(json), 'utf8')
  if (process.platform !== 'win32') chmodSync(tokenPath(), 0o600)
}

function makeClient(redirectUri?: string): OAuth2Client {
  const { clientId, clientSecret } = readClient()
  const client = new OAuth2Client({ clientId, clientSecret, redirectUri })
  client.on('tokens', (tokens) => saveToken(client, tokens))
  return client
}

/** Stored credentials, refreshed when possible. Offline, they are returned unrefreshed. */
export async function loadCredentials(): Promise<OAuth2Client | null> {
  if (!existsSync(tokenPath()) || !hasClientSecret()) return null
  let stored: Record<string, unknown>
  try {
    stored = JSON.parse(readFileSync(tokenPath(), 'utf8'))
  } catch {
    return null
  }
  if (typeof stored.refresh_token !== 'string') return null
  const client = makeClient()
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
      rmSync(tokenPath(), { force: true })
      return null
    }
  }
  return client
}

const page = (text: string): string =>
  `<!doctype html><meta charset="utf-8"><title>OKpass</title><body style="font-family:sans-serif;background:#0E0A0A;color:#F2E6E6;display:grid;place-items:center;height:100vh;margin:0"><p>${text.replace(/</g, '&lt;')}</p></body>`

/** Open the browser for Google sign-in and wait for the result. */
export async function loginInteractive(open: (url: string) => Promise<void>, successText: string): Promise<OAuth2Client> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  try {
    const client = makeClient(redirectUri)
    const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync()
    const state = randomBytes(16).toString('hex')
    const url = client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
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
    saveToken(client)
    return client
  } finally {
    server.close()
  }
}

/** Revoke the token at Google (best effort) and forget it locally. */
export async function logout(client: OAuth2Client | null): Promise<void> {
  const token = client?.credentials.refresh_token ?? client?.credentials.access_token
  if (token) {
    try {
      await fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        body: new URLSearchParams({ token }),
        signal: AbortSignal.timeout(10_000)
      })
    } catch {
      // offline: the local token is removed anyway
    }
  }
  rmSync(tokenPath(), { force: true })
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

/** Desktop sign-in: the user's OAuth client file and the system browser. */
export function createNodeAuth(open: (url: string) => Promise<void>, pickJson: () => Promise<string | null>): AuthAdapter {
  return {
    needsClientSecret: true,
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
    async load() {
      const client = await loadCredentials()
      return client ? tokenProvider(client) : null
    },
    login: async (successText) => tokenProvider(await loginInteractive(open, successText)),
    logout: (tokens) => logout((tokens as NodeTokens | null)?.client ?? null)
  }
}
