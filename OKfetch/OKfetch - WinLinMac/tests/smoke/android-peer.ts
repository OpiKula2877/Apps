// The desktop side of the Android end-to-end test: a plain core in Node on the public HyperDHT.
import { Core } from '../../src/core/controller'
import { DEFAULT_RELAYS } from '../../src/core/settings'
import { webSocketFactory } from '../../src/core/network/relay/webSocket'
import { contactChatId } from '../../src/shared/model'

export { contactChatId }

/** `relayOnly`: skip direct connections, as two devices behind random-port NATs (real public relays). */
export async function startPeer(root: string, username: string, relayOnly = false): Promise<Core> {
  const relay = { urls: DEFAULT_RELAYS, socket: webSocketFactory, only: relayOnly }
  const core = await Core.open({ root, retryMs: 5000, relay })
  await core.contacts.setUsername(username)
  return core
}
