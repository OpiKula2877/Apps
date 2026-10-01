// Electron entry point: window, tray, lifecycle and the bridge to the core.
import { BrowserWindow, Menu, app, clipboard, dialog, ipcMain, nativeImage, shell } from 'electron'
import { cpSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import icon from '../../resources/icon.png?asset'
import { Core, type CoreEvent } from '../core/controller'
import { DEFAULT_KDF } from '../core/encryption/passwordProof'
import type { KeyProtector } from '../core/state'
import { isWritable } from '../core/storage/paths'
import type { AppStatus, Settings } from '../shared/ipc'
import { resolveColors, resolveFlags } from '../shared/theme'
import { setAutostart } from './autostart'
import { bootstrapFromEnv, loadSettings, saveSettings, storageRoot } from './config'
import { handleFileScheme, registerFileScheme } from './fileProtocol'
import { registerIpc, type Host } from './ipc'
import { createProtector } from './keyProtection'
import { notify } from './notifications'
import { AppTray } from './tray'

registerFileScheme()

// Test and development runs with their own folders must not share the single-instance lock.
if (process.env.OKFETCH_CONFIG_DIR) app.setPath('userData', join(process.env.OKFETCH_CONFIG_DIR, 'electron'))

let settings: Settings = loadSettings()
let core: Core | null = null
let protector: KeyProtector
let status: AppStatus = { phase: 'starting' }
let win: BrowserWindow | null = null
let quitting = false
let tray: AppTray

const hidden = process.argv.includes('--hidden')

const send = (channel: string, payload?: unknown): void => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

const emitUi = (event: unknown): void => send('event', event)

function setStatus(next: AppStatus): void {
  status = next
  emitUi({ type: 'app', status })
}

function showWindow(): void {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function unreadTotal(): number {
  if (!core) return 0
  const direct = core.contacts.list().reduce((sum, c) => sum + c.unread.enc + c.unread.plain, 0)
  return direct + core.groups.list().reduce((sum, g) => sum + g.unread, 0)
}

function refreshUnread(): void {
  const total = unreadTotal()
  tray.setUnread(total)
  if (process.platform !== 'win32') app.setBadgeCount(total)
}

function onCoreEvent(event: CoreEvent): void {
  emitUi(event)
  if (event.type === 'contacts' || event.type === 'groups' || event.type === 'chat') refreshUnread()
  if (!settings.notifications || (win?.isFocused() && win.isVisible())) return
  const language = settings.language
  if (event.type === 'incoming') {
    notify(event.title, event.text || (language === 'cs' ? 'Nová zpráva' : 'New message'), () => {
      showWindow()
      emitUi({ type: 'open-chat', chatId: event.chatId })
    })
  } else if (event.type === 'request') {
    notify('OKfetch', language === 'cs' ? `Nová žádost: ${event.title}` : `New request: ${event.title}`, showWindow)
  }
}

async function startCore(): Promise<void> {
  const root = storageRoot(settings)
  if (!isWritable(root)) {
    setStatus({ phase: 'storage', path: root, error: 'not_writable' })
    return
  }
  try {
    core = await Core.open({
      root,
      protector,
      bootstrap: bootstrapFromEnv(),
      kdf: process.env.OKFETCH_FAST_KDF ? { memoryKib: 1024, iterations: 1, lanes: 1 } : DEFAULT_KDF
    })
  } catch (error) {
    console.error('[okfetch] cannot start', error)
    setStatus({ phase: 'storage', path: root, error: String(error instanceof Error ? error.message : error) })
    return
  }
  core.onEvent(onCoreEvent)
  setStatus({ phase: 'ready' })
  refreshUnread()
}

async function useStoragePath(path: string, move: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const target = resolve(path)
  if (!isWritable(target)) return { ok: false, error: 'not_writable' }
  const old = core?.state.root ?? storageRoot(settings)
  const sameFolder = resolve(old) === target
  if (move && !sameFolder && existsSync(target) && readdirSync(target).length > 0) return { ok: false, error: 'not_empty' }
  await core?.close()
  core = null
  if (move && !sameFolder && existsSync(old)) {
    try {
      cpSync(old, target, { recursive: true })
      rmSync(old, { recursive: true, force: true })
    } catch {
      await startCore()
      return { ok: false, error: 'copy_failed' }
    }
  }
  settings = { ...settings, storage_path: target }
  saveSettings(settings)
  await startCore()
  return status.phase === 'ready' ? { ok: true } : { ok: false, error: status.phase === 'storage' ? status.error : 'unknown' }
}

function applyWindowSettings(previous: Settings): void {
  if (previous.autostart !== settings.autostart) setAutostart(settings.autostart)
  if (previous.language !== settings.language) tray.refresh()
  if (resolveFlags(previous).native_titlebar !== resolveFlags(settings).native_titlebar) recreateWindow()
}

const host: Host = {
  core() {
    if (!core) throw new Error('core not running')
    return core
  },
  status: () => status,
  protector: () => protector,
  settings: () => settings,
  updateSettings(patch) {
    const previous = settings
    settings = { ...settings, ...patch }
    saveSettings(settings)
    applyWindowSettings(previous)
    return settings
  },
  async pickFolder() {
    const result = win ? await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] }) : null
    return result && !result.canceled && result.filePaths[0] ? result.filePaths[0] : null
  },
  async pickFile() {
    if (process.env.OKFETCH_TEST_PICK_FILE) return process.env.OKFETCH_TEST_PICK_FILE
    const result = win ? await dialog.showOpenDialog(win, { properties: ['openFile'] }) : null
    return result && !result.canceled && result.filePaths[0] ? result.filePaths[0] : null
  },
  useStoragePath,
  async openPath(path) {
    await shell.openPath(path)
  },
  showItem: (path) => shell.showItemInFolder(path),
  openExternal: (url) => shell.openExternal(url),
  copyText: (text) => clipboard.writeText(text)
}

