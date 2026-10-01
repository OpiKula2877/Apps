// Limits wrong-password attempts: 5 per public key, then a block for 15 minutes, plus a global ceiling
// against someone who rotates through fresh keys.

export const MAX_ATTEMPTS = 5
export const WINDOW_MS = 15 * 60 * 1000
export const GLOBAL_MAX_FAILURES = 30

export interface RateVerdict {
  allowed: boolean
  /** Milliseconds until a new attempt is possible (0 when allowed). */
  retryAfterMs: number
}

export class RateLimiter {
  private failures = new Map<string, number[]>()
  private blockedUntil = new Map<string, number>()
  private global: number[] = []

  constructor(private now: () => number = Date.now) {}

  private prune(list: number[]): number[] {
    const limit = this.now() - WINDOW_MS
    return list.filter((time) => time > limit)
  }

  check(pub: string): RateVerdict {
    const now = this.now()
    const until = this.blockedUntil.get(pub) ?? 0
    if (until > now) return { allowed: false, retryAfterMs: until - now }
    this.global = this.prune(this.global)
    if (this.global.length >= GLOBAL_MAX_FAILURES) return { allowed: false, retryAfterMs: this.global[0] + WINDOW_MS - now }
    return { allowed: true, retryAfterMs: 0 }
  }

  fail(pub: string): RateVerdict {
    const now = this.now()
    const recent = this.prune(this.failures.get(pub) ?? [])
    recent.push(now)
    this.failures.set(pub, recent)
    this.global = this.prune(this.global)
    this.global.push(now)
    if (recent.length >= MAX_ATTEMPTS) {
      this.blockedUntil.set(pub, now + WINDOW_MS)
      this.failures.delete(pub)
    }
    return this.check(pub)
  }

  success(pub: string): void {
    this.failures.delete(pub)
  }
}
