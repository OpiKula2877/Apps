import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import { useRef, type MouseEvent, type ReactNode } from 'react'
import { api } from '../api'
import { Icon } from '../components/Icon'
import { useApp } from '../context'
import { editorExtensions } from './editorExtensions'

const MOD = api.platform === 'macos' ? '⌘' : 'Ctrl+'

interface ToolProps {
  active?: boolean
  title: string
  onRun: () => void
  children: ReactNode
  className?: string
}

/** Toolbar button that keeps the focus (and selection) in the editor. */
function Tool({ active, title, onRun, children, className = '' }: ToolProps) {
  return (
    <button
      type="button"
      className={`tool ${active ? 'checked' : ''} ${className}`}
      title={title}
      aria-pressed={active}
      onMouseDown={(e: MouseEvent) => e.preventDefault()}
      onClick={onRun}
    >
      {children}
    </button>
  )
}

export function RichEditor({ html, onChange }: { html: string; onChange: (html: string) => void }) {
  const { t } = useApp()
  const changed = useRef(onChange)
  changed.current = onChange
  const editor = useEditor({
    extensions: editorExtensions,
    content: html,
    onUpdate: ({ editor: e }) => changed.current(e.getHTML()),
    editorProps: { attributes: { class: 'editor-content', spellcheck: 'false' } }
  })
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            h1: e.isActive('heading', { level: 1 }),
            h2: e.isActive('heading', { level: 2 }),
            bold: e.isActive('bold'),
            italic: e.isActive('italic')
          }
        : null
  })
  if (!editor || !state) return null
  const run = (): ReturnType<typeof editor.chain> => editor.chain().focus()

  return (
    <div className="rich-editor">
      <div className="editor-toolbar">
        <Tool active={!state.h1 && !state.h2} title={`${t('editor.normal')} (${MOD}0)`} onRun={() => run().setParagraph().run()}>
          {t('editor.normal')}
        </Tool>
        <Tool active={state.h1} title={`${t('editor.heading')} (${MOD}1)`} onRun={() => run().setHeading({ level: 1 }).run()}>
          {t('editor.heading')}
        </Tool>
        <Tool active={state.h2} title={`${t('editor.subheading')} (${MOD}2)`} onRun={() => run().setHeading({ level: 2 }).run()}>
          {t('editor.subheading')}
        </Tool>
        <span className="separator" />
        <Tool active={state.bold} title={`${t('editor.bold')} (${MOD}B)`} className="tool-square bold" onRun={() => run().toggleBold().run()}>
          B
        </Tool>
        <Tool active={state.italic} title={`${t('editor.italic')} (${MOD}I)`} className="tool-square italic" onRun={() => run().toggleItalic().run()}>
          I
        </Tool>
        <span className="separator" />
        <Tool title={`${t('editor.outdent')} (Shift+Tab)`} className="tool-square" onRun={() => run().outdent().run()}>
          <Icon name="outdent" size={16} />
        </Tool>
        <Tool title={`${t('editor.indent')} (Tab)`} className="tool-square" onRun={() => run().indent().run()}>
          <Icon name="indent" size={16} />
        </Tool>
      </div>
      <EditorContent editor={editor} className="editor-area" />
    </div>
  )
}
