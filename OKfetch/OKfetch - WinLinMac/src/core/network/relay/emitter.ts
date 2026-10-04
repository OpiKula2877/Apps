// A small event emitter (the core runs in Node and in Bare, so it does not import node:events).
type Listener = (...args: any[]) => void

export class Emitter {
  private listeners = new Map<string, { fn: Listener; once: boolean }[]>()

  on(name: string, fn: Listener): this {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), { fn, once: false }])
    return this
  }

  once(name: string, fn: Listener): this {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), { fn, once: true }])
    return this
  }

  removeListener(name: string, fn: Listener): this {
    this.listeners.set(name, (this.listeners.get(name) ?? []).filter((l) => l.fn !== fn))
    return this
  }

  removeAllListeners(name?: string): this {
    if (name) this.listeners.delete(name)
    else this.listeners.clear()
    return this
  }

  emit(name: string, ...args: any[]): boolean {
    const list = this.listeners.get(name) ?? []
    if (list.some((l) => l.once)) this.listeners.set(name, list.filter((l) => !l.once))
    for (const l of list) l.fn(...args)
    return list.length > 0
  }
}
