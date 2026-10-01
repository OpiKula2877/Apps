// Apply the selected theme as CSS variables and data attributes on <html>.
import type { Settings } from '../../shared/ipc'
import { lightness, mix, resolveColors, resolveFlags } from '../../shared/theme'
import { setBarColors } from './mobile/shell'

export function applyTheme(settings: Settings): void {
  const c = resolveColors(settings)
  const flags = resolveFlags(settings)
  const root = document.documentElement
  const vars: Record<string, string> = {
    '--bg': c.background,
    '--surface': c.surface,
    '--titlebar': c.titlebar,
    '--titlebar-text': c.titlebar_text,
    '--text': c.text,
    '--muted': c.text_muted,
    '--input': c.input,
    '--border': c.border,
    '--accent': c.accent,
    '--accent-text': c.accent_text,
    '--danger': c.danger,
    '--success': c.success,
    '--hover': mix(c.surface, c.text, 0.08),
    '--pressed': mix(c.surface, c.text, 0.14),
    '--accent-hover': mix(c.accent, '#FFFFFF', 0.12),
    '--accent-dim': mix(c.accent, c.background, 0.5),
    '--titlebar-hover': mix(c.titlebar, c.titlebar_text, 0.12),
    '--banner': mix(c.surface, c.danger, 0.18),
    '--medium': mix(c.danger, c.success, 0.5),
    '--radius': flags.rounded ? '8px' : '0px',
    '--radius-sm': flags.rounded ? '6px' : '0px',
    '--radius-lg': flags.rounded ? '12px' : '0px',
    '--font-size': `${settings.font_size}pt`
  }
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value)
  root.dataset.windowBorder = String(flags.window_border)
  root.dataset.titlebarBorder = String(flags.titlebar_border)
  root.dataset.tabUnderline = String(flags.tab_underline)
  root.dataset.listSeparators = String(flags.list_separators)
  root.dataset.nativeFrame = String(flags.native_titlebar)
  root.style.colorScheme = lightness(c.background) > 0.5 ? 'light' : 'dark'
  root.lang = settings.language
  void setBarColors(c.background, lightness(c.background) > 0.5)
}
