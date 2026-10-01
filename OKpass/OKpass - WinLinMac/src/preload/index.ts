// Typed, minimal API exposed to the renderer. No Node access leaks through.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { OkpassApi } from '../shared/ipc'

function listen<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux'

const api: OkpassApi = {
  platform,
  getScreen: () => ipcRenderer.invoke('screen:get'),
  onScreen: (listener) => listen('screen', listener),
  onStatus: (listener) => listen('status', listener),
  onMessage: (listener) => listen('message', listener),
  onFlushRequest: (listener) => listen('app:flush', listener),
  flushDone: () => ipcRenderer.send('app:flush-done'),

  chooseClientSecret: () => ipcRenderer.invoke('login:secret'),
  login: (successText) => ipcRenderer.invoke('login:start', successText),
  retry: () => ipcRenderer.invoke('login:retry'),
  submitKey: (raw) => ipcRenderer.invoke('key:submit', raw),
  logout: (pending, force) => ipcRenderer.invoke('account:logout', pending, force),

  saveVault: (vault) => ipcRenderer.invoke('vault:save', vault),
  lock: (pending) => ipcRenderer.invoke('vault:lock', pending),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  setDecoy: (raw) => ipcRenderer.invoke('decoy:set', raw),
  removeDecoy: () => ipcRenderer.invoke('decoy:remove'),
  isOnline: () => ipcRenderer.invoke('storage:online'),
  listBackups: () => ipcRenderer.invoke('backups:list'),
  restoreBackup: (id) => ipcRenderer.invoke('backups:restore', id),
  exportVault: () => ipcRenderer.invoke('vault:export'),
  importVault: (data) => ipcRenderer.invoke('vault:import', data),
  biometricStatus: () => ipcRenderer.invoke('bio:status'),
  setBiometric: (on) => ipcRenderer.invoke('bio:set', on),
  unlockBiometric: () => ipcRenderer.invoke('bio:unlock'),

  windowMinimize: () => ipcRenderer.send('window:minimize'),
  windowToggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  windowClose: () => ipcRenderer.send('window:close'),
  onMaximized: (listener) => listen('window:maximized', listener)
}

contextBridge.exposeInMainWorld('okpass', api)
