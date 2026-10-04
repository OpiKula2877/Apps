import { useState } from 'react'
import { IconButton, Logo } from '../components/Icon'
import { useApp } from '../context'
import { useData } from '../data'
import { useBack, usePhone } from '../mobile/phone'
import { FetchPage } from './FetchPage'
import { SettingsPage } from './SettingsPage'

/** Header (Fetch | Settings, name, network status) and the two pages. The phone gets a compact header. */
export function MainPage() {
  const { t } = useApp()
  const { profile, net } = useData()
  const [page, setPage] = useState<'fetch' | 'settings'>('fetch')
  const phone = usePhone()
  useBack(phone && page === 'settings', () => setPage('fetch'))

  return (
    <div className="page main-page">
      {phone ? (
        <div className="vault-header phone-header">
          {page === 'settings' ? (
            <>
              <IconButton icon="back" label={t('common.back')} onClick={() => setPage('fetch')} />
              <span className="phone-title">{t('tabs.settings')}</span>
            </>
          ) : (
            <span className="phone-brand">
              <Logo />
              <span className={`net-dot net-${net}`} title={t(`net.${net}`)} aria-label={t(`net.${net}`)} />
            </span>
          )}
          <div className="grow" />
          {page === 'fetch' && <IconButton icon="settings" label={t('tabs.settings')} onClick={() => setPage('settings')} />}
        </div>
      ) : (
        <div className="vault-header">
          {(['fetch', 'settings'] as const).map((key) => (
            <button key={key} type="button" className={`seg ${page === key ? 'checked' : ''}`} onClick={() => setPage(key)}>
              {t(`tabs.${key}`)}
            </button>
          ))}
          <div className="grow" />
          <span className="muted user-name">{profile?.username || t('header.no_name')}</span>
          <span className={`status-pill net-${net}`}>{t(`net.${net}`)}</span>
        </div>
      )}
      <div className="vault-body">
        <FetchPage visible={page === 'fetch'} />
        <SettingsPage visible={page === 'settings'} />
      </div>
    </div>
  )
}
