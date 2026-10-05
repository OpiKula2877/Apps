// Typed, minimal API exposed to the windows. No Node access leaks through.
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type { OkgramApi } from '../shared/ipc'

function listen<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux'
const invoke = ipcRenderer.invoke.bind(ipcRenderer)

const api: OkgramApi = {
  platform,
  isViewer: process.argv.includes('--okgram-viewer'),

  getScreen: () => invoke('screen:get'),
  onScreen: (listener) => listen('screen', listener),
  onMessage: (listener) => listen('message', listener),
  getLibrary: () => invoke('library:get'),
  onLibrary: (listener) => listen('library', listener),
  getData: () => invoke('data:get'),
  onData: (listener) => listen('data', listener),
  getStatus: () => invoke('status:get'),
  onStatus: (listener) => listen('status', listener),
  getTransfers: () => invoke('transfers:get'),
  onTransfers: (listener) => listen('transfers', listener),
  getSettings: () => invoke('settings:get'),
  onSettings: (listener) => listen('settings', listener),
  updateSettings: (patch) => invoke('settings:update', patch),

  getSources: () => invoke('sources:get'),
  onSources: (listener) => listen('sources', listener),
  defaultFolder: () => invoke('sources:default-folder'),
  pickFolder: (path) => invoke('sources:pick-folder', path),
  addLocalSource: (draft) => invoke('sources:add-local', draft),
  addDriveSource: (draft, successText) => invoke('sources:add-drive', draft, successText),
  updateSource: (id, patch) => invoke('sources:update', id, patch),
  reconnectSource: (id, successText) => invoke('sources:reconnect', id, successText),
  removeSource: (id, force) => invoke('sources:remove', id, force),
  hasClientSecret: () => invoke('login:has-secret'),
  chooseClientSecret: () => invoke('login:secret'),

  refresh: () => invoke('library:refresh'),
  mutate: (op) => invoke('data:mutate', op),
  upload: (source, paths, albumId) => invoke('media:upload', source, paths, albumId),
  pathForFile: (file) => webUtils.getPathForFile(file),
  download: (ids) => invoke('media:download', ids),
  downloadZip: (ids, name) => invoke('media:zip', ids, name),
  cancelTransfer: (id) => invoke('transfer:cancel', id),
  clearTransfers: () => invoke('transfer:clear'),
  rename: (id, name) => invoke('media:rename', id, name),
  trash: (ids) => invoke('media:trash', ids),
  share: (id) => invoke('media:share', id),
  unshare: (id) => invoke('media:unshare', id),
  copyText: (text) => invoke('clipboard:write', text),
  openInSystem: (id) => invoke('media:system', id),
  storeThumbnail: (id, version, thumbnail, info) => invoke('media:thumbnail', id, version, thumbnail, info),
  quota: () => invoke('storage:quota'),
  cacheSize: () => invoke('cache:size'),
  clearCache: () => invoke('cache:clear'),
  exportSettings: () => invoke('settings:export'),
  importSettings: () => invoke('settings:import'),
  pickDownloadFolder: () => invoke('settings:download-folder'),
  openLogs: () => invoke('logs:open'),
  log: (text) => ipcRenderer.send('log', text),

  openViewer: (ids, index, slideshow) => invoke('viewer:open', ids, index, slideshow),
  getViewerContext: () => invoke('viewer:get'),
  onViewerContext: (listener) => listen('viewer:context', listener),

  windowMinimize: () => ipcRenderer.send('window:minimize'),
  windowToggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  windowClose: () => ipcRenderer.send('window:close'),
  setFullScreen: (on) => ipcRenderer.send('window:fullscreen', on),
  onMaximized: (listener) => listen('window:maximized', listener),
  onFullScreen: (listener) => listen('window:fullscreen', listener)
}

contextBridge.exposeInMainWorld('okgram', api)
