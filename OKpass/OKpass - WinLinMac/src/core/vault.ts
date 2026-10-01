// Vault held by the main process and its JSON form (identical to the Python version).
import {
  FIELD_KINDS,
  newField,
  newId,
  nowSeconds,
  type Field,
  type FieldKind,
  type PasswordEntry,
  type TextDocument,
  type VaultData
} from '../shared/model'
import { fromBase64, fromUtf8, randomBytes, toBase64, utf8 } from './bytes'

export const FORMAT = 1

export interface Vault {
  username: string
  documents: TextDocument[]
  passwords: PasswordEntry[]
  /** Master secret of the other slot. Never leaves the main process. */
  partner: Uint8Array
  decoySet: boolean
}

export function emptyVault(username = ''): Vault {
  return { username, documents: [], passwords: [], partner: randomBytes(32), decoySet: false }
}

type Raw = Record<string, unknown>

const asRaw = (value: unknown): Raw => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : {})
const asList = (value: unknown): Raw[] => (Array.isArray(value) ? value.filter((v) => v && typeof v === 'object').map(asRaw) : [])
const asNumber = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : nowSeconds())
const asId = (value: unknown): string => (typeof value === 'string' && value ? value : newId())

function fieldFromRaw(raw: Raw): Field {
  const kind = FIELD_KINDS.includes(raw.kind as FieldKind) ? (raw.kind as FieldKind) : 'custom'
  const name = raw.name === null || raw.name === undefined ? null : String(raw.name)
  return { id: asId(raw.id), kind, name: kind === 'custom' && name === null ? '' : name, value: String(raw.value ?? '') }
}

function entryFromRaw(raw: Raw): PasswordEntry {
  const fields = asList(raw.fields).map(fieldFromRaw)
  for (const kind of ['password', 'username', 'title'] as FieldKind[]) {
    if (!fields.some((f) => f.kind === kind)) fields.unshift(newField(kind))
  }
  fields.sort((a, b) => FIELD_KINDS.indexOf(a.kind) - FIELD_KINDS.indexOf(b.kind))
  return { id: asId(raw.id), created: asNumber(raw.created), modified: asNumber(raw.modified), fields }
}

function documentFromRaw(raw: Raw): TextDocument {
  return {
    id: asId(raw.id),
    title: String(raw.title ?? ''),
    html: String(raw.html ?? ''),
    created: asNumber(raw.created),
    modified: asNumber(raw.modified)
  }
}

export function vaultFromJson(data: Uint8Array): Vault {
  const parsed: unknown = JSON.parse(fromUtf8(data))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('vault JSON must be an object')
  const raw = parsed as Raw
  let partner: Uint8Array = new Uint8Array(0)
  if (typeof raw.partner === 'string') partner = fromBase64(raw.partner)
  if (partner.length !== 32) partner = randomBytes(32)
  return {
    username: String(asRaw(raw.profile).username ?? ''),
    documents: asList(raw.documents).map(documentFromRaw),
    passwords: asList(raw.passwords).map(entryFromRaw),
    partner,
    decoySet: Boolean(raw.decoy_set)
  }
}

export function vaultToJson(vault: Vault): Uint8Array {
  const json = {
    format: FORMAT,
    profile: { username: vault.username },
    documents: vault.documents.map((d) => ({ id: d.id, title: d.title, html: d.html, created: d.created, modified: d.modified })),
    passwords: vault.passwords.map((p) => ({
      id: p.id,
      created: p.created,
      modified: p.modified,
      fields: p.fields.map((f) => ({ id: f.id, kind: f.kind, name: f.name, value: f.value }))
    })),
    partner: toBase64(vault.partner),
    decoy_set: vault.decoySet
  }
  return utf8(JSON.stringify(json))
}

/** Copy for the renderer (without the partner secret). */
export function toData(vault: Vault): VaultData {
  return structuredClone({
    username: vault.username,
    documents: vault.documents,
    passwords: vault.passwords,
    decoySet: vault.decoySet
  })
}

/** Take the user's edits from the renderer. Decoy state is managed by the main process only. */
export function applyData(vault: Vault, data: VaultData): void {
  const clean = vaultFromJson(utf8(JSON.stringify({ profile: { username: data.username }, documents: data.documents, passwords: data.passwords })))
  vault.username = clean.username
  vault.documents = clean.documents
  vault.passwords = clean.passwords
}
