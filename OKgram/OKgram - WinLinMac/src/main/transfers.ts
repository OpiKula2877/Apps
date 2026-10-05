// Uploads, downloads and ZIP exports with progress, shown in the transfer panel.
import type { Transfer } from '../shared/ipc'

const UPDATE_MS = 150

export interface TransferHandle {
  id: string
  signal: AbortSignal
  start(): void
  progress(done: number): void
  finish(): void
  fail(error: string): void
}

export class Transfers {
  private list: Transfer[] = []
  private readonly aborts = new Map<string, AbortController>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private counter = 0

  constructor(private readonly onChange: (list: Transfer[]) => void) {}

  get all(): Transfer[] {
    return this.list
  }

  private changed(now = false): void {
    if (now) {
      if (this.timer) clearTimeout(this.timer)
      this.timer = null
      this.onChange(this.list)
      return
    }
    this.timer ??= setTimeout(() => {
      this.timer = null
      this.onChange(this.list)
    }, UPDATE_MS)
  }

  private update(id: string, patch: Partial<Transfer>, now = false): void {
    this.list = this.list.map((t) => (t.id === id ? { ...t, ...patch } : t))
    this.changed(now)
  }

  add(kind: Transfer['kind'], name: string, total: number): TransferHandle {
    const id = `t${++this.counter}`
    const abort = new AbortController()
    this.aborts.set(id, abort)
    this.list = [...this.list, { id, name, kind, done: 0, total, state: 'queued' }]
    this.changed(true)
    const end = (patch: Partial<Transfer>): void => {
      this.aborts.delete(id)
      this.update(id, patch, true)
    }
    return {
      id,
      signal: abort.signal,
      start: () => this.update(id, { state: 'active' }, true),
      progress: (done) => this.update(id, { done }),
      finish: () => end({ state: 'done', done: this.list.find((t) => t.id === id)?.total ?? 0 }),
      fail: (error) => end(abort.signal.aborted ? { state: 'cancelled' } : { state: 'error', error })
    }
  }

  cancel(id: string): void {
    this.aborts.get(id)?.abort()
    if (this.list.find((t) => t.id === id)?.state === 'queued') {
      this.aborts.delete(id)
      this.update(id, { state: 'cancelled' }, true)
    }
  }

  cancelAll(): void {
    for (const id of [...this.aborts.keys()]) this.cancel(id)
  }

  /** Remove finished, failed and cancelled transfers from the panel. */
  clear(): void {
    this.list = this.list.filter((t) => t.state === 'active' || t.state === 'queued')
    this.changed(true)
  }
}
