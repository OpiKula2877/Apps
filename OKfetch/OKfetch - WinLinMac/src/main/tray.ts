// Tray icon: open / quit menu and the number of unread messages.
import { Menu, Tray, nativeImage } from 'electron'

const LABELS = {
  cs: { open: 'Otevřít OKfetch', quit: 'Ukončit', unread: (n: number) => `OKfetch – nepřečtené: ${n}` },
  en: { open: 'Open OKfetch', quit: 'Quit', unread: (n: number) => `OKfetch – unread: ${n}` }
}

export class AppTray {
  private tray: Tray | null = null
  private unread = 0

  constructor(
    private iconPath: string,
    private language: () => 'cs' | 'en',
    private onOpen: () => void,
    private onQuit: () => void
  ) {}

  show(): void {
    if (this.tray) return
    const image = nativeImage.createFromPath(this.iconPath).resize({ width: 16, height: 16 })
    this.tray = new Tray(image)
    this.tray.on('click', this.onOpen)
    this.refresh()
  }

  setUnread(count: number): void {
    this.unread = count
    this.refresh()
  }

  refresh(): void {
    if (!this.tray) return
    const text = LABELS[this.language()]
    this.tray.setToolTip(this.unread > 0 ? text.unread(this.unread) : 'OKfetch')
    this.tray.setContextMenu(Menu.buildFromTemplate([{ label: text.open, click: this.onOpen }, { type: 'separator' }, { label: text.quit, click: this.onQuit }]))
  }

  destroy(): void {
    this.tray?.destroy()
    this.tray = null
  }
}
