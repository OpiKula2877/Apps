// An unlocked vault: which slot it lives in and how it is written back.
// A key that opens no slot still yields a working session: its content comes from
// the deterministic generator and nothing it does is ever written.
import { equalBytes, randomBytes, randomInt } from './bytes'
import { generateVault } from './fake'
import { DEFAULT_PARAMS, deriveMaster, slotKeys, type KdfParams, type SlotKeys } from './kdf'
import { SLOT_COUNT, VaultFile, assemble, openSlot, sealBody } from './vaultFile'
import { emptyVault, vaultFromJson, vaultToJson, type Vault } from './vault'

export interface Owner {
  name: string
  email: string
}

const filler = (): Uint8Array => randomBytes(1500 + randomInt(6000))

export class Session {
  private constructor(
    public file: VaultFile,
    public vault: Vault,
    private keys: SlotKeys | null,
    private own: number | null,
    private partnerKeys: SlotKeys | null,
    private partnerPlain: Uint8Array | null,
    private readonly owner: Owner
  ) {}

  static async createNew(raw: string, owner: Owner, params: KdfParams = DEFAULT_PARAMS): Promise<Session> {
    const file = VaultFile.create(params)
    const keys = await slotKeys(await deriveMaster(raw, file.salt, file.params))
    const vault = emptyVault(owner.name)
    return new Session(file, vault, keys, randomInt(SLOT_COUNT), await slotKeys(vault.partner), filler(), owner)
  }

  static async unlock(file: VaultFile, raw: string, owner: Owner): Promise<Session> {
    return Session.unlockWithMaster(file, await deriveMaster(raw, file.salt, file.params), owner)
  }

  /** Open with an already derived master secret (used by fingerprint unlock). */
  static async unlockWithMaster(file: VaultFile, master: Uint8Array, owner: Owner): Promise<Session> {
    const keys = await slotKeys(master)
    for (let index = 0; index < file.slots.length; index++) {
      const plain = await openSlot(keys, file.aad, file.slots[index])
      if (plain === null) continue
      let vault: Vault
      try {
        vault = vaultFromJson(plain)
      } catch {
        continue
      }
      const partnerKeys = await slotKeys(vault.partner)
      const partnerPlain = await openSlot(partnerKeys, file.aad, file.slots[1 - index])
      return new Session(file, vault, keys, index, partnerKeys, partnerPlain, owner)
    }
    return new Session(file, generateVault(keys.fakeSeed, owner.name, owner.email), keys, null, null, null, owner)
  }

  /** False when nothing this session does reaches storage. */
  get writes(): boolean {
    return this.own !== null
  }

  /** Master secret of this session (for fingerprint unlock); null after close. */
  get master(): Uint8Array | null {
    return this.keys ? new Uint8Array(this.keys.master) : null
  }

  private get ownsPartner(): boolean {
    return this.own !== null && this.partnerPlain !== null
  }

  /** Return the new file content, or null when the session does not write. */
  async encrypt(): Promise<Uint8Array | null> {
    if (this.own === null || this.keys === null) return null
    const aad = this.file.aad
    const bodies = new Map([[this.own, await sealBody(this.keys, aad, vaultToJson(this.vault))]])
    if (this.ownsPartner) bodies.set(1 - this.own, await sealBody(this.partnerKeys!, aad, this.partnerPlain!))
    this.file = assemble(this.file, bodies)
    return this.file.toBytes()
  }

  /** Configure a second key. Returns an error code or null. */
  async setDecoy(raw: string): Promise<'same_as_main' | null> {
    if (!this.ownsPartner) {
      this.vault.partner = randomBytes(32)
      this.vault.decoySet = true
      return null
    }
    const master = await deriveMaster(raw, this.file.salt, this.file.params)
    if (equalBytes(master, this.keys!.master)) return 'same_as_main'
    const partnerKeys = await slotKeys(master)
    if (!this.vault.decoySet) {
      this.partnerPlain = vaultToJson(generateVault(partnerKeys.fakeSeed, this.owner.name, this.owner.email))
    }
    this.partnerKeys = partnerKeys
    this.vault.partner = master
    this.vault.decoySet = true
    return null
  }

  async removeDecoy(): Promise<void> {
    this.vault.partner = randomBytes(32)
    this.vault.decoySet = false
    if (this.ownsPartner) {
      this.partnerKeys = await slotKeys(this.vault.partner)
      this.partnerPlain = filler()
    }
  }

  close(): void {
    this.vault = emptyVault()
    this.keys = null
    this.partnerKeys = null
    this.partnerPlain = null
    this.own = null
  }
}
