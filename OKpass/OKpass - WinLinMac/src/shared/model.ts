// Vault data shared by the main process and the renderer.
// Times are seconds since the epoch (same as the Python version).

export type FieldKind = 'title' | 'username' | 'password' | 'custom'
export const FIELD_KINDS: FieldKind[] = ['title', 'username', 'password', 'custom']

export interface Field {
  id: string
  kind: FieldKind
  /** null = translated default label (default kinds only); custom fields always carry a string. */
  name: string | null
  value: string
}

export interface PasswordEntry {
  id: string
  created: number
  modified: number
  fields: Field[]
}

export interface TextDocument {
  id: string
  title: string
  html: string
  created: number
  modified: number
}

/** What the renderer sees of an unlocked vault (no key material). */
export interface VaultData {
  username: string
  documents: TextDocument[]
  passwords: PasswordEntry[]
  decoySet: boolean
}

export function newId(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, '')
}

export function nowSeconds(): number {
  return Date.now() / 1000
}

export function newField(kind: FieldKind, name: string | null = null, value = ''): Field {
  return { id: newId(), kind, name, value }
}

export function newEntry(): PasswordEntry {
  const t = nowSeconds()
  return { id: newId(), created: t, modified: t, fields: [newField('title'), newField('username'), newField('password')] }
}

export function newDocument(title: string): TextDocument {
  const t = nowSeconds()
  return { id: newId(), title, html: '', created: t, modified: t }
}

function fieldValue(entry: PasswordEntry, kind: FieldKind): string {
  return entry.fields.find((f) => f.kind === kind)?.value ?? ''
}

export const entryTitle = (entry: PasswordEntry): string => fieldValue(entry, 'title')
export const entryUsername = (entry: PasswordEntry): string => fieldValue(entry, 'username')

/** Text used by the search box: values (except passwords) and field labels set by the user. */
export function entrySearchText(entry: PasswordEntry): string {
  const values = entry.fields.filter((f) => f.kind !== 'password').map((f) => f.value)
  const names = entry.fields.map((f) => f.name ?? '')
  return [...values, ...names].join(' ').toLocaleLowerCase()
}

/**
 * Rename a field. Default fields fall back to their translated label when the
 * new name is blank; custom fields keep whatever was typed.
 */
export function setFieldName(field: Field, name: string): Field {
  if (field.kind === 'custom') return { ...field, name }
  return { ...field, name: name.trim() ? name : null }
}
