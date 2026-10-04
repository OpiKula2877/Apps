// window.okfetch on the phone: the same API as the desktop preload, carried as lines to the core in the Bare
// worklet (through OkfetchPlugin.java). Replies come back by id, events as they happen.
import { API_METHODS, type OkfetchApi, type UiEvent } from '../../../shared/ipc'
import { decodeLine, encodeLine } from '../../../mobile/rpc'

/** What the API needs from the native side; the UI tests pass a fake with the same shape. */
export interface LineChannel {
  send(line: string): void
  onLine(listener: (line: string) => void): void
}

export function createMobileApi(channel: LineChannel, extras: Partial<OkfetchApi> = {}): OkfetchApi {
  let next = 0
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  const listeners = new Set<(event: UiEvent) => void>()

  channel.onLine((line) => {
    const message = decodeLine(line)
    if (!message) return
    if (message.t === 'reply') {
      const waiting = pending.get(message.id)
      pending.delete(message.id)
      if (!waiting) return
      if (message.ok) waiting.resolve(message.result)
      else waiting.reject(new Error(message.error))
    } else if (message.t === 'event') {
      for (const listener of listeners) {
        try {
          listener(message.event as UiEvent)
        } catch (error) {
          console.error('[okfetch] event listener failed', error)
        }
      }
    }
  })

  const call = (method: string, args: unknown[]): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const id = `w${next++}`
      pending.set(id, { resolve, reject })
      channel.send(encodeLine({ t: 'call', id, method, args }))
    })

  const invoked = Object.fromEntries(API_METHODS.map((name) => [name, (...args: unknown[]) => call(name, args)]))
  const noop = (): void => undefined

  return {
    ...invoked,
    platform: 'android',
    onEvent(listener: (event: UiEvent) => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    sendTyping(chatId: string) {
      void call('sendTyping', [chatId]).catch(noop)
    },
    windowMinimize: noop,
    windowToggleMaximize: noop,
    windowClose: noop,
    onMaximized: () => noop,
    ...extras
  } as OkfetchApi
}
