// @vitest-environment jsdom
// Composer editor and the sanitizer that protects the reader from incoming HTML.
import { Editor } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { baseExtensions, normalizeLink } from '../src/renderer/src/editor/editorExtensions'
import { formatSize, isImage } from '../src/renderer/src/util/format'
import { countMatches, highlight, sanitizeMessage } from '../src/renderer/src/util/sanitize'

function editor(content = ''): Editor {
  return new Editor({ element: document.createElement('div'), extensions: baseExtensions(), content })
}

describe('composer editor', () => {
  it('produces headings, bold, italic and indentation', () => {
    const e = editor('<p>text</p>')
    e.commands.setHeading({ level: 1 })
    expect(e.getHTML()).toBe('<h1>text</h1>')
    e.commands.setParagraph()
    e.commands.selectAll()
    e.commands.toggleBold()
    e.commands.indent()
    expect(e.getHTML()).toContain('<strong>text</strong>')
    expect(e.getHTML()).toContain('data-indent="1"')
    e.commands.outdent()
    expect(e.getHTML()).not.toContain('data-indent')
    e.destroy()
  })

  it('makes links that do not open on click and carry a safe rel', () => {
    const e = editor('<p>text</p>')
    e.commands.selectAll()
    e.commands.setLink({ href: 'https://example.com' })
    expect(e.getHTML()).toContain('href="https://example.com"')
    expect(e.getHTML()).toContain('rel="noopener noreferrer nofollow"')
    e.destroy()
  })

  it('refuses links with a dangerous protocol', () => {
    const e = editor('<p>text</p>')
    e.commands.selectAll()
    e.commands.setLink({ href: 'javascript:alert(1)' })
    expect(e.getHTML()).not.toContain('javascript:')
    e.destroy()
  })

  it('completes typed addresses and refuses unusable ones', () => {
    expect(normalizeLink('example.com')).toBe('https://example.com')
    expect(normalizeLink('http://a.cz/x?y=1')).toBe('http://a.cz/x?y=1')
    expect(normalizeLink('jana@example.com')).toBe('mailto:jana@example.com')
    expect(normalizeLink('javascript:alert(1)')).toBeNull()
    expect(normalizeLink('file:///c:/windows')).toBeNull()
    expect(normalizeLink('   ')).toBeNull()
  })
})

describe('sanitizer for incoming messages', () => {
  it('keeps what the editor produces', () => {
    const html = '<h1>Nadpis</h1><p data-indent="2">Text <strong>tučně</strong> <em>kurzívou</em> <a href="https://example.com">odkaz</a></p>'
    const clean = sanitizeMessage(html)
    expect(clean).toContain('<h1>Nadpis</h1>')
    expect(clean).toContain('<strong>tučně</strong>')
    expect(clean).toContain('data-indent="2"')
    expect(clean).toContain('href="https://example.com"')
    expect(clean).toContain('rel="noopener noreferrer nofollow"')
  })

  it('strips scripts, handlers, styles, images, forms and dangerous links', () => {
    const attack =
      '<p onclick="alert(1)" style="position:fixed">x</p><script>alert(1)</script><img src=x onerror=alert(1)><iframe src="https://evil"></iframe>' +
      '<a href="javascript:alert(1)">j</a><a href="data:text/html,<script>alert(1)</script>">d</a><form action="https://evil"><input></form><svg onload=alert(1)></svg>' +
      '<p data-indent="999">big</p>'
    const clean = sanitizeMessage(attack)
    for (const bad of ['script', 'onclick', 'onerror', 'style', '<img', 'iframe', 'javascript:', 'data:', '<form', '<input', 'svg', 'onload', 'evil', 'data-indent']) {
      expect(clean.toLowerCase()).not.toContain(bad)
    }
    expect(clean).toContain('big')
  })

  it('highlights and counts matches case-insensitively, marking one as active', () => {
    const html = '<p>Ahoj ahoj <strong>AHOJ</strong></p>'
    expect(countMatches(html, 'ahoj')).toBe(3)
    expect(countMatches(html, '')).toBe(0)
    const marked = highlight(html, 'ahoj', 1)
    expect(marked.match(/<mark/g)).toHaveLength(3)
    expect(marked.match(/class="active"/g)).toHaveLength(1)
    expect(highlight('<p>a &lt;b&gt;</p>', 'b', null)).toContain('&lt;<mark>b</mark>&gt;')
  })
})

describe('helpers', () => {
  it('formats sizes and recognises only real images', () => {
    expect(formatSize(512)).toBe('512 B')
    expect(formatSize(1536)).toBe('1.5 KB')
    expect(isImage('image/gif', 'a.gif')).toBe(true)
    expect(isImage('image/gif', 'a.exe')).toBe(false)
    expect(isImage('application/octet-stream', 'a.png')).toBe(false)
  })
})
