// TipTap setup: paragraphs, headings (H1/H2), bold, italic and block indentation.
// Reads both its own HTML (data-indent) and HTML written by the Python/Qt version
// (-qt-block-indent, font-weight:700, font-style:italic).
import { Extension, type Extensions } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'

export const INDENT_WIDTH = 28
export const MAX_INDENT = 10
const INDENT_TYPES = ['paragraph', 'heading']

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    indent: {
      indent: () => ReturnType
      outdent: () => ReturnType
    }
  }
}

const clamp = (value: number): number => Math.max(0, Math.min(MAX_INDENT, Number.isFinite(value) ? value : 0))

function parseIndent(element: HTMLElement): number {
  const own = element.getAttribute('data-indent')
  if (own !== null) return clamp(parseInt(own, 10))
  const qt = /-qt-block-indent:\s*(\d+)/.exec(element.getAttribute('style') ?? '')
  return qt ? clamp(parseInt(qt[1], 10)) : 0
}

export const Indent = Extension.create({
  name: 'indent',

  addGlobalAttributes() {
    return [
      {
        types: INDENT_TYPES,
        attributes: {
          indent: {
            default: 0,
            parseHTML: parseIndent,
            renderHTML: (attributes: { indent?: number }) =>
              attributes.indent ? { 'data-indent': attributes.indent, style: `margin-left: ${attributes.indent * INDENT_WIDTH}px` } : {}
          }
        }
      }
    ]
  },

  addCommands() {
    const change =
      (delta: number) =>
      () =>
      ({ tr, state, dispatch }: { tr: import('@tiptap/pm/state').Transaction; state: import('@tiptap/pm/state').EditorState; dispatch?: unknown }) => {
        const { from, to } = state.selection
        let changed = false
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (!INDENT_TYPES.includes(node.type.name)) return true
          const next = clamp((node.attrs.indent ?? 0) + delta)
          if (next !== node.attrs.indent) {
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next })
            changed = true
          }
          return false
        })
        if (changed && dispatch) (dispatch as (t: typeof tr) => void)(tr)
        return true
      }
    return { indent: change(1), outdent: change(-1) }
  },

  addKeyboardShortcuts() {
    return {
      Tab: () => this.editor.commands.indent(),
      'Shift-Tab': () => this.editor.commands.outdent()
    }
  }
})

/** Ctrl/Cmd+0 normal text, +1 heading, +2 subheading (same as the Python version). */
export const BlockShortcuts = Extension.create({
  name: 'blockShortcuts',
  addKeyboardShortcuts() {
    return {
      'Mod-0': () => this.editor.commands.setParagraph(),
      'Mod-1': () => this.editor.commands.setHeading({ level: 1 }),
      'Mod-2': () => this.editor.commands.setHeading({ level: 2 })
    }
  }
})

export const editorExtensions: Extensions = [
  StarterKit.configure({
    heading: { levels: [1, 2] },
    blockquote: false,
    bulletList: false,
    orderedList: false,
    listItem: false,
    listKeymap: false,
    code: false,
    codeBlock: false,
    horizontalRule: false,
    strike: false,
    underline: false,
    link: false,
    trailingNode: false
  }),
  Indent,
  BlockShortcuts
]
