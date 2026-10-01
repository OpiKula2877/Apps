import { useEffect, useRef } from 'react'

const EVENTS = ['keydown', 'mousedown', 'mousemove', 'wheel', 'touchstart'] as const

/** Call onLock after `minutes` without keyboard or mouse activity (0 = off). */
export function useAutolock(minutes: number, onLock: () => void): void {
  const callback = useRef(onLock)
  callback.current = onLock
  useEffect(() => {
    if (!minutes) return
    const delay = minutes * 60_000
    let timer = setTimeout(() => callback.current(), delay)
    const reset = (): void => {
      clearTimeout(timer)
      timer = setTimeout(() => callback.current(), delay)
    }
    EVENTS.forEach((name) => window.addEventListener(name, reset, { passive: true }))
    return () => {
      clearTimeout(timer)
      EVENTS.forEach((name) => window.removeEventListener(name, reset))
    }
  }, [minutes])
}
