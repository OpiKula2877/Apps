import type { OkpassApi } from '../../shared/ipc'

// Desktop: the preload script provides the API. Phone: the controller runs in this process.
export const api: OkpassApi = window.okpass ?? (await import('./mobile/bootstrap')).createMobileApi()

export const isMobile = api.platform === 'android'
