import { memo, useEffect, useState } from 'react'
import type { MediaItem } from '../../../shared/ipc'
import { FRAME_HEX, type ItemMeta } from '../../../shared/model'
import { thumbUrl } from '../urls'
import { formatDuration } from '../i18n'
import { generateThumb } from '../library/generator'
import { Icon } from './Icon'

interface Props {
  item: MediaItem
  meta: ItemMeta
  /** Small list icon: no badges. */
  compact?: boolean
}

/** Thumbnail with the colour frame, star, video length and rotation. */
export const Thumb = memo(function Thumb({ item, meta, compact = false }: Props) {
  const [retry, setRetry] = useState(0)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setRetry(0)
    setFailed(false)
  }, [item.id, item.version])

  const onError = (): void => {
    if (retry > 0) return setFailed(true)
    void generateThumb(item).then((ok) => (ok ? setRetry(1) : setFailed(true)))
  }

  const frame = meta.color ? FRAME_HEX[meta.color] : null
  return (
    <div className={`thumb ${frame ? 'framed' : ''}`} style={frame ? { ['--frame' as string]: frame } : undefined}>
      {failed ? (
        <div className="thumb-placeholder">
          <Icon name={item.kind === 'video' ? 'film' : 'image'} size={compact ? 18 : 32} />
          {!compact && <span>{item.ext.toUpperCase()}</span>}
        </div>
      ) : (
        <img
          src={thumbUrl(item.id, item.version, retry)}
          alt=""
          decoding="async"
          draggable={false}
          onError={onError}
          style={meta.rotation ? { transform: `rotate(${meta.rotation}deg)` } : undefined}
        />
      )}
      {!compact && meta.star && (
        <span className="badge badge-star" aria-hidden="true">
          <Icon name="star" size={14} filled />
        </span>
      )}
      {!compact && item.kind === 'video' && (
        <span className="badge badge-video">
          <Icon name="play" size={11} filled />
          {item.duration ? formatDuration(item.duration) : item.ext.toUpperCase()}
        </span>
      )}
      {!compact && item.shared && (
        <span className="badge badge-shared" aria-hidden="true">
          <Icon name="link" size={12} />
        </span>
      )}
    </div>
  )
})
