// Content of the profile QR code: okfetch:add?id=<identifier>&name=<user name>. No crypto imports, so the UI can use it.

const Z32 = /^[ybndrfg8ejkmcpqxot1uwisza345h769]{52}$/
const MAX_NAME = 64

export const formatQr = (id: string, name?: string): string =>
  `okfetch:add?id=${id}${name ? `&name=${encodeURIComponent(name)}` : ''}`

/** A 52-character z-base-32 identifier; the last character holds one bit, so only 'y' and 'o' are valid there. */
function cleanId(raw: string): string | null {
  const id = raw.replace(/[\s-]+/g, '').toLowerCase()
  return Z32.test(id) && (id.endsWith('y') || id.endsWith('o')) ? id : null
}

export function parseQr(text: string): { id: string; name?: string } | null {
  const raw = text.trim()
  if (!raw.toLowerCase().startsWith('okfetch:')) {
    const id = cleanId(raw)
    return id ? { id } : null
  }
  const query = raw.slice(raw.indexOf('?') + 1)
  if (!raw.includes('?')) return null
  const params = new URLSearchParams(query)
  const id = cleanId(params.get('id') ?? '')
  if (!id) return null
  const name = (params.get('name') ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, MAX_NAME)
  return name ? { id, name } : { id }
}
