import { useState } from 'react'
import { ALBUM_ICONS, FRAME_COLORS, FRAME_HEX, type Album, type AlbumIcon, type FrameColor } from '../../../shared/model'
import { Icon } from '../components/Icon'
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
      <div className="icon-picker" role="radiogroup" aria-label={t('album.icon')}>
        {ALBUM_ICONS.map((name) => (
          <button
            key={name}
            type="button"
            role="radio"
            aria-checked={icon === name}
            className={`icon-choice ${icon === name ? 'checked' : ''}`}
            title={t(`icon.${name}`)}
            aria-label={t(`icon.${name}`)}
            style={color ? { color: FRAME_HEX[color] } : undefined}
            onClick={() => setIcon(name)}
          >
            <Icon name={name} size={20} />
          </button>
        ))}
      </div>
      <label className="field-label">{t('album.color')}</label>
      <div className="color-picker" role="radiogroup" aria-label={t('album.color')}>
        <button type="button" role="radio" aria-checked={color === null} className={`color-choice ${color === null ? 'checked' : ''}`} onClick={() => setColor(null)}>
          <span className="swatch-dot" />
          {t('color.none')}
        </button>
        {FRAME_COLORS.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={color === c} className={`color-choice ${color === c ? 'checked' : ''}`} onClick={() => setColor(c)}>
            <span className="swatch-dot" style={{ background: FRAME_HEX[c] }} />
            {t(`color.${c}`)}
          </button>
        ))}
      </div>
    </Modal>
  )
}
