// Phone layout (Android build, narrow screen) and the Android back button.
import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { isNative } from './native'

const NARROW = '(max-width: 767px)'

export const isAndroid = (): boolean => api.platform === 'android'

/** True for the Android build on a phone-sized screen; tablets keep the desktop layout. */
export function usePhone(): boolean {
  const [narrow, setNarrow] = useState(() => isAndroid() && window.matchMedia(NARROW).matches)
  useEffect(() => {
    if (!isAndroid()) return
    const media = window.matchMedia(NARROW)
    const update = (): void => setNarrow(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return narrow
}

// Screens that the back button can close, innermost last.
const backHandlers: (() => void)[] = []

/** While `active`, the back button runs `handler` (unless a dialog or menu is open: that closes first). */
export function useBack(active: boolean, handler: () => void): void {
  const current = useRef(handler)
  current.current = handler
  useEffect(() => {
    if (!active) return
    const entry = (): void => current.current()
    backHandlers.push(entry)
    return () => {
      const index = backHandlers.lastIndexOf(entry)
      if (index >= 0) backHandlers.splice(index, 1)
    }
  }, [active])
}

/** One press of the back button. Returns false when nothing was left to close. */
export function handleBack(): boolean {
  if (document.querySelector('.modal, .context-menu, .sheet')) {
    // Dialogs, menus and sheets close on Escape (only the topmost one reacts).
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    return true
  }
  const top = backHandlers[backHandlers.length - 1]
  if (!top) return false
  top()
  return true
}

let installed = false

export async function installBackButton(): Promise<void> {
  if (installed || !isNative) return
  installed = true
  const { App } = await import('@capacitor/app')
  await App.addListener('backButton', () => {
    if (!handleBack()) void App.minimizeApp()
  })
}
