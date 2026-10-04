// Entry point of the Android worklet (Bare Kit): connects the core to the Java host through BareKit.IPC.
// Lines are cut on raw bytes, so a UTF-8 character split between two chunks stays intact.
// Web globals for Bare first (noble needs them while loading).
import './polyfills'
import { bareSocketFactory } from './bareSocket'
import { startWorklet } from './worklet'

const ipc = BareKit.IPC

startWorklet({
  send: (line) => {
    ipc.write(Buffer.from(`${line}\n`, 'utf8'))
  },
  onLine: (listener) => {
    let pending = Buffer.alloc(0)
    ipc.on('data', (chunk: Uint8Array) => {
      pending = pending.length ? Buffer.concat([pending, Buffer.from(chunk)]) : Buffer.from(chunk)
      let end = pending.indexOf(10)
      while (end !== -1) {
        const line = pending.subarray(0, end).toString('utf8')
        pending = pending.subarray(end + 1)
        if (line) listener(line)
        end = pending.indexOf(10)
      }
    })
  }
}, { relaySocket: bareSocketFactory })

// One failing handler must not take the whole app down (the worklet runs inside the app process).
Bare.on('uncaughtException', (error) => console.error('[okfetch] uncaught', error))
Bare.on('unhandledRejection', (error) => console.error('[okfetch] unhandled', error))
