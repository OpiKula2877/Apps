// okfetch-file://f/<path inside storage/files>: lets the renderer show received images without file access.
// Only files below storage/files are served; everything else is refused.
import { protocol, net } from 'electron'
import { pathToFileURL } from 'node:url'
import { resolveInside } from '../core/storage/safePath'

export const FILE_SCHEME = 'okfetch-file'

/** Must run before the app is ready. */
export function registerFileScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: FILE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }])
}

export function handleFileScheme(filesRoot: () => string | null): void {
  protocol.handle(FILE_SCHEME, (request) => {
    const root = filesRoot()
    const url = new URL(request.url)
    const target = root && url.hostname === 'f' ? resolveInside(root, url.pathname) : null
    if (!target) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(target).toString())
  })
}
