// Viewer window: one photo or video at a time, arrows to the neighbours, zoom, rotation,
// star, colour frame, details, download and slideshow (full screen).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LibraryState, Screen, ViewerContext } from '../../../shared/ipc'
import { FRAME_COLORS, FRAME_HEX, emptyData, metaOf, type LibraryData } from '../../../shared/model'
import { api } from '../api'
import { ContextMenu, type MenuState } from '../components/ContextMenu'
import { Icon, IconButton } from '../components/Icon'
import { anyModalOpen } from '../components/Modal'
import { TitleBar } from '../components/TitleBar'
import { useApp } from '../context'
import { DetailsTable } from '../dialogs/DetailsDialog'
import { ImageView, type ZoomControl } from './ImageView'
import { VideoPlayer, type VideoControl } from './VideoPlayer'

const HIDE_MS = 2500

export function ViewerApp({ native }: { native: boolean }) {
  const { t, settings, notify } = useApp()
  const [context, setContext] = useState<ViewerContext>({ ids: [], index: 0, slideshow: false, serial: 0 })
  const [library, setLibrary] = useState<LibraryState>({ media: [], online: true, loading: false })
  const [data, setData] = useState<LibraryData>(emptyData())
  const [screen, setScreen] = useState<Screen>({ name: 'loading' })
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [info, setInfo] = useState(false)
  const [fullScreen, setFullScreen] = useState(false)
  const [idle, setIdle] = useState(false)
  const [zoom, setZoom] = useState(100)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const zoomControl = useRef<ZoomControl | null>(null)
  const videoControl = useRef<VideoControl | null>(null)
  const idleTimer = useRef<number | undefined>(undefined)

  const apply = useCallback((next: ViewerContext) => {
    setContext(next)
    setIndex(next.index)
    setPlaying(next.slideshow)
    if (next.slideshow) api.setFullScreen(true)
  }, [])

  useEffect(() => {
    void api.getViewerContext().then(apply)
    void api.getLibrary().then(setLibrary)
    void api.getData().then(setData)
    void api.getScreen().then(setScreen)
    const offs = [api.onViewerContext(apply), api.onLibrary(setLibrary), api.onData(setData), api.onScreen(setScreen), api.onFullScreen(setFullScreen)]
    return () => offs.forEach((off) => off())
  }, [apply])

  // The library was closed (sign-out): nothing to show any more.
  useEffect(() => {
    if (screen.name === 'welcome') api.windowClose()
  }, [screen.name])

  const byId = useMemo(() => new Map(library.media.map((m) => [m.id, m])), [library.media])
  const items = useMemo(() => context.ids.map((id) => byId.get(id)).filter((m) => m !== undefined), [context.ids, byId])
  const position = Math.min(index, Math.max(0, items.length - 1))
  const item = items[position]
  const meta = item ? metaOf(data, item.id) : null
  const mode = screen.name === 'library' ? screen.mode : 'local'

  const go = useCallback((step: number) => setIndex((i) => (items.length ? (i + step + items.length) % items.length : 0)), [items.length])

  // Slideshow: photos change after the set time, videos when they end.
  useEffect(() => {
    if (!playing || !item || item.kind === 'video') return
    const timer = window.setTimeout(() => go(1), settings.slideshow_seconds * 1000)
    return () => window.clearTimeout(timer)
  }, [playing, item, go, settings.slideshow_seconds])

  const toggleSlideshow = (): void => {
    const next = !playing
    setPlaying(next)
    if (next) api.setFullScreen(true)
  }

  const wake = (): void => {
    setIdle(false)
    window.clearTimeout(idleTimer.current)
    idleTimer.current = window.setTimeout(() => setIdle(true), HIDE_MS)
  }
  useEffect(() => () => window.clearTimeout(idleTimer.current), [])

  const star = (): void => {
    if (item && meta) void api.mutate({ type: 'meta', ids: [item.id], patch: { star: !meta.star } })
  }
  const rotate = (by: 90 | -90): void => {
    if (item?.kind === 'image') void api.mutate({ type: 'rotate', ids: [item.id], by })
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (anyModalOpen() || document.querySelector('.context-menu')) return
      if ((event.target as HTMLElement)?.matches?.('input[type=range], select')) {
        if (event.key !== 'Escape') return
      }
      const video = item?.kind === 'video' ? videoControl.current : null
      const key = event.key
      if (key === 'ArrowRight' && event.shiftKey && video) video.seek(5)
      else if (key === 'ArrowLeft' && event.shiftKey && video) video.seek(-5)
      else if (key === 'ArrowRight' || key === 'PageDown') go(1)
      else if (key === 'ArrowLeft' || key === 'PageUp') go(-1)
      else if (key === 'Home') setIndex(0)
      else if (key === 'End') setIndex(items.length - 1)
      else if (key === ' ') video ? video.toggle() : toggleSlideshow()
      else if (key === '+' || key === '=') zoomControl.current?.zoomIn()
      else if (key === '-') zoomControl.current?.zoomOut()
      else if (key === '0') zoomControl.current?.fit()
      else if (key === '1') zoomControl.current?.actual()
      else if (key.toLowerCase() === 'r') rotate(event.shiftKey ? -90 : 90)
      else if (key.toLowerCase() === 's') star()
      else if (key.toLowerCase() === 'i') setInfo((v) => !v)
      else if (key.toLowerCase() === 'm' && video) video.mute()
      else if (key.toLowerCase() === 'f' || key === 'F11') api.setFullScreen(!fullScreen)
      else if (key === 'F5') toggleSlideshow()
      else if (key === 'Escape') {
        if (playing) setPlaying(false)
        if (fullScreen) api.setFullScreen(false)
        else if (!playing) api.windowClose()
      } else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const frameMenu = (x: number, y: number): void => {
    if (!item || !meta) return
    const set = (color: (typeof FRAME_COLORS)[number] | null) => () => void api.mutate({ type: 'meta', ids: [item.id], patch: { color } })
    setMenu({
      x,
      y,
      items: [
        { label: t('color.none'), swatch: null, checked: meta.color === null, onSelect: set(null) },
        ...FRAME_COLORS.map((c) => ({ label: t(`color.${c}`), swatch: FRAME_HEX[c], checked: meta.color === c, onSelect: set(c) }))
      ]
    })
  }

  const hidden = (fullScreen || playing) && idle
  const title = item ? item.name : 'OKgram'
  const counter = items.length ? `${position + 1} / ${items.length}` : ''

  return (
    <div className={`viewer ${hidden ? 'chrome-hidden' : ''}`} onMouseMove={wake}>
      {!native && !fullScreen && <TitleBar title={title} subtitle={counter} />}
      <div className="viewer-body">
        <div className="viewer-stage">
          {!item ? (
            <div className="viewer-message">
              <p>{t('viewer.nothing')}</p>
            </div>
          ) : item.kind === 'image' ? (
            <ImageView item={item} rotation={meta?.rotation ?? 0} control={zoomControl} onZoom={setZoom} />
          ) : (
            <VideoPlayer item={item} autoplay={settings.video_autoplay || playing} loop={settings.video_loop && !playing} control={videoControl} onEnded={() => playing && go(1)} />
          )}
          {items.length > 1 && (
            <>
              <button type="button" className="nav-button nav-prev" aria-label={t('viewer.previous')} title={`${t('viewer.previous')} (←)`} onClick={() => go(-1)}>
                <Icon name="back" size={28} />
              </button>
              <button type="button" className="nav-button nav-next" aria-label={t('viewer.next')} title={`${t('viewer.next')} (→)`} onClick={() => go(1)}>
                <Icon name="forward" size={28} />
              </button>
            </>
          )}
          {meta?.color && <div className="viewer-frame" style={{ borderColor: FRAME_HEX[meta.color] }} aria-hidden="true" />}
        </div>
        {info && item && (
          <aside className="viewer-info">
            <div className="row">
              <h2 className="subheading grow">{t('details.title')}</h2>
              <IconButton icon="close" size={16} label={t('common.close')} onClick={() => setInfo(false)} />
            </div>
            <DetailsTable item={item} data={data} mode={mode} />
          </aside>
        )}
      </div>
      <div className="viewer-toolbar">
        <span className="muted counter">{counter}</span>
        {fullScreen && <span className="ellipsis viewer-name">{title}</span>}
        <div className="grow" />
        {item?.kind === 'image' && (
          <>
            <IconButton icon="zoom_out" label={`${t('viewer.zoom_out')} (−)`} onClick={() => zoomControl.current?.zoomOut()} />
            <button type="button" className="zoom-label" title={`${t('viewer.fit')} (0) / 100 % (1)`} onClick={() => (zoom === 100 ? zoomControl.current?.fit() : zoomControl.current?.actual())}>
              {zoom} %
            </button>
            <IconButton icon="zoom_in" label={`${t('viewer.zoom_in')} (+)`} onClick={() => zoomControl.current?.zoomIn()} />
            <IconButton icon="fit" label={`${t('viewer.fit')} (0)`} onClick={() => zoomControl.current?.fit()} />
            <div className="separator" />
            <IconButton icon="rotate_left" label={`${t('menu.rotate_left')} (Shift+R)`} onClick={() => rotate(-90)} />
            <IconButton icon="rotate_right" label={`${t('menu.rotate_right')} (R)`} onClick={() => rotate(90)} />
            <div className="separator" />
          </>
        )}
        {item?.kind === 'video' && <IconButton icon="external" label={t('viewer.open_system')} onClick={() => void api.openInSystem(item.id)} />}
        <IconButton icon="star" label={`${t(meta?.star ? 'menu.unstar' : 'menu.star')} (S)`} filled={meta?.star} active={meta?.star} disabled={!item} onClick={star} />
        <IconButton icon="frame" label={t('menu.frame')} disabled={!item} onClick={(e) => frameMenu(e.clientX, e.clientY)} />
        <IconButton icon="info" label={`${t('menu.details')} (I)`} active={info} disabled={!item} onClick={() => setInfo(!info)} />
        <IconButton
          icon="download"
          label={t('menu.download')}
          disabled={!item}
          onClick={() => item && void api.download([item.id]).then(() => undefined, () => notify(t('download.failed'), true))}
        />
        <div className="separator" />
        <IconButton icon={playing ? 'pause' : 'slideshow'} label={`${t(playing ? 'viewer.stop_slideshow' : 'menu.slideshow')} (F5)`} active={playing} disabled={items.length < 1} onClick={toggleSlideshow} />
        <IconButton icon={fullScreen ? 'exit_fullscreen' : 'fullscreen'} label={`${t('viewer.fullscreen')} (F)`} onClick={() => api.setFullScreen(!fullScreen)} />
      </div>
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </div>
  )
}
