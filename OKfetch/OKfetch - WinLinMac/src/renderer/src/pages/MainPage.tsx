import { useState } from 'react'
import { IconButton } from '../components/Icon'
import { useApp } from '../context'
import { useData } from '../data'
import { FetchPage } from './FetchPage'
import { SettingsPage } from './SettingsPage'

/** Header (Fetch | Settings, name, network status, bell) and the two pages. */
export function MainPage() {
  const { t } = useApp()
  const { profile, net, pendingCount } = useData()
  const [page, setPage] = useState<'fetch' | 'settings'>('fetch')
  return (
    <div className="page main-page">
      <div className="vault-header">
        {(['fetch', 'settings'] as const).map((key) => (
          <button key={key} type="button" className={`seg ${page === key ? 'checked' : ''}`} onClick={() => setPage(key)}>
            {t(`tabs.${key}`)}
          </button>
        ))}
        <div className="grow" />
        <span className="muted user-name">{profile?.username || t('header.no_name')}</span>
        <span className={`status-pill net-${net}`}>{t(`net.${net}`)}</span>
        <span className="bell">
          <IconButton icon="bell" label={t('header.requests')} onClick={() => setPage('fetch')} />
          {pendingCount > 0 && <span className="badge bell-badge">{pendingCount}</span>}
        </span>
      </div>
      <div className="vault-body">
        <FetchPage visible={page === 'fetch'} />
        <SettingsPage visible={page === 'settings'} />
      </div>
    </div>
  )
}
