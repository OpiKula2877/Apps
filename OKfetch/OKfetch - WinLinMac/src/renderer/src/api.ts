import type { OkfetchApi } from '../../shared/ipc'

// The preload script of Electron provides the API.
export const api: OkfetchApi = window.okfetch!
