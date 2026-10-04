// Copies of files the user sends from the phone: outgoing/<token>/<original name>. The core reads the copy when the
// receiver accepts, which can be much later, so a copy stays while its offer waits or sends and goes once it is over.

const NEVER_OFFERED_MS = 3600_000

/** The token folder of a source path below outgoing/, or null. */
export function outgoingToken(source: string): string | null {
  const match = /[\\/]outgoing[\\/]([^\\/]+)[\\/][^\\/]+$/.exec(source)
  return match ? match[1] : null
}

/**
 * Token folders to delete. `refs` maps tokens used by outgoing file messages to whether that transfer is still
 * open (offered, accepted, transferring). Folders no message uses (shared, not sent yet) get an hour.
 */
export function outgoingToDelete(dirs: { token: string; mtimeMs: number }[], refs: Map<string, boolean>, now: number): string[] {
  return dirs
    .filter((dir) => {
      const active = refs.get(dir.token)
      if (active === undefined) return now - dir.mtimeMs > NEVER_OFFERED_MS
      return !active
    })
    .map((dir) => dir.token)
}
