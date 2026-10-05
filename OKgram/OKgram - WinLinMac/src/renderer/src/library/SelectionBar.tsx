import { useState } from 'react'
import type { MediaItem } from '../../../shared/ipc'
import { metaOf } from '../../../shared/model'
import { api } from '../api'
import { ContextMenu, type MenuState } from '../components/ContextMenu'
import { Icon } from '../components/Icon'
import { useApp } from '../context'
import { useMediaActions, type MenuContext } from './actions'
import { useLibrary } from './context'

/** Actions for several selected files at once. */
export function SelectionBar({ items, context, onClear, onSelectAll }: { items: MediaItem[]; context: MenuContext; onClear: () => void; onSelectAll: () => void }) {
  const { t } = useApp()
  const { data } = useLibrary()
  const actions = useMediaActions()
  const [menu, setMenu] = useState<MenuState | null>(null)
  const ids = items.map((m) => m.id)
  const allStarred = items.every((m) => metaOf(data, m.id).star)
  return (
    <div className="selection-bar" role="toolbar" aria-label={t('selection.title')}>
      <button type="button" className="icon-button" title={t('selection.clear')} aria-label={t('selection.clear')} onClick={onClear}>
        <Icon name="close" size={16} />
      </button>
      <span className="selection-count">{t('selection.count', { count: items.length })}</span>
      <button type="button" className="link" onClick={onSelectAll}>
        {t('selection.all')}
      </button>
      <div className="grow" />
      <button type="button" onClick={() => void api.download(ids)}>
        <Icon name="download" size={16} /> {t('menu.download')}
      </button>
      <button type="button" onClick={() => void actions.addToAlbum(ids)}>
        <Icon name="album_add" size={16} /> {t('selection.to_album')}
      </button>
      <button type="button" onClick={() => actions.setStar(ids, !allStarred)}>
        <Icon name="star" size={16} filled={allStarred} /> {t(allStarred ? 'menu.unstar' : 'menu.star')}
      </button>
      <button type="button" onClick={(e) => setMenu({ x: e.clientX, y: e.clientY, items: actions.menu(items, context) })}>
        <Icon name="more" size={16} /> {t('selection.more')}
      </button>
      <button type="button" className="danger-outline" onClick={() => void actions.trash(items).then((ok) => ok && onClear())}>
        <Icon name="trash" size={16} /> {t('menu.trash')}
      </button>
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </div>
  )
}
