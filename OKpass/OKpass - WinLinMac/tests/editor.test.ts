// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Editor, type JSONContent } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { editorExtensions } from '../src/renderer/src/vault/editorExtensions'

const expected = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'python-vault.json'), 'utf8'))
let editor: Editor | null = null

const make = (content: string): Editor => {
  editor = new Editor({ extensions: editorExtensions, content })
  return editor
}

afterEach(() => editor?.destroy())

const text = (node: JSONContent): string => (node.content ?? []).map((n) => n.text ?? '').join('')

describe('rich text editor', () => {
  it('reads documents written by the Python (Qt) version', () => {
    const doc = make(expected.real.documents[0].html).getJSON().content as JSONContent[]
    expect(doc[0]).toMatchObject({ type: 'heading', attrs: { level: 1 } })
    expect(text(doc[0])).toBe('Hlavní cíle')
    const marks = doc[1].content!.map((n) => [n.text, (n.marks ?? []).map((m) => m.type)])
    expect(marks).toEqual([
      ['Tučně', ['bold']],
      [' a ', []],
      ['kurzívou', ['italic']]
    ])
    expect(doc[2]).toMatchObject({ type: 'paragraph', attrs: { indent: 2 } })
  })

  it('keeps indentation through its own HTML', () => {
    const html = make('<p data-indent="3">x</p><h2>y</h2>').getHTML()
    expect(html).toContain('data-indent="3"')
    const again = make(html).getJSON().content as JSONContent[]
    expect(again[0].attrs?.indent).toBe(3)
    expect(again[1]).toMatchObject({ type: 'heading', attrs: { level: 2, indent: 0 } })
  })

  it('indents and outdents the current block within limits', () => {
    const e = make('<p>a</p>')
    e.commands.setTextSelection(1)
    e.commands.indent()
    e.commands.indent()
    expect((e.getJSON().content as JSONContent[])[0].attrs?.indent).toBe(2)
    e.commands.outdent()
    e.commands.outdent()
    e.commands.outdent()
    expect((e.getJSON().content as JSONContent[])[0].attrs?.indent).toBe(0)
  })

  it('drops formatting the app does not support', () => {
    const json = make('<ul><li>item</li></ul><p><span style="color:red;font-family:Comic">x</span></p>').getJSON()
    expect(JSON.stringify(json)).not.toContain('bulletList')
    expect(JSON.stringify(json)).not.toContain('color')
  })
})
