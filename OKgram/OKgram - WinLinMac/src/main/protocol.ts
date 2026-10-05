// okgram://thumb/<id>?v=<version> and okgram://media/<id>: the windows show photos and stream
// videos through these URLs, without file or network access of their own.
// Range requests are passed on, so seeking in a video downloads only what is needed.
import { protocol } from 'electron'
import type { Controller } from './controller'

export const SCHEME = 'okgram'

/** Must run before the app is ready. */
export function registerScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
  ])
}

const CORS = { 'Access-Control-Allow-Origin': '*' }

export function handleScheme(controller: Controller): void {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url)
    let id: string
    try {
      id = decodeURIComponent(url.pathname.slice(1))
    } catch {
      return new Response('Bad request', { status: 400 })
    }
    if (url.hostname === 'thumb') {
      const thumb = await controller.thumbnail(id).catch(() => null)
      if (!thumb) return new Response('Not found', { status: 404, headers: CORS })
      return new Response(thumb.bytes as BodyInit, { headers: { ...CORS, 'Content-Type': thumb.type, 'Cache-Control': 'private, max-age=86400' } })
    }
    if (url.hostname === 'media') {
      const response = await controller.openMedia(id, request.headers.get('range'), request.signal)
      response.headers.set('Access-Control-Allow-Origin', '*')
      return response
    }
    return new Response('Not found', { status: 404 })
  })
}
