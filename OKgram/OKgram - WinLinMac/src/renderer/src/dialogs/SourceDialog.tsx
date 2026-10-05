// Add a source (a folder on this computer or a Google Drive account) or edit one.
import { useEffect, useState } from 'react'
import type { AddSourceResult, Message, SourceDraft, SourceState } from '../../../shared/ipc'
import type { AlbumIcon, FrameColor } from '../../../shared/model'
import { api } from '../api'
import { Icon } from '../components/Icon'
import { ColorPicker, IconPicker } from '../components/IconColorPicker'
import { Modal } from '../components/Modal'
import { useApp } from '../context'

type Kind = 'local' | 'drive'

const folderName = (path: string): string => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path

/** source: edit that source; null: add a new one (first choose the kind). */
export function SourceDialog({ source, onClose }: { source: SourceState | null; onClose: (id?: string) => void }) {
  const { t } = useApp()
  const [kind, setKind] = useState<Kind | null>(source?.kind ?? null)
  const [name, setName] = useState(source?.name ?? '')
  const [icon, setIcon] = useState<AlbumIcon>(source?.icon ?? 'folder')
  const [color, setColor] = useState<FrameColor | null>(source?.color ?? null)
  const [path, setPath] = useState(source?.path ?? '')
  const [subfolders, setSubfolders] = useState(source?.subfolders ?? true)
  const [needSecret, setNeedSecret] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Message | null>(null)

  useEffect(() => {
    if (source) return
    void api.defaultFolder().then((folder) => setPath((p) => p || folder))
    void api.hasClientSecret().then((has) => setNeedSecret(!has))
  }, [source])

  const choose = (next: Kind): void => {
    setKind(next)
    setIcon(next === 'drive' ? 'globe' : 'folder')
    setError(null)
  }

  const pickFolder = async (): Promise<void> => {
    const folder = await api.pickFolder(path || null)
    if (folder) setPath(folder)
  }

  const chooseSecret = async (): Promise<void> => {
    const result = await api.chooseClientSecret()
    if (result === 'ok') setNeedSecret(false)
    else if (result !== 'cancel') setError({ key: `login.secret_${result}`, error: true })
  }

  const finish = (result: AddSourceResult): void => {
    setBusy(false)
    if (result.ok) onClose(result.id)
    else setError(result.error ?? { key: 'source.failed', error: true })
  }

  const submit = async (): Promise<void> => {
    setError(null)
    setBusy(true)
    const draft: SourceDraft = { name: name.trim(), icon, color }
    if (kind === 'local') Object.assign(draft, { path: path.trim(), subfolders, name: name.trim() || folderName(path.trim()) })
    if (source) return finish(await api.updateSource(source.id, draft))
    if (kind === 'local') return finish(await api.addLocalSource(draft))
    finish(await api.addDriveSource(draft, t('login.browser_success')))
  }

  const title = source ? t('source.edit_title') : kind === null ? t('source.add_title') : t(kind === 'local' ? 'source.add_local' : 'source.add_drive')
  const canSubmit = !busy && (kind !== 'local' || Boolean(path.trim())) && !(kind === 'drive' && !source && needSecret)

  return (
    <Modal
      title={title}
      onClose={() => !busy && onClose()}
      width={560}
      footer={
        kind === null ? (
          <button type="button" onClick={() => onClose()}>
            {t('common.cancel')}
          </button>
        ) : (
          <>
            {!source && (
              <button type="button" className="footer-left" disabled={busy} onClick={() => setKind(null)}>
                ← {t('source.back')}
              </button>
            )}
            <button type="button" disabled={busy} onClick={() => onClose()}>
              {t('common.cancel')}
            </button>
            <button type="button" className="primary" disabled={!canSubmit} onClick={() => void submit()}>
              {kind === 'drive' && !source && <Icon name="google" size={16} />}
              {t(source ? 'common.save' : kind === 'drive' ? 'login.button' : 'source.add')}
            </button>
          </>
        )
      }
    >
      {kind === null ? (
        <div className="mode-choices">
          <button type="button" className="mode-choice" onClick={() => choose('local')}>
            <Icon name="monitor" size={30} />
            <span className="mode-title">{t('source.local')}</span>
            <span className="muted">{t('source.local_info')}</span>
          </button>
          <button type="button" className="mode-choice" onClick={() => choose('drive')}>
            <Icon name="cloud" size={30} />
            <span className="mode-title">{t('source.drive')}</span>
            <span className="muted">{t('source.drive_info')}</span>
          </button>
        </div>
      ) : (
        <>
          {kind === 'drive' && !source && (
            <>
              <p className="muted">{t('source.drive_login_info')}</p>
              {needSecret && (
                <div className="stack">
                  <p>{t('login.need_secret')}</p>
                  <button type="button" onClick={() => void chooseSecret()}>
                    <Icon name="file" size={16} /> {t('login.choose_secret')}
                  </button>
                </div>
              )}
            </>
          )}
          {kind === 'drive' && source?.account && (
            <p>
              <span className="muted">{t('source.account')}:</span> {source.account.email}
            </p>
          )}
          {kind === 'local' && (
            <>
              <label className="field-label">{t('source.folder')}</label>
              <div className="row">
                <input className="grow" value={path} readOnly title={path} />
                <button type="button" disabled={busy} onClick={() => void pickFolder()}>
                  <Icon name="folder" size={16} /> {t('source.choose_folder')}
                </button>
              </div>
              <label className="check">
                <input type="checkbox" checked={subfolders} onChange={(e) => setSubfolders(e.target.checked)} />
                {t('source.subfolders')}
              </label>
            </>
          )}
          <label className="field-label">{t('source.name')}</label>
          <input
            value={name}
            maxLength={60}
            data-autofocus
            placeholder={kind === 'local' ? folderName(path) || t('source.local') : t('source.name_drive_placeholder')}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && canSubmit && void submit()}
          />
          <label className="field-label">{t('album.icon')}</label>
          <IconPicker value={icon} color={color} onChange={setIcon} />
          <label className="field-label">{t('album.color')}</label>
          <ColorPicker value={color} onChange={setColor} />
          {busy && <p className="muted">{t(kind === 'drive' && !source ? 'login.waiting_browser' : 'login.opening')}</p>}
          {error && <p className="error-text">{t(error.key, error.params)}</p>}
        </>
      )}
    </Modal>
  )
}
