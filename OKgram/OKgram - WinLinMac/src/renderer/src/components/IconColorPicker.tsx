// Icon and colour choice shared by the album and source dialogs.
import { ALBUM_ICONS, FRAME_COLORS, FRAME_HEX, type AlbumIcon, type FrameColor } from '../../../shared/model'
import { useApp } from '../context'
import { Icon } from './Icon'

export function IconPicker({ value, color, onChange }: { value: AlbumIcon; color: FrameColor | null; onChange: (icon: AlbumIcon) => void }) {
  const { t } = useApp()
  return (
    <div className="icon-picker" role="radiogroup" aria-label={t('album.icon')}>
      {ALBUM_ICONS.map((name) => (
        <button
          key={name}
          type="button"
          role="radio"
          aria-checked={value === name}
          className={`icon-choice ${value === name ? 'checked' : ''}`}
          title={t(`icon.${name}`)}
          aria-label={t(`icon.${name}`)}
          style={color ? { color: FRAME_HEX[color] } : undefined}
          onClick={() => onChange(name)}
        >
          <Icon name={name} size={20} />
        </button>
      ))}
    </div>
  )
}

export function ColorPicker({ value, onChange }: { value: FrameColor | null; onChange: (color: FrameColor | null) => void }) {
  const { t } = useApp()
  return (
    <div className="color-picker" role="radiogroup" aria-label={t('album.color')}>
      <button type="button" role="radio" aria-checked={value === null} className={`color-choice ${value === null ? 'checked' : ''}`} onClick={() => onChange(null)}>
        <span className="swatch-dot" />
        {t('color.no_color')}
      </button>
      {FRAME_COLORS.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} className={`color-choice ${value === c ? 'checked' : ''}`} onClick={() => onChange(c)}>
          <span className="swatch-dot" style={{ background: FRAME_HEX[c] }} />
          {t(`color.${c}`)}
        </button>
      ))}
    </div>
  )
}
