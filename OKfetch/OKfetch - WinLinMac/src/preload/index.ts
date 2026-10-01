// Typed, minimal API exposed to the renderer. No Node access leaks through.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { API_METHODS, type OkfetchApi, type UiEvent } from '../shared/ipc'

function listen<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux'

const invoked = Object.fromEntries(API_METHODS.map((name) => [name, (...args: unknown[]) => ipcRenderer.invoke(`api:${name}`, ...args)]))

const api = {
  ...invoked,
  platform,
  onEvent: (listener: (event: UiEvent) => void) => listen('event', listener),
  windowMinimize: () => ipcRenderer.send('window:minimize'),
  windowToggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  windowClose: () => ipcRenderer.send('window:close'),
  onMaximized: (listener: (maximized: boolean) => void) => listen('window:maximized', listener)
} as unknown as OkfetchApi

contextBridge.exposeInMainWorld('okfetch', api)
