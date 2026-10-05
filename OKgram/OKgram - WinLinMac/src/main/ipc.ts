// IPC handlers: the only door between the windows and the controller.
import { ipcMain } from 'electron'
import type { Settings, StorageMode, VideoInfo } from '../shared/ipc'
import type { DataOp } from '../shared/model'
import type { Controller } from './controller'

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [])

export function registerIpc(controller: Controller): void {
  const handle = (channel: string, fn: (...args: never[]) => unknown): void => {
    ipcMain.handle(channel, (_event, ...args) => fn(...(args as never[])))
  }
  handle('screen:get', () => controller.getScreen())
  handle('library:get', () => controller.getLibrary())
  handle('data:get', () => controller.getData())
  handle('status:get', () => controller.getStatus())
  handle('transfers:get', () => controller.transfers.all)
  handle('settings:get', () => controller.getSettings())
  handle('settings:update', (patch: Partial<Settings>) => controller.updateSettings(patch))

  handle('welcome:mode', (mode: StorageMode | null) => controller.chooseMode(mode === 'drive' || mode === 'local' ? mode : null))
  handle('login:secret', () => controller.chooseClientSecret())
  handle('login:start', (successText: string) => controller.signIn(String(successText)))
  handle('login:retry', () => controller.retry())
  handle('local:open', (folder: string | null | true) => controller.openLocal(folder === true ? true : typeof folder === 'string' ? folder : null))
  handle('library:leave', (force?: boolean) => controller.leave(Boolean(force)))

  handle('library:refresh', () => controller.refresh())
  handle('data:mutate', (op: DataOp) => controller.mutate(op))
  handle('media:upload', (paths?: string[], albumId?: string | null) => controller.upload(strings(paths), typeof albumId === 'string' ? albumId : null))
  handle('media:download', (ids: string[]) => controller.download(strings(ids)))
  handle('media:zip', (ids: string[], name: string) => controller.downloadZip(strings(ids), String(name)))
  handle('transfer:cancel', (id: string) => controller.cancelTransfer(String(id)))
  handle('transfer:clear', () => controller.clearTransfers())
  handle('media:rename', (id: string, name: string) => controller.rename(String(id), String(name)))
  handle('media:trash', (ids: string[]) => controller.trash(strings(ids)))
  handle('media:share', (id: string) => controller.share(String(id)))
  handle('media:unshare', (id: string) => controller.unshare(String(id)))
  handle('media:system', (id: string) => controller.openInSystem(String(id)))
  handle('media:thumbnail', (id: string, version: string, thumb: Uint8Array | null, info: VideoInfo | null) =>
    controller.storeThumbnail(String(id), String(version), thumb instanceof Uint8Array ? thumb : null, info && typeof info === 'object' ? info : null)
  )
  handle('clipboard:write', (text: string) => controller.copyText(String(text)))
  handle('storage:quota', () => controller.quota())
  handle('cache:size', () => controller.cacheSize())
  handle('cache:clear', () => controller.clearCache())
  handle('settings:export', () => controller.exportSettings())
  handle('settings:import', () => controller.importSettings())
  handle('settings:download-folder', () => controller.pickDownloadFolder())
}
