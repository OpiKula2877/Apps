// IPC handlers: the only door between the renderer and the core.
import { ipcMain } from 'electron'
import { createHandlers, type ApiHost } from '../core/api'
import { API_METHODS } from '../shared/ipc'

export type Host = ApiHost

export function registerIpc(host: Host): void {
  const handlers = createHandlers(host)
  for (const name of API_METHODS) {
    const handler = handlers[name] as (...args: unknown[]) => unknown
    ipcMain.handle(`api:${name}`, (_event, ...args) => handler(...args))
  }
}

