// Video player with its own controls: play/pause, seek bar, time, volume, speed.
// Formats the built-in player cannot decode offer the system player instead.
import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { MediaItem } from '../../../shared/ipc'
import { LIMITED_VIDEO } from '../../../shared/formats'
import { mediaUrl } from '../urls'
import { api } from '../api'
import { Icon, IconButton } from '../components/Icon'
import { useApp } from '../context'
import { formatDuration } from '../i18n'

export interface VideoControl {
  toggle(): void
  seek(seconds: number): void
  mute(): void
}

interface Props {
  item: MediaItem
  autoplay: boolean
  loop: boolean
  control: MutableRefObject<VideoControl | null>
  onEnded: () => void
}

const SPEEDS = [0.5, 1, 1.25, 1.5, 2]

/** Length in seconds; streamed WebM files often report Infinity, then the seekable end is used. */
function lengthOf(video: HTMLVideoElement): number {
  if (Number.isFinite(video.duration)) return video.duration
  const seekable = video.seekable
  return seekable.length ? seekable.end(seekable.length - 1) : 0
}

export function VideoPlayer({ item, autoplay, loop, control, onEnded }: Props) {
  const { t, settings, updateSettings } = useApp()
  const video = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(settings.volume)
  const [muted, setMuted] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [failed, setFailed] = useState(false)
  const saveTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    setFailed(false)
    setTime(0)
    setDuration(0)
  }, [item.id])

  useEffect(() => {
    if (video.current) video.current.volume = volume
  }, [volume])

  const toggle = (): void => {
    const v = video.current
    if (!v) return
    if (v.paused) void v.play().catch(() => undefined)
    else v.pause()
  }

  control.current = {
    toggle,
    seek: (seconds) => {
      const v = video.current
      if (v) v.currentTime = Math.min(Math.max(0, v.currentTime + seconds), v.duration || 0)
    },
    mute: () => setMuted((m) => !m)
  }

  const changeVolume = (value: number): void => {
    setVolume(value)
    setMuted(false)
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => void updateSettings({ volume: value }), 400)
  }

  if (failed) {
    return (
      <div className="viewer-message">
        <p>{t(LIMITED_VIDEO.has(item.ext) ? 'viewer.video_limited' : 'viewer.video_failed', { ext: item.ext.toUpperCase() })}</p>
        <button type="button" className="primary" onClick={() => void api.openInSystem(item.id)}>
          <Icon name="external" size={16} /> {t('viewer.open_system')}
        </button>
      </div>
    )
  }

  return (
    <div className="video-stage">
      <video
        key={item.id}
        ref={video}
        className="video"
        src={mediaUrl(item.id)}
        autoPlay={autoplay}
        loop={loop}
        muted={muted}
        playsInline
        onClick={toggle}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onLoadedMetadata={(e) => {
          setDuration(lengthOf(e.currentTarget))
          e.currentTarget.volume = volume
          e.currentTarget.playbackRate = speed
        }}
        onDurationChange={(e) => setDuration(lengthOf(e.currentTarget))}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onEnded={onEnded}
        onError={() => setFailed(true)}
      />
      <div className="video-controls" onDoubleClick={(e) => e.stopPropagation()}>
        <IconButton icon={playing ? 'pause' : 'play'} label={t(playing ? 'viewer.pause' : 'viewer.play')} filled onClick={toggle} />
        <span className="video-time">
          {formatDuration(time * 1000)} / {formatDuration(duration * 1000)}
        </span>
        <input
          className="seek"
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(time, duration || 0)}
          aria-label={t('viewer.seek')}
          onChange={(e) => {
            const v = video.current
            if (v) v.currentTime = Number(e.target.value)
            setTime(Number(e.target.value))
          }}
        />
        <IconButton icon={muted || volume === 0 ? 'mute' : 'volume'} label={t('viewer.mute')} onClick={() => setMuted(!muted)} />
        <input className="volume" type="range" min={0} max={1} step={0.02} value={muted ? 0 : volume} aria-label={t('viewer.volume')} onChange={(e) => changeVolume(Number(e.target.value))} />
        <select
          className="mini-select"
          value={speed}
          aria-label={t('viewer.speed')}
          onChange={(e) => {
            const next = Number(e.target.value)
            setSpeed(next)
            if (video.current) video.current.playbackRate = next
          }}
        >
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
