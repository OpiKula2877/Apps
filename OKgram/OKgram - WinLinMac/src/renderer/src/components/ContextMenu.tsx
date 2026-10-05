// Right-click menu with one level of submenus; closes on a click elsewhere, Escape or scrolling.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon, type IconName } from './Icon'

export interface MenuItem {
  label: string
  icon?: IconName
  /** Colour square in front of the label (frame colours). */
  swatch?: string | null
  checked?: boolean
  danger?: boolean
  disabled?: boolean
  separatorBefore?: boolean
  onSelect?: () => void
  submenu?: MenuItem[]
}

interface Props {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

function MenuList({ items, onClose, x, y, alignRight }: { items: MenuItem[]; onClose: () => void; x: number; y: number; alignRight?: number }) {
  const box = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })
  const [open, setOpen] = useState<number | null>(null)
  const [subAt, setSubAt] = useState({ x: 0, y: 0, left: 0 })

  useLayoutEffect(() => {
    const rect = box.current?.getBoundingClientRect()
    if (!rect) return
    let left = x
    if (left + rect.width > window.innerWidth - 4) left = alignRight !== undefined ? alignRight - rect.width : window.innerWidth - rect.width - 4
    setPosition({ left: Math.max(4, left), top: Math.max(4, Math.min(y, window.innerHeight - rect.height - 4)) })
  }, [x, y, alignRight])

  return (
    <div className="context-menu" ref={box} style={position} role="menu" onMouseDown={(e) => e.stopPropagation()}>
      {items.map((item, index) => (
        <div key={`${item.label}-${index}`} className="context-item-wrap">
          {item.separatorBefore && <div className="context-separator" />}
          <button
            type="button"
            role="menuitem"
            disabled={item.disabled}
            className={`${item.danger ? 'tone-danger-text' : ''} ${open === index ? 'open' : ''}`}
            onMouseEnter={(e) => {
              if (!item.submenu) return setOpen(null)
              const rect = e.currentTarget.getBoundingClientRect()
              setSubAt({ x: rect.right + 2, y: rect.top - 5, left: rect.left - 2 })
              setOpen(index)
            }}
            onClick={(e) => {
              if (item.submenu) {
                const rect = e.currentTarget.getBoundingClientRect()
                setSubAt({ x: rect.right + 2, y: rect.top - 5, left: rect.left - 2 })
                return setOpen(index)
              }
              onClose()
              item.onSelect?.()
            }}
          >
            <span className="context-check">{item.checked ? <Icon name="check" size={14} /> : null}</span>
            {item.swatch !== undefined && <span className="swatch-dot" style={item.swatch ? { background: item.swatch } : undefined} />}
            {item.icon && <Icon name={item.icon} size={15} />}
            <span className="context-label">{item.label}</span>
            {item.submenu && <Icon name="forward" size={14} />}
          </button>
        </div>
      ))}
      {open !== null && items[open]?.submenu && <MenuList items={items[open].submenu!} onClose={onClose} x={subAt.x} y={subAt.y} alignRight={subAt.left} />}
    </div>
  )
}

export function ContextMenu({ x, y, items, onClose }: Props) {
  useEffect(() => {
    const close = (): void => onClose()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    window.addEventListener('wheel', close, { passive: true })
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('wheel', close)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [onClose])
  return <MenuList items={items} onClose={onClose} x={x} y={y} />
}

export interface MenuState {
  x: number
  y: number
  items: MenuItem[]
}
