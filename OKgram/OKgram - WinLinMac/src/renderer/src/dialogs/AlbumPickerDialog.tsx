import { useMemo, useState } from 'react'
import { FRAME_HEX } from '../../../shared/model'
import { Icon } from '../components/Icon'
import { Modal } from '../components/Modal'
import { useApp } from '../context'
import { albumOutline } from '../library/actions'
import { useLibrary, type AlbumPickOptions } from '../library/context'

/** Choose an album (or the top level) from the album tree. */
export function AlbumPickerDialog({ options, onDone }: { options: AlbumPickOptions; onDone: (id: string | null | undefined) => void }) {
  const { t, settings } = useApp()
  const { data, editAlbum } = useLibrary()
  const [query, setQuery] = useState('')
  const [chosen, setChosen] = useState<string | null | undefined>(undefined)
  const outline = useMemo(() => albumOutline(data.albums, settings.album_sort), [data.albums, settings.album_sort])
  const words = query.toLocaleLowerCase().trim()
  const shown = words ? outline.filter(({ album }) => album.name.toLocaleLowerCase().includes(words)) : outline

  const create = async (): Promise<void> => {
    const id = await editAlbum({ parent: null })
    if (id) setChosen(id)
  }

  return (
    <Modal
      title={options.title}
      onClose={() => onDone(undefined)}
      width={480}
      height={560}
      footer={
        <>
          <button type="button" className="footer-left" onClick={() => void create()}>
            <Icon name="plus" size={16} /> {t('album.new')}
          </button>
          <button type="button" onClick={() => onDone(undefined)}>
            {t('common.cancel')}
          </button>
          <button type="button" className="primary" disabled={chosen === undefined} onClick={() => onDone(chosen)}>
            {options.confirmText}
          </button>
        </>
      }
    >
      <div className="search">
        <Icon name="search" size={16} />
        <input type="search" value={query} placeholder={t('album.search')} data-autofocus onChange={(e) => setQuery(e.target.value)} />
      </div>
      <ul className="list picker-list" role="listbox">
        {options.allowTop && !words && (
          <li className={chosen === null ? 'selected' : ''} role="option" aria-selected={chosen === null} onClick={() => setChosen(null)} onDoubleClick={() => onDone(null)}>
            <Icon name="home" size={16} /> {t('album.top_level')}
          </li>
        )}
        {shown.map(({ album, depth }) => {
          const disabled = options.exclude?.has(album.id)
          return (
            <li
              key={album.id}
              role="option"
              aria-selected={chosen === album.id}
              aria-disabled={disabled}
              className={`${chosen === album.id ? 'selected' : ''} ${disabled ? 'disabled' : ''}`}
              style={{ paddingLeft: 8 + (words ? 0 : depth) * 18 }}
              onClick={() => !disabled && setChosen(album.id)}
              onDoubleClick={() => !disabled && onDone(album.id)}
            >
              <span style={album.color && chosen !== album.id ? { color: FRAME_HEX[album.color] } : undefined}>
                <Icon name={album.icon} size={16} />
              </span>
              <span className="ellipsis">{album.name}</span>
              <span className="muted count">{album.items.length}</span>
            </li>
          )
        })}
        {!shown.length && <li className="muted disabled">{t(outline.length ? 'album.none_found' : 'album.none_yet')}</li>}
      </ul>
    </Modal>
  )
}
