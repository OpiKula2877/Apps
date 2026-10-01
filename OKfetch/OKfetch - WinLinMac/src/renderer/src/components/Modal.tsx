import { useEffect, useRef, type ReactNode } from 'react'
import { useApp, type ConfirmOptions } from '../context'

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
    box.current?.querySelector<HTMLElement>('[data-autofocus], input, textarea, button.primary')?.focus()
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
      width={440}
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
