// IPC handlers: the only door between the renderer and the controller.
import { ipcMain } from 'electron'
import type { Settings } from '../shared/ipc'
import type { VaultData } from '../shared/model'
import type { Controller } from '../core/controller'

export function registerIpc(controller: Controller): void {
  const handle = (channel: string, fn: (...args: never[]) => unknown): void => {
    ipcMain.handle(channel, (_event, ...args) => fn(...(args as never[])))
  }
  handle('screen:get', () => controller.getScreen())
  handle('login:secret', () => controller.chooseClientSecret())
  handle('login:start', (successText: string) => controller.signIn(String(successText)))
  handle('login:retry', () => controller.retry())
  handle('key:submit', (raw: string) => controller.submitKey(String(raw)))
  handle('account:logout', (pending?: VaultData, force?: boolean) => controller.logout(pending, Boolean(force)))
  handle('vault:save', (vault: VaultData) => controller.saveVault(vault))
  handle('vault:lock', (pending?: VaultData) => controller.lock(pending))
  handle('clipboard:write', (text: string) => controller.copyText(String(text)))
  handle('settings:get', () => controller.getSettings())
  handle('settings:update', (patch: Partial<Settings>) => controller.updateSettings(patch))
  handle('decoy:set', (raw: string) => controller.setDecoy(String(raw)))
  handle('decoy:remove', () => controller.removeDecoy())
  handle('storage:online', () => controller.isOnline())
  handle('backups:list', () => controller.listBackups())
  handle('backups:restore', (id: string) => controller.restoreBackup(String(id)))
  handle('vault:export', () => controller.exportVault())
  handle('vault:import', (data?: Uint8Array) => controller.importVault(data instanceof Uint8Array ? data : undefined))
  handle('bio:status', () => controller.biometricStatus())
  handle('bio:set', (on: boolean) => controller.setBiometric(Boolean(on)))
  handle('bio:unlock', () => controller.unlockBiometric())
}
