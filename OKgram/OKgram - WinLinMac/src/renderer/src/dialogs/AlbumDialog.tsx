import { useState } from 'react'
import type { Album, AlbumIcon, FrameColor } from '../../../shared/model'
import { ColorPicker, IconPicker } from '../components/IconColorPicker'
import { Modal } from '../components/Modal'
import { useApp } from '../context'

export interface AlbumDraft {
  name: string
  icon: AlbumIcon
  color: FrameColor | null
}

/** Name, icon and colour of a new or existing album. */
export function AlbumDialog({ album, onDone }: { album: Album | null; onDone: (draft: AlbumDraft | null) => void }) {
  const { t } = useApp()
  const [name, setName] = useState(album?.name ?? '')
  const [icon, setIcon] = useState<AlbumIcon>(album?.icon ?? 'folder')
  const [color, setColor] = useState<FrameColor | null>(album?.color ?? null)
  const submit = (): void => {
    if (name.trim()) onDone({ name: name.trim(), icon, color })
  }
  return (
    <Modal
      title={t(album ? 'album.edit_title' : 'album.new_title')}
      onClose={() => onDone(null)}
      width={520}
      footer={
        <>
          <button type="button" onClick={() => onDone(null)}>
            {t('common.cancel')}
          </button>
          <button type="button" className="primary" disabled={!name.trim()} onClick={submit}>
            {t(album ? 'common.save' : 'album.create')}
          </button>
        </>
      }
    >
      <label className="field-label">{t('album.name')}</label>
      <input value={name} maxLength={100} data-autofocus placeholder={t('album.name_placeholder')} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
      <label className="field-label">{t('album.icon')}</label>
      <IconPicker value={icon} color={color} onChange={setIcon} />
      <label className="field-label">{t('album.color')}</label>
      <ColorPicker value={color} onChange={setColor} />
    </Modal>
  )
}
