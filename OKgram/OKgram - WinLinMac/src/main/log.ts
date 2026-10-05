// Error log in the settings folder (logs/okgram.log). The user sees friendly messages;
// the details land here for troubleshooting. No file contents or tokens are written.
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { logDir } from './config'

const MAX_BYTES = 1024 * 1024

export const logFile = (): string => join(logDir(), 'okgram.log')

export function log(text: string): void {
  try {
    mkdirSync(logDir(), { recursive: true })
    try {
      if (statSync(logFile()).size > MAX_BYTES) renameSync(logFile(), join(logDir(), 'okgram.old.log'))
    } catch {
      // no log yet
    }
    appendFileSync(logFile(), `${new Date().toISOString()} ${text.replace(/\s+/g, ' ').slice(0, 2000)}\n`, 'utf8')
  } catch {
    // logging must never break the app
  }
}

export function logError(context: string, error: unknown): void {
  const e = error as Error
  log(`[${context}] ${e?.name ?? 'Error'}: ${e?.message ?? String(error)}${e?.stack ? ` | ${e.stack.split('\n').slice(1, 4).join(' ')}` : ''}`)
}
