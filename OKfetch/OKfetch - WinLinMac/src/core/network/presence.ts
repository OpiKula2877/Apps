// Presence = "there is an open, authenticated connection to this public key".
export class Presence {
  private online = new Set<string>()

  /** Returns true when the state changed. */
  set(pub: string, online: boolean): boolean {
    if (online === this.online.has(pub)) return false
    if (online) this.online.add(pub)
    else this.online.delete(pub)
    return true
  }

  isOnline(pub: string): boolean {
    return this.online.has(pub)
  }

  all(): string[] {
    return [...this.online]
  }
}
