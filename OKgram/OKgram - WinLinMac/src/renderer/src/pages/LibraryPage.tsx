// The library window: tabs Media and Albums, the sources panel, sync status, upload,
// settings and dialogs.
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import type { LibraryState, MediaItem, SourceState, SyncState, Transfer } from '../../../shared/ipc'
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
import { SourceDialog } from '../dialogs/SourceDialog'
import { UploadTargetDialog } from '../dialogs/UploadTargetDialog'
import { AlbumsTab } from '../library/AlbumsTab'
import { LibraryContext, type AlbumPickOptions, type LibraryServices } from '../library/context'
import { MediaBrowser } from '../library/MediaBrowser'
import { SourcesPanel } from '../library/SourcesPanel'
import { TransfersPanel } from '../library/TransfersPanel'

interface AlbumEdit {
  album: Album | null
  parent: string | null
  items: string[]
  resolve: (id: string | null) => void
}

interface TargetQuestion {
  sources: SourceState[]
  count: number | null
  resolve: (id: string | null) => void
}

export function LibraryPage() {
  const { t, settings, updateSettings, notify } = useApp()
  const [library, setLibrary] = useState<LibraryState>({ media: [], loading: false })
  const [data, setData] = useState<LibraryData | null>(null)
  const [sources, setSources] = useState<SourceState[]>([])
  const [status, setStatus] = useState<SyncState>('saved')
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [tab, setTab] = useState<'media' | 'albums'>('media')
  const [album, setAlbum] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [details, setDetails] = useState<MediaItem | null>(null)
  const [picker, setPicker] = useState<{ options: AlbumPickOptions; resolve: (id: string | null | undefined) => void } | null>(null)
  const [albumEdit, setAlbumEdit] = useState<AlbumEdit | null>(null)
  const [sourceEdit, setSourceEdit] = useState<SourceState | null | undefined>(undefined)
  const [target, setTarget] = useState<TargetQuestion | null>(null)
  const [dropping, setDropping] = useState(false)

  useEffect(() => {
    void api.getLibrary().then(setLibrary)
    void api.getData().then(setData)
    void api.getSources().then(setSources)
    void api.getStatus().then(setStatus)
    void api.getTransfers().then(setTransfers)
    const offs = [api.onLibrary(setLibrary), api.onData(setData), api.onSources(setSources), api.onStatus(setStatus), api.onTransfers(setTransfers)]
    return () => offs.forEach((off) => off())
  }, [])

  const enabled = useMemo(() => new Set(sources.filter((s) => s.enabled).map((s) => s.id)), [sources])
  const media = useMemo(() => library.media.filter((m) => enabled.has(m.source)), [library.media, enabled])
  const byId = useMemo(() => new Map(media.map((m) => [m.id, m])), [media])
  const sourceById = useMemo(() => new Map(sources.map((s) => [s.id, s])), [sources])
  const selectAlbum = useCallback((id: string | null) => setAlbum(id), [])
  const albumTarget = tab === 'albums' && album && !isSmart(album) ? album : null

  /** Which source new files go to: the only ticked one, or the user's choice. */
  const chooseTarget = useCallback(
    (count: number | null): Promise<string | null> => {
      const ready = sources.filter((s) => s.status === 'ready')
      const ticked = ready.filter((s) => s.enabled)
      const candidates = ticked.length ? ticked : ready
      if (!sources.length) {
        setSourceEdit(null)
        return Promise.resolve(null)
      }
      if (!candidates.length) {
        notify(t('upload.no_source'), true)
        return Promise.resolve(null)
      }
      if (candidates.length === 1) return Promise.resolve(candidates[0].id)
      return new Promise((resolve) => setTarget({ sources: candidates, count, resolve }))
    },
    [sources, notify, t]
  )

  const upload = useCallback(
    async (paths?: string[], albumId: string | null = albumTarget): Promise<void> => {
      const source = await chooseTarget(paths?.length ?? null)
      if (source) await api.upload(source, paths, albumId)
    },
    [chooseTarget, albumTarget]
  )
  const uploadRef = useRef(upload)
  uploadRef.current = upload

  const services: LibraryServices | null = data && {
    sources,
    media,
    byId,
    data,
    sourceOf: (item) => sourceById.get(item.source),
    showDetails: setDetails,
    pickAlbum: (options) => new Promise((resolve) => setPicker({ options, resolve })),
    editAlbum: (edit) =>
      new Promise((resolve) =>
        setAlbumEdit('album' in edit ? { album: edit.album, parent: edit.album.parent, items: [], resolve } : { album: null, parent: edit.parent, items: edit.items ?? [], resolve })
      ),
    showAlbum: (id) => {
      setTab('albums')
      setAlbum(id)
    },
    upload,
    addSource: () => setSourceEdit(null)
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
      else if (modKey(event) && key === 'u') void uploadRef.current()
      else if (modKey(event) && key === '1') setTab('media')
      else if (modKey(event) && key === '2') setTab('albums')
      else if (modKey(event) && key === ',') setSettingsOpen(true)
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Files dragged in from the system are uploaded (into the open album, if any).
  const isFileDrag = (event: DragEvent): boolean => event.dataTransfer.types.includes('Files') && !event.dataTransfer.types.includes(MEDIA_DRAG)
  const onDrop = (event: DragEvent): void => {
    setDropping(false)
    if (!isFileDrag(event)) return
    event.preventDefault()
    const paths = [...event.dataTransfer.files].map((file) => api.pathForFile(file)).filter(Boolean)
    if (paths.length) void upload(paths)
  }

  if (!services || !data) return <div className="page" />
  const noSources = sources.length === 0
  const allHidden = !noSources && enabled.size === 0
  const emptyLibrary = noSources ? (
    <div className="empty-card">
      <Icon name="folder" size={40} />
      <p>{t('source.none_info')}</p>
      <button type="button" className="primary" onClick={() => setSourceEdit(null)}>
        <Icon name="plus" size={16} /> {t('source.add_button')}
      </button>
    </div>
  ) : allHidden ? (
    <div className="empty-card">
      <Icon name="check" size={40} />
      <p>{t('source.all_hidden')}</p>
    </div>
  ) : (
    <div className="empty-card">
      <Icon name="upload" size={40} />
      <p>{t('media.empty')}</p>
      <button type="button" className="primary" onClick={() => void upload()}>
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
          if (!isFileDrag(e) || noSources) return
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
          {data.profile.username && <span className="muted user-name ellipsis">{data.profile.username}</span>}
          {!noSources && <span className={`status-pill state-${status}`}>{t(`status.${status}`)}</span>}
          <button type="button" className="primary" disabled={noSources} title={`${t('media.upload')} (${MOD}U)`} onClick={() => void upload()}>
            <Icon name="upload" size={16} /> {t('media.upload')}
          </button>
          <IconButton icon="refresh" label={`${t('media.refresh')} (F5)`} className={library.loading ? 'spinning' : ''} onClick={() => void api.refresh()} />
          <IconButton
            icon="folder"
            label={t(settings.sources_panel ? 'source.hide_panel' : 'source.show_panel')}
            active={settings.sources_panel}
            onClick={() => void updateSettings({ sources_panel: !settings.sources_panel })}
          />
          <IconButton icon="settings" label={t('library.settings')} onClick={() => setSettingsOpen(true)} />
        </div>
        <div className="library-main">
          <div className="library-body">
            <div className={`tab-pane ${tab === 'media' ? '' : 'hidden'}`}>
              <MediaBrowser source={media} active={tab === 'media'} empty={library.loading && !media.length && !noSources ? <p className="empty muted">{t('media.loading')}</p> : emptyLibrary} />
            </div>
            <div className={`tab-pane ${tab === 'albums' ? '' : 'hidden'}`}>
              <AlbumsTab active={tab === 'albums'} current={album} onSelect={selectAlbum} />
            </div>
          </div>
          {(settings.sources_panel || noSources) && (
            <SourcesPanel sources={sources} onAdd={() => setSourceEdit(null)} onEdit={setSourceEdit} onHide={() => void updateSettings({ sources_panel: false })} />
          )}
        </div>
        <TransfersPanel transfers={transfers} />
        {dropping && (
          <div className="drop-overlay">
            <Icon name="upload" size={48} />
            <p>{t(albumTarget ? 'media.drop_album' : 'media.drop_here', { name: data.albums.find((a) => a.id === albumTarget)?.name ?? '' })}</p>
          </div>
        )}
        {settingsOpen && <SettingsDialog username={data.profile.username} onClose={() => setSettingsOpen(false)} />}
        {details && <DetailsDialog item={byId.get(details.id) ?? details} data={data} source={sourceById.get(details.source)} onClose={() => setDetails(null)} />}
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
        {sourceEdit !== undefined && <SourceDialog source={sourceEdit} onClose={() => setSourceEdit(undefined)} />}
        {target && (
          <UploadTargetDialog
            sources={target.sources}
            count={target.count}
            onDone={(id) => {
              target.resolve(id)
              setTarget(null)
            }}
          />
        )}
      </div>
    </LibraryContext.Provider>
  )
}
