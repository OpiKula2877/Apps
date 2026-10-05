// The library window: tabs Media and Albums, sync status, upload, settings and dialogs.
import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react'
import type { LibraryState, MediaItem, Screen, SyncState, Transfer } from '../../../shared/ipc'
import { isSmart } from '../../../shared/library'
import { newId, type Album, type LibraryData } from '../../../shared/model'
import { MOD, api, modKey } from '../api'
import { Icon, IconButton } from '../components/Icon'
import { MEDIA_DRAG } from '../components/MediaGrid'
import { anyModalOpen } from '../components/Modal'
import { useApp } from '../context'
import { AlbumDialog, type AlbumDraft } from '../dialogs/AlbumDialog'
import { AlbumPickerDialog } from '../dialogs/AlbumPickerDialog'
import { DetailsDialog } from '../dialogs/DetailsDialog'
import { SettingsDialog } from '../dialogs/SettingsDialog'
import { AlbumsTab } from '../library/AlbumsTab'
import { LibraryContext, type AlbumPickOptions, type LibraryServices } from '../library/context'
import { MediaBrowser } from '../library/MediaBrowser'
import { TransfersPanel } from '../library/TransfersPanel'

type LibraryScreen = Extract<Screen, { name: 'library' }>

interface AlbumEdit {
  album: Album | null
  parent: string | null
  items: string[]
  resolve: (id: string | null) => void
}

