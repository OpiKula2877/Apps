// OkpassApi implemented in the same process as the UI (used on the phone).
import type { Message, OkpassApi, PlatformName, SaveState, Screen } from '../shared/ipc'
import type { Controller } from './controller'
import type { UiBridge } from './platform'

type Listener<T> = (value: T) => void

/** UiBridge that hands controller events to UI listeners. */
export class UiEmitter implements UiBridge {
  private screen = new Set<Listener<Screen>>()
  private status = new Set<Listener<SaveState>>()
  private message = new Set<Listener<Message>>()

  sendScreen(screen: Screen): void {
    this.screen.forEach((l) => l(screen))
  }

  sendStatus(status: SaveState): void {
    this.status.forEach((l) => l(status))
  }

  sendMessage(message: Message): void {
    this.message.forEach((l) => l(message))
  }

  onScreen(listener: Listener<Screen>): () => void {
    this.screen.add(listener)
    return () => this.screen.delete(listener)
  }

  onStatus(listener: Listener<SaveState>): () => void {
    this.status.add(listener)
    return () => this.status.delete(listener)
  }

  onMessage(listener: Listener<Message>): () => void {
    this.message.add(listener)
    return () => this.message.delete(listener)
  }
}

const nothing = (): (() => void) => () => undefined

/** Data passed to the controller is copied, the same as it would be across IPC. */
const copy = <T>(value: T): T => (value === undefined ? value : structuredClone(value))

export function createLocalApi(controller: Controller, emitter: UiEmitter, platform: PlatformName): OkpassApi {
  return {
    platform,
    getScreen: async () => copy(controller.getScreen()),
    onScreen: (l) => emitter.onScreen((s) => l(copy(s))),
    onStatus: (l) => emitter.onStatus(l),
    onMessage: (l) => emitter.onMessage(l),
    onFlushRequest: nothing,
    flushDone: () => undefined,

    chooseClientSecret: () => controller.chooseClientSecret(),
    login: (successText) => controller.signIn(successText),
    retry: () => controller.retry(),
    submitKey: (raw) => controller.submitKey(raw),
    logout: (pending, force) => controller.logout(copy(pending), force),

    saveVault: (vault) => controller.saveVault(copy(vault)),
    lock: (pending) => controller.lock(copy(pending)),
    copyText: (text) => controller.copyText(text),

    getSettings: async () => copy(await controller.getSettings()),
    updateSettings: async (patch) => copy(await controller.updateSettings(copy(patch))),
    setDecoy: (raw) => controller.setDecoy(raw),
    removeDecoy: () => controller.removeDecoy(),
    isOnline: async () => controller.isOnline(),
    listBackups: () => controller.listBackups(),
    restoreBackup: (id) => controller.restoreBackup(id),
    exportVault: () => controller.exportVault(),
    importVault: (data) => controller.importVault(data),

    biometricStatus: () => controller.biometricStatus(),
    setBiometric: (on) => controller.setBiometric(on),
    unlockBiometric: () => controller.unlockBiometric(),

    windowMinimize: () => undefined,
    windowToggleMaximize: () => undefined,
    windowClose: () => undefined,
    onMaximized: nothing
  }
}
