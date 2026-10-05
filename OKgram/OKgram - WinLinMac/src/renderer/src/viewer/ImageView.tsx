// Photo with zoom: mouse wheel around the cursor, drag to move, double-click for 100 % / fit.
import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react'
import type { MediaItem } from '../../../shared/ipc'
import { mediaUrl, thumbUrl } from '../urls'
import { useApp } from '../context'

export interface ZoomControl {
  zoomIn(): void
  zoomOut(): void
  fit(): void
  actual(): void
}

interface Props {
  item: MediaItem
  rotation: number
  control: MutableRefObject<ZoomControl | null>
  onZoom: (percent: number) => void
}

const MIN = 0.05
const MAX = 16
const STEP = 1.25

export function ImageView({ item, rotation, control, onZoom }: Props) {
  const { t } = useApp()
  const box = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState({ width: 800, height: 600 })
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null)
  const [scale, setScale] = useState<number | null>(null)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [failed, setFailed] = useState(false)
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)

  useLayoutEffect(() => {
    const element = box.current
    if (!element) return
    const observer = new ResizeObserver(() => setStage({ width: element.clientWidth, height: element.clientHeight }))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    setNatural(null)
    setScale(null)
    setOffset({ x: 0, y: 0 })
    setFailed(false)
  }, [item.id, item.version])

  useEffect(() => {
    setScale(null)
    setOffset({ x: 0, y: 0 })
  }, [rotation])

  const size = natural ?? { width: item.width || stage.width, height: item.height || stage.height }
  const turned = rotation % 180 !== 0
  const shown = turned ? { width: size.height, height: size.width } : size
  const fitScale = Math.min(1, (stage.width - 24) / shown.width, (stage.height - 24) / shown.height)
  const current = scale ?? fitScale

  useEffect(() => onZoom(Math.round(current * 100)), [current, onZoom])

  /** Zoom keeping the point (px, py) relative to the stage centre in place. */
  const zoomTo = (next: number, px = 0, py = 0): void => {
    const clamped = Math.min(MAX, Math.max(MIN, next))
    if (Math.abs(clamped - fitScale) < 0.001 || clamped <= fitScale) {
      setScale(clamped <= fitScale ? null : clamped)
      setOffset({ x: 0, y: 0 })
      return
    }
    const ratio = clamped / current
    setOffset((o) => ({ x: px - (px - o.x) * ratio, y: py - (py - o.y) * ratio }))
    setScale(clamped)
  }

  control.current = {
    zoomIn: () => zoomTo(current * STEP),
    zoomOut: () => zoomTo(current / STEP),
    fit: () => zoomTo(fitScale),
    actual: () => zoomTo(1)
  }

  const point = (clientX: number, clientY: number): [number, number] => {
    const rect = box.current!.getBoundingClientRect()
    return [clientX - rect.left - rect.width / 2, clientY - rect.top - rect.height / 2]
  }

  return (
    <div
      ref={box}
      className={`image-stage ${scale ? 'zoomed' : ''}`}
      onWheel={(e) => {
        const [px, py] = point(e.clientX, e.clientY)
        zoomTo(current * (e.deltaY < 0 ? STEP : 1 / STEP), px, py)
      }}
      onDoubleClick={(e) => {
        const [px, py] = point(e.clientX, e.clientY)
        zoomTo(scale ? fitScale : Math.max(1, fitScale * 2), px, py)
      }}
      onMouseDown={(e) => {
        if (!scale || e.button !== 0) return
        drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }
      }}
      onMouseMove={(e) => {
        const d = drag.current
        if (d) setOffset({ x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y })
      }}
      onMouseUp={() => (drag.current = null)}
      onMouseLeave={() => (drag.current = null)}
    >
      {failed ? (
        <div className="viewer-message">
          <p>{t('viewer.image_failed')}</p>
        </div>
      ) : (
        <>
          {!natural && <img className="image-preview" src={thumbUrl(item.id, item.version)} alt="" style={{ transform: `rotate(${rotation}deg)` }} />}
          <img
            key={item.id + item.version}
            className="image-full"
            src={mediaUrl(item.id)}
            alt={item.name}
            draggable={false}
            onLoad={(e) => {
              const img = e.currentTarget
              setNatural({ width: img.naturalWidth || item.width || 1024, height: img.naturalHeight || item.height || 768 })
            }}
            onError={() => setFailed(true)}
            style={{
              width: size.width,
              height: size.height,
              marginLeft: -size.width / 2,
              marginTop: -size.height / 2,
              opacity: natural ? 1 : 0,
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${current}) rotate(${rotation}deg)`
            }}
          />
        </>
      )}
    </div>
  )
}
