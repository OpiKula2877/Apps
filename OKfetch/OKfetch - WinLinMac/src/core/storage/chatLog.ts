// One chat = one append-only JSON-lines file. Updates and deletions are appended as records and
// folded in when the file is loaded; compaction rewrites the file with only the live messages.
import { existsSync, readFileSync } from 'node:fs'
import type { MessagePatch, StoredMessage } from '../records'
import { appendLine, writeText } from './jsonStore'

type LogRecord = ({ op: 'm' } & StoredMessage) | { op: 'u'; id: string; patch: MessagePatch } | { op: 'd'; id: string }

const COMPACT_MIN_RECORDS = 200

export function applyPatch(message: StoredMessage, patch: MessagePatch): void {
  if (patch.waiting) message.waiting = patch.waiting
  if (patch.read !== undefined) message.read = patch.read
  if (patch.file && message.file) message.file = { ...message.file, ...patch.file }
}

export class ChatLog {
  readonly messages = new Map<string, StoredMessage>()
  private deleted = new Set<string>()
  private records = 0

  constructor(private path: string) {
    this.load()
  }

  private load(): void {
    if (!existsSync(this.path)) return
    for (const line of readFileSync(this.path, 'utf8').split('\n')) {
      if (!line.trim()) continue
      let record: LogRecord
      try {
        record = JSON.parse(line) as LogRecord
      } catch {
        continue // a torn last line after a crash
      }
      this.records++
      if (record.op === 'm') {
        const { op: _op, ...message } = record
        if (!this.deleted.has(message.id)) this.messages.set(message.id, message)
      } else if (record.op === 'u') {
        const message = this.messages.get(record.id)
        if (message) applyPatch(message, record.patch)
      } else if (record.op === 'd') {
        this.messages.delete(record.id)
        this.deleted.add(record.id)
      }
    }
    this.compactIfNeeded()
  }

  has(id: string): boolean {
    return this.messages.has(id) || this.deleted.has(id)
  }

  add(message: StoredMessage): boolean {
    if (this.has(message.id)) return false
    this.messages.set(message.id, message)
    this.write({ op: 'm', ...message })
    return true
  }

  update(id: string, patch: MessagePatch): StoredMessage | null {
    const message = this.messages.get(id)
    if (!message) return null
    applyPatch(message, patch)
    this.write({ op: 'u', id, patch })
    return message
  }

  remove(id: string): boolean {
    if (!this.messages.delete(id)) return false
    this.deleted.add(id)
    this.write({ op: 'd', id })
    return true
  }

  sorted(): StoredMessage[] {
    return [...this.messages.values()].sort((a, b) => a.lamport - b.lamport || a.ts - b.ts || (a.id < b.id ? -1 : 1))
  }

  private write(record: LogRecord): void {
    appendLine(this.path, JSON.stringify(record))
    this.records++
    this.compactIfNeeded()
  }

  /** Rewrite the file when most records are updates or tombstones. */
  compactIfNeeded(): void {
    if (this.records > COMPACT_MIN_RECORDS && this.records > this.messages.size * 3) this.compact()
  }

  compact(): void {
    const lines = this.sorted().map((message) => JSON.stringify({ op: 'm', ...message }))
    for (const id of this.deleted) lines.push(JSON.stringify({ op: 'd', id }))
    writeText(this.path, lines.length ? `${lines.join('\n')}\n` : '')
    this.records = lines.length
  }
}
