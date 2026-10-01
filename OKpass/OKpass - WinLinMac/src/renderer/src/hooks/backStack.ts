// Android back button: the most recently opened layer (dialog, detail view) closes first.
import { useEffect, useRef, useState } from 'react'

const handlers: { id: symbol; run: () => void }[] = []

export function useBackHandler(active: boolean, handler: () => void): void {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    if (!active) return
    const id = Symbol('back')
    handlers.push({ id, run: () => ref.current() })
    return () => {
      const index = handlers.findIndex((h) => h.id === id)
      if (index >= 0) handlers.splice(index, 1)
    }
  }, [active])
}

/** Close the topmost layer; false when there is nothing to close. */
export function handleBack(): boolean {
  const top = handlers[handlers.length - 1]
  if (!top) return false
  top.run()
  return true
}

const NARROW = '(max-width: 720px)'

/** True on phone-sized screens: lists and details are shown one at a time. */
export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches)
  useEffect(() => {
    const query = window.matchMedia(NARROW)
    const update = (): void => setNarrow(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return narrow
}
