// Electron entry point: window, menu, lifecycle and the bridge to the controller.
import { BrowserWindow, Menu, app, clipboard, dialog, ipcMain, shell } from 'electron'
import { resolve, join } from 'node:path'
import icon from '../../resources/icon.png?asset'
import { Controller } from '../core/controller'
import type { UiBridge } from '../core/platform'
import { resolveColors, resolveFlags } from '../shared/theme'
import { saveSettings } from './config'
import { registerIpc } from './ipc'
import { createNodePlatform } from './nodePlatform'

function argument(name: string): string | null {
  const index = process.argv.indexOf(name)
  return index >= 0 && process.argv[index + 1] ? resolve(process.argv[index + 1]) : null
}

const devFolder = argument('--local-dev')
let win: BrowserWindow | null = null
let quitting = false

const send = (channel: string, payload?: unknown): void => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

const ui: UiBridge = {
  sendScreen: (screen) => send('screen', screen),
  sendStatus: (status) => send('status', status),
  sendMessage: (message) => send('message', message)
}

const controller = new Controller(
  createNodePlatform({
    ui,
    devFolder,
    openExternal: (url) => shell.openExternal(url),
    async pickFile(filters) {
      const result = win ? await dialog.showOpenDialog(win, { properties: ['openFile'], filters }) : null
      return result && !result.canceled && result.filePaths[0] ? result.filePaths[0] : null
    },
    async saveFile(defaultName, filters) {
      const result = win ? await dialog.showSaveDialog(win, { defaultPath: defaultName, filters }) : null
      return result && !result.canceled && result.filePath ? result.filePath : null
    },
    writeClipboard: (text) => clipboard.writeText(text),
    nativeFrameChanged: () => recreateWindow()
  })
)

function rememberBounds(): void {
  if (!win || win.isDestroyed()) return
  const maximized = win.isMaximized()
  const bounds = maximized ? win.getNormalBounds() : win.getBounds()
  controller.settings = { ...controller.settings, window_bounds: { ...bounds, maximized } }
  saveSettings(controller.settings)
}

function createWindow(): BrowserWindow {
  const settings = controller.settings
  const native = resolveFlags(settings).native_titlebar
  const bounds = settings.window_bounds
  const window = new BrowserWindow({
    width: bounds?.width ?? 1120,
    height: bounds?.height ?? 740,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 800,
    minHeight: 540,
    show: false,
    frame: native,
    title: 'OKpass',
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
  if (bounds?.maximized) window.maximize()
  window.once('ready-to-show', () => window.show())
  window.on('maximize', () => window.webContents.send('window:maximized', true))
  window.on('unmaximize', () => window.webContents.send('window:maximized', false))
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault()
  })
  window.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    void closeGracefully(window)
  })
  if (process.env.ELECTRON_RENDERER_URL) {
    // Development: show renderer errors in the terminal.
    window.webContents.on('console-message', (event) => {
      if (event.level === 'error' || event.level === 'warning') console.log(`[renderer] ${event.message}`)
    })
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return window
}

/** Ask the renderer to save unsaved edits, wait for storage, then close. */
async function closeGracefully(window: BrowserWindow): Promise<void> {
  rememberBounds()
  await new Promise<void>((done) => {
    const timer = setTimeout(done, 4000)
    ipcMain.once('app:flush-done', () => {
      clearTimeout(timer)
      done()
    })
    window.webContents.send('app:flush')
  })
  await controller.shutdown()
  quitting = true
  window.destroy()
  app.quit()
}

/** The frame cannot change at runtime, so the window is opened again (the session stays in this process). */
function recreateWindow(): void {
  const old = win
  rememberBounds()
  win = createWindow()
  old?.destroy()
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    if (process.platform === 'win32') app.setAppUserModelId('OpiKula.OKpass')
    // macOS needs the Edit menu for copy & paste shortcuts; other systems get no menu.
    Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }]) : null)
    registerIpc(controller)
    ipcMain.on('window:minimize', () => win?.minimize())
    ipcMain.on('window:toggle-maximize', () => (win?.isMaximized() ? win.unmaximize() : win?.maximize()))
    ipcMain.on('window:close', () => win?.close())
    ipcMain.handle('window:is-maximized', () => Boolean(win?.isMaximized()))
    void controller.init().then(() => {
      win = createWindow()
      void controller.start()
    })
  })

  app.on('window-all-closed', () => app.quit())
}
