import { describe, expect, it } from 'vitest'
import { AuthError, BackendError, OfflineError } from '../src/core/backend'
import { DriveRestBackend } from '../src/core/driveRest'
import { classifyError, statusError } from '../src/core/errors'

describe('classifyError', () => {
  it.each([
    [{ response: { status: 400, data: { error: 'invalid_grant' } } }, AuthError],
    [{ response: { status: 401 } }, AuthError],
    [{ response: { status: 503 } }, OfflineError],
    [{ response: { status: 429 } }, OfflineError],
    [{ code: 'ENOTFOUND' }, OfflineError],
    [new TypeError('fetch failed'), OfflineError],
    [Object.assign(new Error('timeout'), { name: 'TimeoutError' }), OfflineError],
    [{ response: { status: 404 } }, BackendError]
  ])('maps %j', (error, type) => {
    expect(classifyError(error)).toBeInstanceOf(type)
  })

  it('keeps already classified errors', () => {
    const error = new OfflineError('x')
    expect(classifyError(error)).toBe(error)
  })

  it('maps HTTP status codes', () => {
    expect(statusError(401, '')).toBeInstanceOf(AuthError)
    expect(statusError(500, '')).toBeInstanceOf(OfflineError)
    expect(statusError(403, 'forbidden')).toBeInstanceOf(BackendError)
  })
})

describe('Drive REST backend', () => {
  it('renews an expired access token once and repeats the request', async () => {
    let token = 'old'
    let invalidated = 0
    const seen: string[] = []
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      const auth = (init.headers as Record<string, string>).Authorization
      seen.push(auth)
      if (auth === 'Bearer old') return new Response('expired', { status: 401 })
      return Response.json({ user: { permissionId: 'p1', emailAddress: 'a@b.cz', displayName: 'A' } })
    }) as typeof fetch
    const backend = new DriveRestBackend(
      {
        getToken: async () => token,
        invalidate: () => {
          invalidated++
          token = 'new'
        }
      },
      fakeFetch
    )
    expect(await backend.account()).toEqual({ id: 'p1', email: 'a@b.cz', displayName: 'A' })
    expect(invalidated).toBe(1)
    expect(seen).toEqual(['Bearer old', 'Bearer new'])
  })

  it('gives up after a second 401', async () => {
    const backend = new DriveRestBackend(
      { getToken: async () => 'bad', invalidate: () => undefined },
      (async () => new Response('no', { status: 401 })) as typeof fetch
    )
    await expect(backend.account()).rejects.toBeInstanceOf(AuthError)
  })

  it('reports a lost connection as offline', async () => {
    const backend = new DriveRestBackend(
      { getToken: async () => 't', invalidate: () => undefined },
      (async () => {
        throw new TypeError('fetch failed')
      }) as typeof fetch
    )
    await expect(backend.account()).rejects.toBeInstanceOf(OfflineError)
  })
})
