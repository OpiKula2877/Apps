// TipTap setup for the message composer: paragraphs, headings (H1/H2), bold, italic, links and block indentation.
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
  return own !== null ? clamp(parseInt(own, 10)) : 0
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

/** Ctrl/Cmd+0 normal text, +1 heading, +2 subheading. */
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

/** Enter sends, Shift+Enter inserts a line break. The handler is looked up at the time of the key press. */
export function sendOnEnter(getHandler: () => (() => void) | undefined): Extension {
  return Extension.create({
    name: 'sendOnEnter',
    priority: 1000,
    addKeyboardShortcuts() {
      return {
        Enter: () => {
          const handler = getHandler()
          if (!handler) return false
          handler()
          return true
        }
      }
    }
  })
}

export const LINK_PROTOCOLS = ['http', 'https', 'mailto']

export function baseExtensions(): Extensions {
  return [
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
      link: { openOnClick: false, autolink: true, protocols: LINK_PROTOCOLS, HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: null } },
      trailingNode: false
    }),
    Indent,
    BlockShortcuts
  ]
}

/** Add "https://" to a link typed without a scheme; null when the address is not usable. */
export function normalizeLink(raw: string): string | null {
  const text = raw.trim()
  if (!text) return null
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? `mailto:${text}` : `https://${text}`
  return /^(https?:\/\/|mailto:)\S+$/i.test(candidate) ? candidate : null
}
