// The relay fallback as the settings describe it.
import type { Settings } from '../../../shared/ipc'
import type { RelayConfig } from '../swarm'
import type { RelaySocketFactory } from './transport'

export function relayFromSettings(settings: Pick<Settings, 'relay_fallback' | 'relay_urls' | 'relay_only'>, socket: RelaySocketFactory | null): RelayConfig | null {
  if (!socket || !settings.relay_fallback || settings.relay_urls.length === 0) return null
  return { urls: settings.relay_urls, socket, only: settings.relay_only }
}

/** The relay settings changed (the network has to switch the fallback). */
export const relayChanged = (a: Settings, b: Settings): boolean =>
  a.relay_fallback !== b.relay_fallback || a.relay_only !== b.relay_only || a.relay_urls.join(' ') !== b.relay_urls.join(' ')
