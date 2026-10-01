import { useEffect, useState } from 'react'
import iconUrl from '../../../../resources/icon.png'
import { api } from '../api'
import { useApp } from '../context'
import { IconButton } from './Icon'

/** Own window title bar used when the system frame is turned off. */
export function TitleBar() {
  const { t } = useApp()
  const [maximized, setMaximized] = useState(false)
  useEffect(() => api.onMaximized(setMaximized), [])
  return (
    <header className="titlebar" onDoubleClick={() => api.windowToggleMaximize()}>
      <img className="titlebar-logo" src={iconUrl} alt="" draggable={false} />
      <span className="titlebar-title">OKpass</span>
      <div className="titlebar-spacer" />
      <div className="titlebar-buttons" onDoubleClick={(e) => e.stopPropagation()}>
        <IconButton icon="minimize" label={t('window.minimize')} size={16} className="titlebar-button" onClick={() => api.windowMinimize()} />
        <IconButton
          icon={maximized ? 'restore' : 'maximize'}
          label={t('window.maximize')}
          size={16}
          className="titlebar-button"
          onClick={() => api.windowToggleMaximize()}
        />
        <IconButton icon="close" label={t('window.close')} size={16} className="titlebar-button titlebar-close" onClick={() => api.windowClose()} />
      </div>
    </header>
  )
}
