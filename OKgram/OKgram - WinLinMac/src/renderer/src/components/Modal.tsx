import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useApp, type ConfirmOptions, type PromptOptions } from '../context'

interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: number
  height?: number
  className?: string
}

// Open dialogs, topmost last: only the topmost one reacts to Escape.
const openModals: symbol[] = []

export const anyModalOpen = (): boolean => openModals.length > 0

export function Modal({ title, onClose, children, footer, width = 480, height, className = '' }: ModalProps) {
  const box = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const id = Symbol('modal')
    openModals.push(id)
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && openModals[openModals.length - 1] === id) {
        event.stopPropagation()
        close.current()
      }
    }
    window.addEventListener('keydown', onKey, true)
    box.current?.querySelector<HTMLElement>('[data-autofocus], input:not([type=radio]):not([type=checkbox]), button.primary')?.focus()
    return () => {
      openModals.splice(openModals.indexOf(id), 1)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${className}`} role="dialog" aria-modal="true" aria-label={title} ref={box} style={{ width, height }}>
        <div className="modal-title">{title}</div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  )
}

export function ConfirmDialog({ options, onDone }: { options: ConfirmOptions; onDone: (ok: boolean) => void }) {
  const { t } = useApp()
  return (
    <Modal
      title={options.title}
      onClose={() => onDone(false)}
      width={460}
      footer={
        <>
          <button type="button" data-autofocus={options.danger ? true : undefined} onClick={() => onDone(false)}>
            {t('common.cancel')}
          </button>
          <button type="button" className={options.danger ? 'danger' : 'primary'} onClick={() => onDone(true)}>
            {options.confirmText}
          </button>
        </>
      }
    >
      <p className="confirm-text">{options.text}</p>
    </Modal>
  )
}

export function PromptDialog({ options, onDone }: { options: PromptOptions; onDone: (value: string | null) => void }) {
  const { t } = useApp()
  const [value, setValue] = useState(options.value)
  const input = useRef<HTMLInputElement>(null)
  const error = options.validate?.(value) ?? null
  const submit = (): void => {
    if (!error && value.trim()) onDone(value.trim())
  }
  useEffect(() => {
    input.current?.select()
  }, [])
  return (
    <Modal
      title={options.title}
      onClose={() => onDone(null)}
      width={460}
      footer={
        <>
          <button type="button" onClick={() => onDone(null)}>
            {t('common.cancel')}
          </button>
          <button type="button" className="primary" disabled={Boolean(error) || !value.trim()} onClick={submit}>
            {options.confirmText}
          </button>
        </>
      }
    >
      {options.label && <label className="field-label">{options.label}</label>}
      <div className="row">
        <input
          ref={input}
          className="grow"
          value={value}
          maxLength={200}
          data-autofocus
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        {options.suffix && <span className="muted">{options.suffix}</span>}
      </div>
      {error && value.trim() && <p className="error-text">{error}</p>}
    </Modal>
  )
}
