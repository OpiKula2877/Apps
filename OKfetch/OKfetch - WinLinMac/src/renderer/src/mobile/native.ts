// The Java side of the Android app (OkfetchPlugin.java), as seen from the WebView.
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'

export type LaunchItem =
  | { type: 'open-chat'; chatId: string }
  | { type: 'add-contact'; text: string }
  | { type: 'share'; text?: string; files: { path: string; name: string; size: number }[] }

export interface OkfetchNative {
  /** One line of the core protocol (src/mobile/rpc.ts). */
  send(options: { line: string }): Promise<void>
  addListener(event: 'line', listener: (data: { line: string }) => void): Promise<PluginListenerHandle>
  addListener(event: 'launch', listener: () => void): Promise<PluginListenerHandle>
  takeLaunch(): Promise<{ items: LaunchItem[] }>
  /** 'ok', 'none' (no fingerprint and no screen lock) or 'unavailable'. */
  lockInfo(): Promise<{ availability: 'ok' | 'none' | 'unavailable' }>
  verifyLock(): Promise<{ ok: boolean }>
  scanQr(): Promise<{ text?: string }>
  batteryInfo(): Promise<{ optimized: boolean }>
  openBatterySettings(): Promise<void>
  notificationsInfo(): Promise<{ granted: boolean }>
  requestNotifications(): Promise<{ granted: boolean }>
  setBarColors(options: { background: string; text: string; light: boolean }): Promise<void>
}

export const isNative = Capacitor.isNativePlatform()

// One web stand-in for every call: calls racing at start-up must not each get their own instance (listeners would be lost).
let web: Promise<unknown> | null = null

export const Okfetch = registerPlugin<OkfetchNative>('Okfetch', {
  web: () => (web ??= import('./webNative').then((m) => new m.OkfetchWeb()))
})

/** The phone build runs in a WebView (or, for the UI tests, in a browser with a fake core). */
export const isPhoneBuild = (): boolean => window.okfetch?.platform === 'android'
