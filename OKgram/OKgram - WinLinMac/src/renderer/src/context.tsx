// Application-wide services for components: translation, settings, notices and questions.
import { createContext, useContext } from 'react'
import type { Settings } from '../../shared/ipc'
import type { Translate } from './i18n'

export interface ConfirmOptions {
  title: string
  text: string
  confirmText: string
  danger?: boolean
}

export interface PromptOptions {
  title: string
  label?: string
  value: string
  confirmText: string
  /** Shown after the field, e.g. the file extension. */
  suffix?: string
  /** Error text for the value, or null when it is fine. */
  validate?: (value: string) => string | null
}

export interface AppServices {
  t: Translate
  settings: Settings
  updateSettings(patch: Partial<Settings>): Promise<void>
  notify(text: string, error?: boolean): void
  confirm(options: ConfirmOptions): Promise<boolean>
  prompt(options: PromptOptions): Promise<string | null>
  openHelp(): void
}

export const AppContext = createContext<AppServices | null>(null)

export function useApp(): AppServices {
  const services = useContext(AppContext)
  if (!services) throw new Error('AppContext missing')
  return services
}
