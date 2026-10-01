// Start OKpass on the phone: the controller runs inside the app, next to the UI.
import { Capacitor } from '@capacitor/core'
import { Controller } from '../../../core/controller'
import { DriveRestBackend } from '../../../core/driveRest'
import { UiEmitter, createLocalApi } from '../../../core/localApi'
import type { Platform } from '../../../core/platform'
import type { OkpassApi } from '../../../shared/ipc'
import { translator } from '../i18n'
import { createAndroidAuth, createAndroidBiometric, shareFile } from './native'
import { CapacitorCache, loadSettings, saveSettings } from './storage'
import { WebDevBackend, createWebBiometric, devAuth, downloadFile } from './webDev'

export function createMobileApi(): OkpassApi {
  const native = Capacitor.isNativePlatform()
  const emitter = new UiEmitter()
  let controller: Controller | null = null
  const t = () => translator(controller?.settings.language ?? 'cs')

  const platform: Platform = {
    name: 'android',
    ui: emitter,
    devMode: !native,
    loadSettings,
    saveSettings,
    cacheFor: (accountId) => new CapacitorCache(accountId),
    auth: native ? createAndroidAuth() : devAuth,
    makeBackend: (tokens) => (native ? new DriveRestBackend(tokens!) : new WebDevBackend()),
    exportFile: native ? shareFile : downloadFile,
    // The phone UI hands the picked file over directly (see SettingsDialog).
    importFile: async () => null,
    writeClipboard: (text) => navigator.clipboard.writeText(text),
    biometric: native ? createAndroidBiometric(t) : createWebBiometric()
  }

  controller = new Controller(platform)
  void controller.start()
  const api = createLocalApi(controller, emitter, 'android')
  // Browser test mode only: let the UI tests look at the state.
  if (!native) Object.assign(window, { __okpassApi: api, __okpassController: controller })
  return api
}
