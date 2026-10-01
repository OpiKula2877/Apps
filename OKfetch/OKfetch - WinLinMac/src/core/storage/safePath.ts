// Resolve an untrusted path below a root folder; anything that escapes the root gives null.
import { existsSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

/** Resolve a request path to a file inside `root`, or null. */
export function resolveInside(root: string, requestPath: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(requestPath)
  } catch {
    return null
  }
  const base = resolve(root)
  const target = resolve(join(base, ...decoded.split('/').filter(Boolean)))
  const rel = relative(base, target)
  if (!rel || rel.startsWith('..') || rel.includes(`..${sep}`) || resolve(base, rel) !== target) return null
  return existsSync(target) && statSync(target).isFile() ? target : null
}