function rememberBounds(): void {
  if (!win || win.isDestroyed()) return
  const maximized = win.isMaximized()
  const bounds = maximized ? win.getNormalBounds() : win.getBounds()
  settings = { ...settings, window_bounds: { ...bounds, maximized } }
  saveSettings(settings)
}

function createWindow(): BrowserWindow {
  const native = resolveFlags(settings).native_titlebar
  const bounds = settings.window_bounds
  const window = new BrowserWindow({
    width: bounds?.width ?? 1180,
    height: bounds?.height ?? 760,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 860,
    minHeight: 560,
    show: false,
    frame: native,
    title: 'OKfetch',
    icon,
    backgroundColor: resolveColors(settings).background,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })
  window.setIcon(nativeImage.createFromPath(icon))
  if (bounds?.maximized) window.maximize()
  window.once('ready-to-show', () => {
    if (!(hidden && settings.close_to_tray)) window.show()
  })
  window.on('maximize', () => window.webContents.send('window:maximized', true))
  window.on('unmaximize', () => window.webContents.send('window:maximized', false))
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?:|mailto:)/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault()
  })
  window.on('close', (event) => {
    if (quitting) return
    if (settings.close_to_tray) {
      event.preventDefault()
      rememberBounds()
      window.hide()
      return
    }
    event.preventDefault()
    void quitApp()
  })
  if (process.env.ELECTRON_RENDERER_URL) {
    window.webContents.on('console-message', (event) => {
      if (event.level === 'error' || event.level === 'warning') console.log(`[renderer] ${event.message}`)
    })
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return window
}

async function quitApp(): Promise<void> {
  if (quitting) return
  quitting = true
  rememberBounds()
  tray.destroy()
  await core?.close().catch(() => undefined)
  win?.destroy()
  app.quit()
}

/** The frame cannot change at runtime, so the window is opened again (the core keeps running). */
function recreateWindow(): void {
  const old = win
  rememberBounds()
  win = createWindow()
  old?.destroy()
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())

  app.whenReady().then(async () => {
    // An app id without an installed shortcut makes Windows show the icon of electron.exe in the taskbar.
    // Only the installed app (OKfetch.exe with its own icon and Start menu shortcut) gets the id.
    if (process.platform === 'win32') app.setAppUserModelId(app.isPackaged ? 'cz.opikula.okfetch' : process.execPath)
    Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }]) : null)
    protector = createProtector()
    handleFileScheme(() => (core ? join(core.state.root, 'files') : null))
    registerIpc(host)
    ipcMain.on('window:minimize', () => win?.minimize())
    ipcMain.on('window:toggle-maximize', () => (win?.isMaximized() ? win.unmaximize() : win?.maximize()))
    ipcMain.on('window:close', () => win?.close())
    tray = new AppTray(icon, () => settings.language, showWindow, () => void quitApp())
    tray.show()
    win = createWindow()
    await startCore()
  })

  // The tray keeps the app alive; quitting goes through quitApp.
  app.on('window-all-closed', () => {
    if (quitting) app.quit()
  })
}

