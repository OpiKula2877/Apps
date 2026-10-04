import { useEffect, useState } from 'react'
import { DEFAULT_RELAYS } from '../../../core/settings'
import type { NetDiagnostics, ProbeResult } from '../../../shared/model'
import { api } from '../api'
import { Icon } from '../components/Icon'
import { useApp } from '../context'
import { useData } from '../data'
import { shortId } from '../util/format'

const KNOWN_CODES = ['CONNECTED', 'PEER_NOT_FOUND', 'HOLEPUNCH_DOUBLE_RANDOMIZED_NATS', 'TIMEOUT']

/** Human explanation of a test connection (the DHT error codes are kept for the copied report). */
function explain(result: ProbeResult, t: (key: string, params?: Record<string, string | number>) => string): string {
  if (result.ok) return result.code === 'CONNECTED' ? t(result.via === 'relay' ? 'diag.probe.connected_relay' : 'diag.probe.connected') : t('diag.probe.ok', { ms: result.ms })
  const code = result.code ?? ''
  if (KNOWN_CODES.includes(code)) return t(`diag.probe.${code.toLowerCase()}`)
  if (/HOLEPUNCH|NOT_HOLEPUNCHABLE|CANNOT_HOLEPUNCH/.test(code)) return t('diag.probe.holepunch')
  return t('diag.probe.other', { code })
}

/** Settings → network: what the DHT sees of this device, and a test connection to every contact and request. */
export function NetworkGroup() {
  const { t, notify, settings, updateSettings } = useApp()
  const { contacts, requests } = useData()
  const [relayText, setRelayText] = useState(settings.relay_urls.join('\n'))
  const [info, setInfo] = useState<NetDiagnostics | null>(null)
  const [results, setResults] = useState<Record<string, ProbeResult | 'running'>>({})

  useEffect(() => {
    let alive = true
    const load = (): void => void api.getNetDiagnostics().then((value) => alive && setInfo(value)).catch(() => undefined)
    load()
    const timer = window.setInterval(load, 4000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [])

  const targets = [
    ...contacts.filter((c) => !c.blocked).map((c) => ({ pub: c.pub, name: c.name })),
    ...requests.outgoing.filter((r) => r.state !== 'rejected').map((r) => ({ pub: r.pub, name: r.name || shortId(r.pub) }))
  ]

  const probe = async (pub: string): Promise<void> => {
    setResults((current) => ({ ...current, [pub]: 'running' }))
    const result = await api.probePeer(pub).catch(() => ({ ok: false, code: 'ERROR', ms: 0 }))
    setResults((current) => ({ ...current, [pub]: result }))
  }

  const nat = !info ? '…' : !info.firewalled ? t('diag.nat.open') : info.randomized ? t('diag.nat.randomized') : t('diag.nat.consistent')

  const copy = (): void => {
    const lines = [
      `OKfetch ${api.platform}`,
      `status: ${info?.status ?? '?'}`,
      `public: ${info?.host ?? '?'}:${info?.port ?? '?'} firewalled=${info?.firewalled} randomized=${info?.randomized}`,
      `local: ${info?.localAddresses.join(', ') || '-'}`,
      `connections: ${info?.connections ?? '?'}`,
      `relay: ${info?.relay ? `${info.relay.connected}/${info.relay.relays} links=${info.relay.links}` : 'off'} ${settings.relay_urls.join(' ')}`,
      ...targets.map((target) => {
        const result = results[target.pub]
        const text = !result ? 'not tested' : result === 'running' ? 'running' : `${result.ok ? 'ok' : 'fail'} ${result.code ?? ''} ${result.ms} ms`
        return `${target.name} ${shortId(target.pub)}: ${text}`
      })
    ]
    void api.copyText(lines.join('\n'))
    notify(t('diag.copied'))
  }

  return (
    <fieldset className="group network-group">
      <legend>{t('diag.title')}</legend>
      <p className="muted">{t('diag.info')}</p>
      <div className="diag-grid">
        <span>{t('diag.status')}</span>
        <b>{info ? t(`net.${info.status}`) : '…'}</b>
        <span>{t('diag.public')}</span>
        <span className="mono">{info?.host ? `${info.host}:${info.port || '*'}` : '—'}</span>
        <span>{t('diag.nat')}</span>
        <span>{nat}</span>
        <span>{t('diag.local')}</span>
        <span className="mono">{info?.localAddresses.length ? info.localAddresses.join(', ') : <span className="error-text">{t('diag.local_none')}</span>}</span>
        <span>{t('diag.connections')}</span>
        <span>{info?.connections ?? '…'}</span>
      </div>
      <h3 className="subheading">{t('relay.title')}</h3>
      <p className="muted">{t('relay.info')}</p>
      <label className="check">
        <input type="checkbox" checked={settings.relay_fallback} onChange={(e) => void updateSettings({ relay_fallback: e.target.checked })} />
        {t('relay.enable')}
      </label>
      {settings.relay_fallback && (
        <>
          <p className={info?.relay && info.relay.connected === 0 ? 'banner' : 'muted'}>
            {info?.relay ? t('relay.status', { connected: info.relay.connected, total: info.relay.relays, links: info.relay.links }) : '…'}
          </p>
          <label className="field-label">{t('relay.list')}</label>
          <textarea className="mono relay-list" rows={4} spellCheck={false} value={relayText} onChange={(e) => setRelayText(e.target.value)} />
          <div className="row">
            <button
              type="button"
              onClick={() => {
                const urls = relayText.split(/\s+/).map((u) => u.trim()).filter(Boolean)
                void updateSettings({ relay_urls: urls }).then(() => notify(t('relay.saved')))
              }}
            >
              {t('common.save')}
            </button>
            <button
              type="button"
              className="link"
              onClick={() => {
                setRelayText(DEFAULT_RELAYS.join('\n'))
                void updateSettings({ relay_urls: [...DEFAULT_RELAYS] })
              }}
            >
              {t('relay.defaults')}
            </button>
          </div>
        </>
      )}
      {targets.length > 0 && <h3 className="subheading">{t('diag.peers')}</h3>}
      {targets.map((target) => {
        const result = results[target.pub]
        return (
          <div key={target.pub} className="diag-peer">
            <div className="row">
              <span className="grow ellipsis">
                {target.name} <span className="muted mono">{shortId(target.pub)}</span>
              </span>
              <button type="button" disabled={result === 'running'} onClick={() => void probe(target.pub)}>
                {result === 'running' ? t('common.working') : t('diag.test')}
              </button>
            </div>
            {result && result !== 'running' && <div className={result.ok ? 'muted' : 'banner'}>{explain(result, t)}</div>}
          </div>
        )
      })}
      <button type="button" onClick={copy}>
        <Icon name="copy" size={16} /> {t('diag.copy')}
      </button>
    </fieldset>
  )
}
