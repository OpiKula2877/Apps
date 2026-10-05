import type { RefObject } from 'react'
import type { MediaKind } from '../../../shared/ipc'
import type { MediaFilter } from '../../../shared/library'
import { FRAME_COLORS, FRAME_HEX, type FrameColor } from '../../../shared/model'
import { THUMB_MAX, THUMB_MIN } from '../../../shared/prefs'
import { MOD } from '../api'
import { Icon, IconButton } from '../components/Icon'
import { useApp } from '../context'

interface Props {
  filter: MediaFilter
  onFilter: (filter: MediaFilter) => void
  sort: string
  sortOptions: string[]
  onSort: (sort: string) => void
  desc: boolean
  onDesc: (desc: boolean) => void
  count: number
  total: number
  searchRef: RefObject<HTMLInputElement | null>
}

/** Search, filters, sorting and the grid/list switch above a media grid. */
export function MediaToolbar({ filter, onFilter, sort, sortOptions, onSort, desc, onDesc, count, total, searchRef }: Props) {
  const { t, settings, updateSettings } = useApp()
  const set = (patch: Partial<MediaFilter>): void => onFilter({ ...filter, ...patch })
  const filtered = filter.query || filter.starOnly || filter.color || filter.kind
  return (
    <div className="media-toolbar">
      <div className="search toolbar-search">
        <Icon name="search" size={16} />
        <input
          ref={searchRef}
          type="search"
          value={filter.query}
          placeholder={t('media.search')}
          title={`${t('media.search')} (${MOD}F)`}
          onChange={(e) => set({ query: e.target.value })}
          onKeyDown={(e) => e.key === 'Escape' && (set({ query: '' }), e.currentTarget.blur())}
        />
      </div>
      <button type="button" className={`chip ${filter.starOnly ? 'checked' : ''}`} aria-pressed={filter.starOnly} onClick={() => set({ starOnly: !filter.starOnly })} title={t('media.filter_star')}>
        <Icon name="star" size={15} filled={filter.starOnly} /> {t('media.favorites')}
      </button>
      <select value={filter.kind ?? ''} aria-label={t('media.filter_kind')} onChange={(e) => set({ kind: (e.target.value || null) as MediaKind | null })}>
        <option value="">{t('media.kind_all')}</option>
        <option value="image">{t('media.kind_image')}</option>
        <option value="video">{t('media.kind_video')}</option>
      </select>
      <div className="color-filter" role="group" aria-label={t('media.filter_color')}>
        {FRAME_COLORS.map((c: FrameColor) => (
          <button
            key={c}
            type="button"
            className={`color-dot ${filter.color === c ? 'checked' : ''}`}
            style={{ background: FRAME_HEX[c] }}
            title={`${t('media.filter_color')}: ${t(`color.${c}`)}`}
            aria-label={`${t('media.filter_color')}: ${t(`color.${c}`)}`}
            aria-pressed={filter.color === c}
            onClick={() => set({ color: filter.color === c ? null : c })}
          />
        ))}
      </div>
      <div className="grow" />
      <span className="muted count-label">{filtered ? t('media.count_filtered', { count, total }) : t('media.count', { count })}</span>
      <select value={sort} aria-label={t('media.sort')} onChange={(e) => onSort(e.target.value)}>
        {sortOptions.map((option) => (
          <option key={option} value={option}>
            {t(`sort.${option}`)}
          </option>
        ))}
      </select>
      <IconButton icon={desc ? 'sort_desc' : 'sort_asc'} label={t(desc ? 'sort.desc' : 'sort.asc')} onClick={() => onDesc(!desc)} />
      <div className="separator" />
      <IconButton icon="grid" label={t('media.view_grid')} active={settings.view === 'grid'} onClick={() => void updateSettings({ view: 'grid' })} />
      <IconButton icon="list" label={t('media.view_list')} active={settings.view === 'list'} onClick={() => void updateSettings({ view: 'list' })} />
      {settings.view === 'grid' && (
        <input
          className="size-slider"
          type="range"
          min={THUMB_MIN}
          max={THUMB_MAX}
          step={2}
          value={settings.thumb_size}
          aria-label={t('media.thumb_size')}
          title={t('media.thumb_size')}
          onChange={(e) => void updateSettings({ thumb_size: Number(e.target.value) })}
        />
      )}
    </div>
  )
}
