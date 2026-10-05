// IPC handlers: the only door between the windows and the controller.
import { ipcMain } from 'electron'
import type { Settings, SourceDraft, VideoInfo } from '../shared/ipc'
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

  handle('sources:get', () => controller.getSources())
  handle('sources:default-folder', () => controller.defaultFolder())
  handle('sources:pick-folder', (path?: string | null) => controller.pickFolder(typeof path === 'string' ? path : null))
  handle('sources:add-local', (draft: SourceDraft) => controller.addLocalSource(draft))
  handle('sources:add-drive', (draft: SourceDraft, successText: string) => controller.addDriveSource(draft, String(successText)))
  handle('sources:update', (id: string, patch: Partial<SourceDraft & { enabled: boolean }>) => controller.updateSource(String(id), patch ?? {}))
  handle('sources:reconnect', (id: string, successText: string) => controller.reconnectSource(String(id), String(successText)))
  handle('sources:remove', (id: string, force?: boolean) => controller.removeSource(String(id), Boolean(force)))
  handle('login:has-secret', () => controller.hasClientSecret())
  handle('login:secret', () => controller.chooseClientSecret())

  handle('library:refresh', () => controller.refresh())
  handle('data:mutate', (op: DataOp) => controller.mutate(op))
  handle('media:upload', (source: string, paths?: string[], albumId?: string | null) =>
    controller.upload(String(source), strings(paths), typeof albumId === 'string' ? albumId : null)
  )
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
