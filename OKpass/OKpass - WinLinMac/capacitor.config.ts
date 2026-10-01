import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'cz.opikula.okpass',
  appName: 'OKpass',
  webDir: 'dist-mobile',
  android: {
    allowMixedContent: false,
    webContentsDebuggingEnabled: false
  }
}

export default config
