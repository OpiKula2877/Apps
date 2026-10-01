// Start with the system: login item on Windows and macOS, an autostart .desktop file on Linux.
import { app } from 'electron'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const desktopFile = (): string => join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'autostart', 'okfetch.desktop')

export function setAutostart(enabled: boolean): void {
  if (process.env.OKFETCH_CONFIG_DIR) return // test runs never touch the system
  if (process.platform === 'linux') {
    if (!enabled) return rmSync(desktopFile(), { force: true })
    mkdirSync(join(desktopFile(), '..'), { recursive: true })
    const exec = process.env.APPIMAGE || process.execPath
    writeFileSync(desktopFile(), `[Desktop Entry]\nType=Application\nName=OKfetch\nExec="${exec}" --hidden\nX-GNOME-Autostart-enabled=true\n`, 'utf8')
    return
  }
  app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] })
}
