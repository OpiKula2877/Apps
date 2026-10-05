import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import type { OkgramApi } from '../../shared/ipc'

// The preload script provides the API (see src/preload/index.ts).
export const api: OkgramApi = window.okgram!

/** ⌘ on macOS, Ctrl elsewhere. */
export const MOD = api.platform === 'macos' ? '⌘' : 'Ctrl+'

export const modKey = (event: KeyboardEvent | MouseEvent | ReactMouseEvent | ReactKeyboardEvent): boolean =>
  api.platform === 'macos' ? event.metaKey : event.ctrlKey
