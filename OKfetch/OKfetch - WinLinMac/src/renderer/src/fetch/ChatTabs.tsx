import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon, IconButton } from '../components/Icon'
import { useApp } from '../context'

export interface TabInfo {
  chatId: string
  title: string
  encrypted: boolean
  unread: number
}

interface Props {
  tabs: TabInfo[]
  active: string | null
  onSelect: (chatId: string) => void
  onClose: (chatId: string) => void
  onCloseAll: () => void
}

/** Chat tabs with close buttons; arrows appear when the tabs do not fit and scroll by one page. */
export function ChatTabs({ tabs, active, onSelect, onClose, onCloseAll }: Props) {
  const { t } = useApp()
  const strip = useRef<HTMLDivElement>(null)
  const [overflow, setOverflow] = useState({ left: false, right: false, any: false })

  const measure = useCallback(() => {
    const element = strip.current
    if (!element) return
    const any = element.scrollWidth > element.clientWidth + 1
    setOverflow({ any, left: any && element.scrollLeft > 1, right: any && element.scrollLeft + element.clientWidth < element.scrollWidth - 1 })
  }, [])

  useEffect(() => {
    const element = strip.current
    if (!element) return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    for (const child of element.children) observer.observe(child)
    element.addEventListener('scroll', measure, { passive: true })
    measure()
    return () => {
      observer.disconnect()
      element.removeEventListener('scroll', measure)
    }
  }, [measure, tabs.length])

  useEffect(() => {
    strip.current?.querySelector('.tab.checked')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active, tabs.length])

  const page = (direction: -1 | 1): void => {
    const element = strip.current
    if (element) element.scrollBy({ left: direction * element.clientWidth * 0.85, behavior: 'smooth' })
  }

  if (tabs.length === 0) return null
  return (
    <div className="chat-tabs">
      {overflow.any && <IconButton icon="chevron_left" label={t('tabs.prev')} size={16} disabled={!overflow.left} onClick={() => page(-1)} />}
      <div className="tabs chat-tab-strip" role="tablist" ref={strip}>
        {tabs.map((tab) => (
          <div key={tab.chatId} className={`tab chat-tab ${tab.chatId === active ? 'checked' : ''}`} role="tab" aria-selected={tab.chatId === active} onClick={() => onSelect(tab.chatId)} onAuxClick={(e) => e.button === 1 && onClose(tab.chatId)}>
            {tab.encrypted && <Icon name="lock" size={13} />}
            <span className="tab-title">{tab.title}</span>
            {tab.unread > 0 && <span className="badge">{tab.unread}</span>}
            <button
              type="button"
              className="tab-close"
              title={t('tabs.close')}
              aria-label={t('tabs.close')}
              onClick={(e) => {
                e.stopPropagation()
                onClose(tab.chatId)
              }}
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        ))}
      </div>
      {overflow.any && <IconButton icon="chevron_right" label={t('tabs.next')} size={16} disabled={!overflow.right} onClick={() => page(1)} />}
      <IconButton icon="close_all" label={t('tabs.close_all')} size={16} onClick={onCloseAll} />
    </div>
  )
}