export function LibraryPage({ screen }: { screen: LibraryScreen }) {
  const { t } = useApp()
  const [library, setLibrary] = useState<LibraryState>({ media: [], online: true, loading: false })
  const [data, setData] = useState<LibraryData | null>(null)
  const [status, setStatus] = useState<SyncState>('saved')
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [tab, setTab] = useState<'media' | 'albums'>('media')
  const [album, setAlbum] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [details, setDetails] = useState<MediaItem | null>(null)
  const [picker, setPicker] = useState<{ options: AlbumPickOptions; resolve: (id: string | null | undefined) => void } | null>(null)
  const [albumEdit, setAlbumEdit] = useState<AlbumEdit | null>(null)
  const [dropping, setDropping] = useState(false)

  useEffect(() => {
    void api.getLibrary().then(setLibrary)
    void api.getData().then(setData)
    void api.getStatus().then(setStatus)
    void api.getTransfers().then(setTransfers)
    const offs = [api.onLibrary(setLibrary), api.onData(setData), api.onStatus(setStatus), api.onTransfers(setTransfers)]
    return () => offs.forEach((off) => off())
  }, [])

  const byId = useMemo(() => new Map(library.media.map((m) => [m.id, m])), [library.media])
  const selectAlbum = useCallback((id: string | null) => setAlbum(id), [])
  const uploadTarget = tab === 'albums' && album && !isSmart(album) ? album : null

  const services: LibraryServices | null = data && {
    mode: screen.mode,
    media: library.media,
    byId,
    data,
    online: library.online,
    showDetails: setDetails,
    pickAlbum: (options) => new Promise((resolve) => setPicker({ options, resolve })),
    editAlbum: (target) =>
      new Promise((resolve) =>
        setAlbumEdit('album' in target ? { album: target.album, parent: target.album.parent, items: [], resolve } : { album: null, parent: target.parent, items: target.items ?? [], resolve })
      ),
    showAlbum: (id) => {
      setTab('albums')
      setAlbum(id)
    }
  }

  const finishAlbumEdit = async (draft: AlbumDraft | null): Promise<void> => {
    if (!albumEdit) return
    const { album: existing, parent, items, resolve } = albumEdit
    setAlbumEdit(null)
    if (!draft) return resolve(null)
    if (existing) {
      await api.mutate({ type: 'album.update', id: existing.id, patch: draft })
      return resolve(existing.id)
    }
    const id = newId()
    await api.mutate({ type: 'album.create', id, parent, items, ...draft })
    resolve(id)
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (anyModalOpen()) return
      const key = event.key.toLowerCase()
      if (event.key === 'F5' || (modKey(event) && key === 'r')) void api.refresh()
      else if (modKey(event) && key === 'u') void api.upload(undefined, uploadTarget)
      else if (modKey(event) && key === '1') setTab('media')
      else if (modKey(event) && key === '2') setTab('albums')
      else if (modKey(event) && key === ',') setSettingsOpen(true)
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [uploadTarget])

  // Files dragged in from the system are uploaded (into the open album, if any).
  const isFileDrag = (event: DragEvent): boolean => event.dataTransfer.types.includes('Files') && !event.dataTransfer.types.includes(MEDIA_DRAG)
  const onDrop = (event: DragEvent): void => {
    setDropping(false)
    if (!isFileDrag(event)) return
    event.preventDefault()
    const paths = [...event.dataTransfer.files].map((file) => api.pathForFile(file)).filter(Boolean)
    if (paths.length) void api.upload(paths, uploadTarget)
  }

  if (!services || !data) return <div className="page" />
  const name = data.profile.username || screen.account.name || screen.account.email
  const emptyLibrary = (
    <div className="empty-card">
      <Icon name="upload" size={40} />
      <p>{t(screen.mode === 'drive' ? 'media.empty_drive' : 'media.empty_local')}</p>
      <button type="button" className="primary" onClick={() => void api.upload()}>
        <Icon name="upload" size={16} /> {t('media.upload_first')}
      </button>
      <p className="muted small">{t('media.drop_hint')}</p>
    </div>
  )

  return (
    <LibraryContext.Provider value={services}>
      <div
        className="page library-page"
        onDragOver={(e) => {
          if (!isFileDrag(e)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          setDropping(true)
        }}
        onDragLeave={(e) => {
          if (!e.relatedTarget) setDropping(false)
        }}
        onDrop={onDrop}
      >
        <div className="library-header">
          {(['media', 'albums'] as const).map((key, index) => (
            <button key={key} type="button" className={`seg ${tab === key ? 'checked' : ''}`} title={`${MOD}${index + 1}`} onClick={() => setTab(key)}>
              {t(`tabs.${key}`)}
            </button>
          ))}
          <div className="grow" />
          <span className="muted user-name ellipsis" title={screen.account.email}>
            {name}
          </span>
          {!library.online && <span className="status-pill state-offline">{t('status.offline')}</span>}
          <span className={`status-pill state-${status}`}>{t(`status.${status}`)}</span>
          <button type="button" className="primary" title={`${t('media.upload')} (${MOD}U)`} onClick={() => void api.upload(undefined, uploadTarget)}>
            <Icon name="upload" size={16} /> {t('media.upload')}
          </button>
          <IconButton icon="refresh" label={`${t('media.refresh')} (F5)`} className={library.loading ? 'spinning' : ''} onClick={() => void api.refresh()} />
          <IconButton icon="settings" label={t('library.settings')} onClick={() => setSettingsOpen(true)} />
        </div>
        <div className="library-body">
          <div className={`tab-pane ${tab === 'media' ? '' : 'hidden'}`}>
            <MediaBrowser source={library.media} active={tab === 'media'} empty={library.loading ? <p className="empty muted">{t('media.loading')}</p> : emptyLibrary} />
          </div>
          <div className={`tab-pane ${tab === 'albums' ? '' : 'hidden'}`}>
            <AlbumsTab active={tab === 'albums'} current={album} onSelect={selectAlbum} />
          </div>
        </div>
        <TransfersPanel transfers={transfers} />
        {dropping && (
          <div className="drop-overlay">
            <Icon name="upload" size={48} />
            <p>{t(uploadTarget ? 'media.drop_album' : 'media.drop_here', { name: data.albums.find((a) => a.id === uploadTarget)?.name ?? '' })}</p>
          </div>
        )}
        {settingsOpen && <SettingsDialog mode={screen.mode} account={screen.account} username={data.profile.username} onClose={() => setSettingsOpen(false)} />}
        {details && <DetailsDialog item={byId.get(details.id) ?? details} data={data} mode={screen.mode} onClose={() => setDetails(null)} />}
        {picker && (
          <AlbumPickerDialog
            options={picker.options}
            onDone={(id) => {
              picker.resolve(id)
              setPicker(null)
            }}
          />
        )}
        {albumEdit && <AlbumDialog album={albumEdit.album} onDone={(draft) => void finishAlbumEdit(draft)} />}
      </div>
    </LibraryContext.Provider>
  )
}
