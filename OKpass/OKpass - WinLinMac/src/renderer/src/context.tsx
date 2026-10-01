// Application-wide services for components: translation, settings, notices and confirmations.
import { createContext, useContext } from 'react'
import type { Settings } from '../../shared/ipc'
import type { Translate } from './i18n'

export interface ConfirmOptions {
  title: string
  text: string
  confirmText: string
  danger?: boolean
}

export interface AppServices {
  t: Translate
  settings: Settings
  updateSettings(patch: Partial<Settings>): Promise<void>
  notify(text: string, error?: boolean): void
  confirm(options: ConfirmOptions): Promise<boolean>
  openHelp(): void
}

export const AppContext = createContext<AppServices | null>(null)

export function useApp(): AppServices {
  const services = useContext(AppContext)
  if (!services) throw new Error('AppContext missing')
  return services
}
