// Electron entry point: the library window, the viewer window, menus, dialogs and lifecycle.
import { BrowserWindow, Menu, app, clipboard, dialog, ipcMain, nativeImage, shell, type IpcMainEvent } from 'electron'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import icon from '../../resources/icon.png?asset'
import type { Bounds, Settings, ViewerContext } from '../shared/ipc'
import { ALL_EXTENSIONS } from '../shared/formats'
import { resolveColors, resolveFlags } from '../shared/theme'
import { DriveRestBackend } from '../core/driveRest'
import { createAuth } from './auth'
import { cacheDir, loadSettings, saveSettings } from './config'
import { Controller } from './controller'
import { registerIpc } from './ipc'
import { LocalLibrary } from './localLibrary'
import { log, logError, logFile } from './log'
import { handleScheme, registerScheme } from './protocol'

registerScheme()

let main: BrowserWindow | null = null
let viewer: BrowserWindow | null = null
let quitting = false
let viewerContext: ViewerContext = { ids: [], index: 0, slideshow: false, serial: 0 }

const windows = (): BrowserWindow[] => [main, viewer].filter((w): w is BrowserWindow => Boolean(w && !w.isDestroyed()))
const broadcast = (channel: string, payload?: unknown): void => {
  for (const window of windows()) window.webContents.send(channel, payload)
}
const owner = (): BrowserWindow | undefined => (main && !main.isDestroyed() ? main : undefined)

process.on('uncaughtException', (error) => logError('main', error))
process.on('unhandledRejection', (error) => logError('main promise', error))

function resizeImage(bytes: Uint8Array, max: number): Uint8Array | null {
  const image = nativeImage.createFromBuffer(Buffer.from(bytes))
  if (image.isEmpty()) return null
  const { width, height } = image.getSize()
  const scale = Math.min(1, max / Math.max(width, height))
  const result = scale < 1 ? image.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: 'good' }) : image
  return new Uint8Array(result.toJPEG(82))
}

const controller = new Controller({
  ui: {
    screen: (screen) => broadcast('screen', screen),
    library: (state) => broadcast('library', state),
    data: (data) => broadcast('data', data),
    status: (status) => broadcast('status', status),
    message: (message) => owner()?.webContents.send('message', message),
    transfers: (list) => broadcast('transfers', list),
    settings: (settings) => broadcast('settings', settings),
    sources: (sources) => broadcast('sources', sources)
  },
  loadSettings,
  saveSettings,
  cacheRoot: cacheDir(),
  get defaultFolder() {
    return join(app.getPath('pictures'), 'OKgram')
  },
  auth: createAuth(
    (url) => shell.openExternal(url),
    async () => {
      const result = await dialog.showOpenDialog(owner()!, { properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] })
      return result.canceled ? null : (result.filePaths[0] ?? null)
    }
  ),
  makeDrive: (tokens) => new DriveRestBackend(tokens),
  makeLocal: (folder, subfolders) => new LocalLibrary(folder, { trash: (path) => shell.trashItem(path) }, subfolders),
  async pickFiles() {
    const result = await dialog.showOpenDialog(owner()!, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Media', extensions: ALL_EXTENSIONS }]
    })
    return result.canceled ? [] : result.filePaths
  },
  async pickFolder(title, defaultPath) {
    const result = await dialog.showOpenDialog(owner()!, { title, defaultPath, properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  },
  async pickSaveFile(defaultName, filters) {
    const result = await dialog.showSaveDialog(owner()!, { defaultPath: join(app.getPath('downloads'), defaultName), filters })
    return result.canceled || !result.filePath ? null : result.filePath
  },
  async pickOpenFile(filters) {
    const result = await dialog.showOpenDialog(owner()!, { properties: ['openFile'], filters })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  },
  writeClipboard: (text) => clipboard.writeText(text),
  openPath: (path) => shell.openPath(path),
  tempDir: tmpdir(),
  resizeImage,
  nativeFrameChanged: () => recreateWindows(),
  log
})

function remember(window: BrowserWindow | null, key: 'window_bounds' | 'viewer_bounds'): void {
  if (!window || window.isDestroyed() || window.isFullScreen()) return
  const maximized = window.isMaximized()
  const bounds: Bounds = { ...(maximized ? window.getNormalBounds() : window.getBounds()), maximized }
  controller.settings = { ...controller.settings, [key]: bounds } as Settings
  saveSettings(controller.settings)
}

