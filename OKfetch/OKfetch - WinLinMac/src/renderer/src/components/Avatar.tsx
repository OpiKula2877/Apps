import { initial } from '../util/format'
import { Icon } from './Icon'

interface Props {
  name: string
  src?: string | null
  size?: number
  /** Shows the presence dot when set. */
  online?: boolean
  group?: boolean
}

/** Round picture of a contact or group with an optional presence dot. */
export function Avatar({ name, src, size = 34, online, group }: Props) {
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.45 }}>
      {src ? <img src={src} alt="" draggable={false} /> : group ? <Icon name="users" size={Math.round(size * 0.55)} /> : <span>{initial(name)}</span>}
      {online !== undefined && <span className={`status-dot ${online ? 'online' : 'offline'}`} />}
    </span>
  )
}
