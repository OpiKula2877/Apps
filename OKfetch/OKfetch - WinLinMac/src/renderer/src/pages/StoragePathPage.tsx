import { useState } from 'react'
import { api } from '../api'
import { Icon, Logo } from '../components/Icon'
import { useApp } from '../context'

/** Shown when the storage folder cannot be used (not writable, missing drive): the user picks another one. */
export function StoragePathPage({ path, error }: { path: string; error: string }) {
  const { t } = useApp()
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const choose = async (): Promise<void> => {
    const folder = await api.pickFolder()
    if (!folder) return
    setBusy(true)
    const result = await api.useStoragePath(folder, false)
    setBusy(false)
    if (!result.ok) setMessage(t(`storage.error.${result.error}`))
  }

  return (
    <div className="page center-page">
      <div className="card key-card">
        <Logo />
        <h1 className="subheading center">{t('storage.title')}</h1>
        <p>{t('storage.info')}</p>
        <p className="mono-path">{path}</p>
        <div className="banner">{t(`storage.error.${error}`) === `storage.error.${error}` ? error : t(`storage.error.${error}`)}</div>
        {message && <div className="banner">{message}</div>}
        <button type="button" className="primary big" disabled={busy} onClick={() => void choose()}>
          <Icon name="folder" size={18} /> {t('storage.choose')}
        </button>
        <button type="button" className="link" disabled={busy} onClick={() => void api.useStoragePath(path, false).then((r) => !r.ok && setMessage(t(`storage.error.${r.error}`)))}>
          {t('storage.retry')}
        </button>
      </div>
    </div>
  )
}
