// Phone shell integration: Android back button, leaving the app, system bar colours.
import { Capacitor } from '@capacitor/core'

export const isNative = Capacitor.isNativePlatform()

let externalUntil = 0

/** The app opens a system screen itself (share sheet, file picker, fingerprint); do not lock for it. */
export function allowExternal(ms = 120_000): void {
  externalUntil = Date.now() + ms
}

/** The system screen is closed again. */
export function endExternal(): void {
  externalUntil = Date.now() + 1500
}

export async function withExternal<T>(work: () => Promise<T>): Promise<T> {
  allowExternal()
  try {
    return await work()
  } finally {
    endExternal()
  }
}

const leaving = (handler: () => void) => (): void => {
  if (Date.now() < externalUntil) return
  handler()
}

/** Call the handler when the Android back button is pressed. */
export async function onBackButton(handler: () => void): Promise<() => void> {
  if (!isNative) return () => undefined
  const { App } = await import('@capacitor/app')
  const listener = await App.addListener('backButton', handler)
  return () => void listener.remove()
}

/** Call the handler when the user leaves the app (home, other app, screen off). */
export async function onAppHidden(handler: () => void): Promise<() => void> {
  if (!isNative) {
    const fire = leaving(handler)
    const listener = (): void => {
      if (document.visibilityState === 'hidden') fire()
    }
    document.addEventListener('visibilitychange', listener)
    return () => document.removeEventListener('visibilitychange', listener)
  }
  const { App } = await import('@capacitor/app')
  const fire = leaving(handler)
  const listener = await App.addListener('appStateChange', ({ isActive }) => {
    if (!isActive) fire()
  })
  return () => void listener.remove()
}

export async function minimizeApp(): Promise<void> {
  if (!isNative) return
  const { App } = await import('@capacitor/app')
  await App.minimizeApp()
}

/** Match the Android status and navigation bars to the theme. */
export async function setBarColors(background: string, light: boolean): Promise<void> {
  if (!isNative) return
  const { OkpassWindow } = await import('./native')
  await OkpassWindow.setColors({ background, light }).catch(() => undefined)
}
