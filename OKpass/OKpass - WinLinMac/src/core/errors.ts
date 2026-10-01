// Map network, HTTP and OAuth failures onto the three storage error kinds.
import { AuthError, BackendError, OfflineError } from './backend'

const NETWORK_CODES = new Set(['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'EPIPE', 'UND_ERR_CONNECT_TIMEOUT'])

export function statusError(status: number, text: string): Error {
  if (status === 401) return new AuthError(text || 'unauthorized')
  if (status === 408 || status === 429 || status >= 500) return new OfflineError(text || `HTTP ${status}`)
  return new BackendError(text || `HTTP ${status}`)
}

export function classifyError(error: unknown): Error {
  if (error instanceof OfflineError || error instanceof AuthError || error instanceof BackendError) return error
  const e = (error ?? {}) as {
    name?: string
    message?: string
    code?: string | number
    cause?: { code?: string }
    response?: { status?: number; data?: { error?: string } }
  }
  const message = e.message ?? String(error)
  if (e.response?.data?.error === 'invalid_grant') return new AuthError(message)
  if (typeof e.response?.status === 'number') return statusError(e.response.status, message)
  if (e.name === 'TimeoutError' || e.name === 'AbortError' || error instanceof TypeError) return new OfflineError(message)
  const code = String(e.code ?? e.cause?.code ?? '')
  if (NETWORK_CODES.has(code)) return new OfflineError(message)
  return new BackendError(message)
}
