import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import { forwardRef, useImperativeHandle, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { api } from '../api'
import { Icon } from '../components/Icon'
import { useApp } from '../context'
import { baseExtensions, normalizeLink, sendOnEnter } from './editorExtensions'

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
    <button type="button" className={`tool ${active ? 'checked' : ''} ${className}`} title={title} aria-pressed={active} onMouseDown={(e: MouseEvent) => e.preventDefault()} onClick={onRun}>
      {children}
    </button>
  )
}

export interface RichEditorHandle {
  clear(): void
  focus(): void
  html(): string
}

interface Props {
  /** Called with the HTML after every change. */
  onChange: (html: string) => void
  /** Enter calls this (Shift+Enter inserts a line break). */
  onEnter?: () => void
  placeholder?: string
}

export const RichEditor = forwardRef<RichEditorHandle, Props>(function RichEditor({ onChange, onEnter, placeholder }, ref) {
  const { t } = useApp()
  const changed = useRef(onChange)
  changed.current = onChange
  const enter = useRef(onEnter)
  enter.current = onEnter
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkText, setLinkText] = useState('')
  const extensions = useMemo(() => [...baseExtensions(), sendOnEnter(() => enter.current)], [])
  const editor = useEditor({
    extensions,
    content: '',
    onUpdate: ({ editor: e }) => changed.current(e.getHTML()),
    editorProps: { attributes: { class: 'editor-content', spellcheck: 'false', 'data-placeholder': placeholder ?? '' } }
  })
  useImperativeHandle(
    ref,
    () => ({
      clear: () => {
        editor?.commands.clearContent(true)
        changed.current('')
      },
      focus: () => editor?.commands.focus(),
      html: () => editor?.getHTML() ?? ''
    }),
    [editor]
  )
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            h1: e.isActive('heading', { level: 1 }),
            h2: e.isActive('heading', { level: 2 }),
            bold: e.isActive('bold'),
            italic: e.isActive('italic'),
            link: e.isActive('link')
          }
        : null
  })
  if (!editor || !state) return null
  const run = (): ReturnType<typeof editor.chain> => editor.chain().focus()

  const openLink = (): void => {
    setLinkText(editor.getAttributes('link').href ?? '')
    setLinkOpen(true)
  }
  const applyLink = (): void => {
    const href = normalizeLink(linkText)
    if (href) run().extendMarkRange('link').setLink({ href }).run()
    else run().extendMarkRange('link').unsetLink().run()
    setLinkOpen(false)
  }

  return (
    <div className="rich-editor composer-editor">
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
        <Tool active={state.link} title={t('editor.link')} className="tool-square" onRun={openLink}>
          <Icon name="link" size={16} />
        </Tool>
        <span className="separator" />
        <Tool title={`${t('editor.outdent')} (Shift+Tab)`} className="tool-square" onRun={() => run().outdent().run()}>
          <Icon name="outdent" size={16} />
        </Tool>
        <Tool title={`${t('editor.indent')} (Tab)`} className="tool-square" onRun={() => run().indent().run()}>
          <Icon name="indent" size={16} />
        </Tool>
      </div>
      {linkOpen && (
        <div className="link-row">
          <input
            className="grow"
            autoFocus
            value={linkText}
            placeholder="https://"
            onChange={(e) => setLinkText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                applyLink()
              } else if (e.key === 'Escape') {
                e.stopPropagation()
                setLinkOpen(false)
                editor.commands.focus()
              }
            }}
          />
          <button type="button" className="primary" onClick={applyLink}>
            {t('common.ok')}
          </button>
          <button type="button" onClick={() => setLinkOpen(false)}>
            {t('common.cancel')}
          </button>
        </div>
      )}
      <EditorContent editor={editor} className="editor-area" />
    </div>
  )
})
