// Persisted core state: small JSON files in the storage folder. Chat logs live in storage/chats.
import { join } from 'node:path'
import type { BlockedPeer, IncomingRequest, OutboxEntry, OutgoingRequest, Profile, StoredContact, StoredGroup } from './records'
import { readJson, writeJson } from './storage/jsonStore'

interface ContactsFile {
  contacts: StoredContact[]
  incoming: IncomingRequest[]
  outgoing: OutgoingRequest[]
}

export interface KeyProtector {
  /** Protect a secret with the operating system (DPAPI, Keychain, libsecret). */
  protect(secret: string): string
  unprotect(blob: string): string
  /** Name of the backend, shown in the settings ('dpapi', 'keychain', 'gnome_libsecret', 'basic_text', ...). */
  readonly backend: string
  readonly strong: boolean
}

/** Tests and headless use: no real protection. */
export const plainProtector: KeyProtector = {
  protect: (secret) => `plain:${Buffer.from(secret, 'utf8').toString('base64')}`,
  unprotect: (blob) => Buffer.from(blob.replace(/^plain:/, ''), 'base64').toString('utf8'),
  backend: 'none',
  strong: false
}

export class CoreState {
  profile: Profile
  contacts: StoredContact[]
  incoming: IncomingRequest[]
  outgoing: OutgoingRequest[]
  groups: StoredGroup[]
  blocked: BlockedPeer[]
  outbox: OutboxEntry[]

  constructor(readonly root: string) {
    this.profile = readJson<Profile>(this.file('profile.json'), { username: '', avatar: null, kBlob: null, lamport: 0 })
    const contacts = readJson<ContactsFile>(this.file('contacts.json'), { contacts: [], incoming: [], outgoing: [] })
    this.contacts = contacts.contacts
    this.incoming = contacts.incoming
    this.outgoing = contacts.outgoing
    this.groups = readJson<StoredGroup[]>(this.file('groups.json'), [])
    this.blocked = readJson<BlockedPeer[]>(this.file('blocked.json'), [])
    this.outbox = readJson<OutboxEntry[]>(this.file('outbox.json'), [])
  }

  file(name: string): string {
    return join(this.root, name)
  }

  saveProfile(): void {
    writeJson(this.file('profile.json'), this.profile)
  }

  saveContacts(): void {
    writeJson(this.file('contacts.json'), { contacts: this.contacts, incoming: this.incoming, outgoing: this.outgoing } satisfies ContactsFile)
  }

  saveGroups(): void {
    writeJson(this.file('groups.json'), this.groups)
  }

  saveBlocked(): void {
    writeJson(this.file('blocked.json'), this.blocked)
  }

  saveOutbox(): void {
    writeJson(this.file('outbox.json'), this.outbox)
  }
}
