// Browser stand-in for OkfetchPlugin.java (UI tests): the lock always succeeds, the scanner returns what the test
// put into window.__okfetchFake.scan, launch items come from window.__okfetchFake.launch.
import { WebPlugin } from '@capacitor/core'
import type { LaunchItem, OkfetchNative } from './native'

export class OkfetchWeb extends WebPlugin implements Omit<OkfetchNative, 'addListener'> {
  async send(): Promise<void> {
    // the browser build talks to the fake core directly (webFake.ts)
  }

  async takeLaunch(): Promise<{ items: LaunchItem[] }> {
    const items = window.__okfetchFake?.launch ?? []
    if (window.__okfetchFake) window.__okfetchFake.launch = []
    return { items }
  }

  /** Tests call this after putting items into __okfetchFake.launch. */
  fireLaunch(): void {
    this.notifyListeners('launch', {})
  }

  async lockInfo(): Promise<{ availability: 'ok' | 'none' | 'unavailable' }> {
    return { availability: 'ok' }
  }

  async verifyLock(): Promise<{ ok: boolean }> {
    return { ok: true }
  }

  async scanQr(): Promise<{ text?: string }> {
    const text = window.__okfetchFake?.scan ?? undefined
    return text ? { text } : {}
  }

  async batteryInfo(): Promise<{ optimized: boolean }> {
    return { optimized: true }
  }

  async openBatterySettings(): Promise<void> {}

  async notificationsInfo(): Promise<{ granted: boolean }> {
    return { granted: true }
  }

  async requestNotifications(): Promise<{ granted: boolean }> {
    return { granted: true }
  }

  async setBarColors(): Promise<void> {}
}
