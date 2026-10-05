import { useEffect, useState, type ReactNode } from 'react'
import type { MediaItem, StorageMode, VideoInfo } from '../../../shared/ipc'
import { FRAME_HEX, albumPath, metaOf, type LibraryData } from '../../../shared/model'
import { Modal } from '../components/Modal'
import { useApp } from '../context'
import { formatDate, formatDuration, formatSize } from '../i18n'
import { probeVideo } from '../library/generator'

/** Size, resolution, dates, format and albums of one file (also used by the viewer's side panel). */
export function DetailsTable({ item, data, mode }: { item: MediaItem; data: LibraryData; mode: StorageMode }) {
  const { t, settings } = useApp()
  const [probe, setProbe] = useState<VideoInfo | null>(null)
  useEffect(() => {
    setProbe(null)
    if (item.kind === 'video' && (!item.width || !item.duration)) void probeVideo(item).then(setProbe)
  }, [item])
  const lang = settings.language
  const meta = metaOf(data, item.id)
  const width = item.width ?? probe?.width
  const height = item.height ?? probe?.height
  const duration = item.duration ?? probe?.duration
  const albums = data.albums.filter((a) => a.items.includes(item.id))
  const rows: [string, ReactNode][] = [
    [t('details.name'), item.name],
    [t('details.format'), `${item.ext.toUpperCase()} · ${item.mime}`],
    [t('details.size'), `${formatSize(item.size, lang)} (${item.size.toLocaleString(lang === 'cs' ? 'cs-CZ' : 'en-GB')} B)`],
    [t('details.resolution'), width && height ? `${width} × ${height} px${item.kind === 'image' ? ` · ${((width * height) / 1e6).toFixed(1)} MP` : ''}` : '–']
  ]
  if (item.kind === 'video') rows.push([t('details.duration'), duration ? formatDuration(duration) : '–'])
  rows.push(
    [t('details.taken'), item.taken ? formatDate(item.taken, lang) : '–'],
    [t('details.modified'), formatDate(item.modified, lang)],
    [t(mode === 'drive' ? 'details.uploaded' : 'details.created'), formatDate(item.created, lang)],
    [t('details.location'), mode === 'drive' ? t('details.drive_folder') : item.id],
    [t('details.star'), meta.star ? t('common.yes') : t('common.no')],
    [
      t('details.frame'),
      meta.color ? (
        <span className="row inline">
          <span className="swatch-dot" style={{ background: FRAME_HEX[meta.color] }} />
          {t(`color.${meta.color}`)}
        </span>
      ) : (
        t('color.none')
      )
    ],
    [t('details.albums'), albums.length ? albums.map((a) => albumPath(data.albums, a.id).map((p) => p.name).join(' › ')).join(', ') : '–']
  )
  if (mode === 'drive') rows.push([t('details.shared'), item.shared ? t('details.shared_yes') : t('common.no')])
  return (
    <table className="details">
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}>
            <th>{label}</th>
            <td>{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function DetailsDialog({ item, data, mode, onClose }: { item: MediaItem; data: LibraryData; mode: StorageMode; onClose: () => void }) {
  const { t } = useApp()
  return (
    <Modal
      title={t('details.title')}
      onClose={onClose}
      width={560}
      footer={
        <button type="button" className="primary" onClick={onClose}>
          {t('common.close')}
        </button>
      }
    >
      <DetailsTable item={item} data={data} mode={mode} />
    </Modal>
  )
}
