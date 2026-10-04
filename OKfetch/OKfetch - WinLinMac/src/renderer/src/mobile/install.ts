// Runs before the UI: on the phone there is no Electron preload, so window.okfetch becomes the line bridge to
// the core in the Bare worklet. In a plain browser (UI tests) a fake core takes its place (webFake.ts).
import { PHONE_FILE_BASE, setFileUrlBase } from '../../../shared/model'
import { createMobileApi } from './mobileApi'
import { Okfetch, isNative } from './native'
import { installWebFake } from './webFake'

if (!window.okfetch) {
  if (isNative) {
    window.okfetch = createMobileApi({
      send: (line) => void Okfetch.send({ line }),
      onLine: (listener) => void Okfetch.addListener('line', ({ line }) => listener(line))
    })
    setFileUrlBase(PHONE_FILE_BASE)
  } else {
    installWebFake()
  }
}
