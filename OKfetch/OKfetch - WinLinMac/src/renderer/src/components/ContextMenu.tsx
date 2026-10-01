import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface MenuItem {
  label: string
  onSelect: () => void
  danger?: boolean
  separatorBefore?: boolean
}

interface Props {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

/** Right-click menu; closes on any click elsewhere, Escape or scrolling. */
export function ContextMenu({ x, y, items, onClose }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const rect = box.current?.getBoundingClientRect()
    if (!rect) return
    setPosition({ left: Math.max(4, Math.min(x, window.innerWidth - rect.width - 4)), top: Math.max(4, Math.min(y, window.innerHeight - rect.height - 4)) })
  }, [x, y])

  useEffect(() => {
    const close = (): void => onClose()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    window.addEventListener('wheel', close, { passive: true })
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('wheel', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div className="context-menu" ref={box} style={position} onMouseDown={(e) => e.stopPropagation()}>
      {items.map((item) => (
        <div key={item.label} className="context-item-wrap">
          {item.separatorBefore && <div className="context-separator" />}
          <button
            type="button"
            className={item.danger ? 'tone-danger-text' : ''}
            onClick={() => {
              onClose()
              item.onSelect()
            }}
          >
            {item.label}
          </button>
        </div>
      ))}
    </div>
  )
}
