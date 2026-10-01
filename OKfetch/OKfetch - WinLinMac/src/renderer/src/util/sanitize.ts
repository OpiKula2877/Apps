// Incoming message HTML is untrusted: only the tags the editor can produce survive (XSS protection).
import DOMPurify from 'dompurify'

const ALLOWED_TAGS = ['p', 'br', 'h1', 'h2', 'strong', 'em', 'b', 'i', 'a']
const ALLOWED_ATTR = ['href', 'data-indent']

let hooked = false
function ensureHook(): void {
  if (hooked) return
  hooked = true
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      node.setAttribute('rel', 'noopener noreferrer nofollow')
      node.setAttribute('target', '_blank')
    }
    const indent = node.getAttribute?.('data-indent')
    if (indent !== null && indent !== undefined && !/^(?:10|[0-9])$/.test(indent)) node.removeAttribute('data-indent')
  })
}

export function sanitizeMessage(html: string): string {
  ensureHook()
  return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR, ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i })
}

/** Number of (case-insensitive) occurrences of `query` in the visible text of the HTML. */
export function countMatches(html: string, query: string): number {
  if (!query) return 0
  const text = new DOMParser().parseFromString(sanitizeMessage(html), 'text/html').body.textContent ?? ''
  return text.toLocaleLowerCase().split(query.toLocaleLowerCase()).length - 1
}

/** Wrap occurrences of `query` in <mark>; the occurrence with index `active` also gets the class "active". */
export function highlight(html: string, query: string, active: number | null): string {
  const clean = sanitizeMessage(html)
  if (!query) return clean
  const doc = new DOMParser().parseFromString(clean, 'text/html')
  const needle = query.toLocaleLowerCase()
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)
  let index = 0
  for (const node of nodes) {
    const text = node.data
    const lower = text.toLocaleLowerCase()
    if (lower.length !== text.length || !lower.includes(needle)) continue
    const fragment = doc.createDocumentFragment()
    let from = 0
    for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, from)) {
      if (at > from) fragment.append(text.slice(from, at))
      const mark = doc.createElement('mark')
      if (index === active) mark.className = 'active'
      mark.textContent = text.slice(at, at + needle.length)
      fragment.append(mark)
      index++
      from = at + needle.length
    }
    if (from < text.length) fragment.append(text.slice(from))
    node.replaceWith(fragment)
  }
  return doc.body.innerHTML
}