function createWindow(kind: 'main' | 'viewer'): BrowserWindow {
  const settings = controller.settings
  const native = resolveFlags(settings).native_titlebar
  const bounds = kind === 'main' ? settings.window_bounds : settings.viewer_bounds
  const window = new BrowserWindow({
    width: bounds?.width ?? (kind === 'main' ? 1200 : 1000),
    height: bounds?.height ?? (kind === 'main' ? 780 : 720),
    x: bounds?.x,
    y: bounds?.y,
    minWidth: kind === 'main' ? 820 : 480,
    minHeight: kind === 'main' ? 560 : 360,
    show: false,
    frame: native,
    title: 'OKgram',
    icon,
    backgroundColor: kind === 'main' ? resolveColors(settings).background : '#000000',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      additionalArguments: kind === 'viewer' ? ['--okgram-viewer'] : []
    }
  })
  if (bounds?.maximized) window.maximize()
  window.once('ready-to-show', () => window.show())
  window.on('maximize', () => window.webContents.send('window:maximized', true))
  window.on('unmaximize', () => window.webContents.send('window:maximized', false))
  window.on('enter-full-screen', () => window.webContents.send('window:fullscreen', true))
  window.on('leave-full-screen', () => window.webContents.send('window:fullscreen', false))
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault()
  })
  window.webContents.on('render-process-gone', (_event, details) => log(`[renderer ${kind}] gone: ${details.reason}`))
  if (kind === 'main') {
    window.on('close', (event) => {
      if (quitting) return
      event.preventDefault()
      void closeGracefully()
    })
  } else {
    window.on('close', () => remember(window, 'viewer_bounds'))
    window.on('closed', () => {
      if (viewer === window) viewer = null
    })
  }
  if (process.env.ELECTRON_RENDERER_URL) {
    window.webContents.on('console-message', (event) => {
      if (event.level === 'error' || event.level === 'warning') console.log(`[${kind}] ${event.message}`)
    })
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return window
}

async function closeGracefully(): Promise<void> {
  remember(main, 'window_bounds')
  if (viewer && !viewer.isDestroyed()) viewer.close()
  await controller.shutdown()
  quitting = true
  main?.destroy()
  app.quit()
}

/** The frame cannot change at runtime, so the windows are opened again. */
function recreateWindows(): void {
  const oldMain = main
  const hadViewer = Boolean(viewer && !viewer.isDestroyed())
  remember(main, 'window_bounds')
  main = createWindow('main')
  oldMain?.destroy()
  if (hadViewer) {
    viewer?.destroy()
    viewer = createWindow('viewer')
  }
}

function openViewer(ids: string[], index: number, slideshow: boolean): void {
  viewerContext = { ids, index: Math.max(0, Math.min(index, ids.length - 1)), slideshow, serial: viewerContext.serial + 1 }
  if (viewer && !viewer.isDestroyed()) {
    viewer.webContents.send('viewer:context', viewerContext)
    if (viewer.isMinimized()) viewer.restore()
    viewer.focus()
    return
  }
  viewer = createWindow('viewer')
}

const senderWindow = (event: IpcMainEvent): BrowserWindow | null => BrowserWindow.fromWebContents(event.sender)

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (main) {
      if (main.isMinimized()) main.restore()
      main.focus()
    }
  })

  app.whenReady().then(() => {
    if (process.platform === 'win32') app.setAppUserModelId('OpiKula.OKgram')
    // macOS needs the Edit menu for copy & paste shortcuts; other systems get no menu.
    Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null)
    handleScheme(controller)
    registerIpc(controller)
    ipcMain.handle('viewer:open', (_event, ids: unknown, index: unknown, slideshow: unknown) =>
      openViewer(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [], Number(index) || 0, Boolean(slideshow))
    )
    ipcMain.handle('viewer:get', () => viewerContext)
    ipcMain.handle('logs:open', () => shell.showItemInFolder(logFile()))
    ipcMain.on('log', (_event, text: unknown) => log(`[renderer] ${String(text).slice(0, 2000)}`))
    ipcMain.on('window:minimize', (event) => senderWindow(event)?.minimize())
    ipcMain.on('window:toggle-maximize', (event) => {
      const window = senderWindow(event)
      if (window?.isMaximized()) window.unmaximize()
      else window?.maximize()
    })
    ipcMain.on('window:close', (event) => senderWindow(event)?.close())
    ipcMain.on('window:fullscreen', (event, on: unknown) => senderWindow(event)?.setFullScreen(Boolean(on)))
    main = createWindow('main')
    void controller.start()
  })

  app.on('window-all-closed', () => app.quit())
}
