// Thumbnails the window makes itself and hands to the main process for the cache:
// video frames (and video size and length) and JPEGs stored turned with an EXIF orientation.
import type { MediaItem, VideoInfo } from '../../../shared/ipc'
import { mediaUrl } from '../urls'
import { api } from '../api'

const EDGE = 480
const TIMEOUT_MS = 20_000

type Job = { item: MediaItem; resolve: (ok: boolean) => void }
const queue: Job[] = []
const known = new Map<string, Promise<boolean>>()
let busy = false

function wait(target: EventTarget, event: string, ms = TIMEOUT_MS): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(new Error('timeout')), ms)
    const onEvent = (): void => done()
    const onError = (): void => done(new Error('decode'))
    function done(error?: Error): void {
      clearTimeout(timer)
      target.removeEventListener(event, onEvent)
      target.removeEventListener('error', onError)
      if (error) reject(error)
      else resolve()
    }
    target.addEventListener(event, onEvent, { once: true })
    target.addEventListener('error', onError, { once: true })
  })
}

function drawJpeg(source: CanvasImageSource, width: number, height: number): Promise<Uint8Array> {
  const scale = Math.min(1, EDGE / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? blob.arrayBuffer().then((b) => resolve(new Uint8Array(b)), reject) : reject(new Error('encode'))),
      'image/jpeg',
      0.82
    )
  )
}

async function videoThumb(item: MediaItem): Promise<{ bytes: Uint8Array; info: VideoInfo }> {
  const video = document.createElement('video')
  video.crossOrigin = 'anonymous'
  video.muted = true
  video.preload = 'auto'
  video.src = mediaUrl(item.id)
  try {
    await wait(video, 'loadedmetadata')
    const duration = Number.isFinite(video.duration) ? video.duration : 0
    video.currentTime = Math.min(1, duration * 0.1)
    await wait(video, 'seeked')
    const info = { width: video.videoWidth, height: video.videoHeight, duration: duration * 1000 }
    return { bytes: await drawJpeg(video, video.videoWidth, video.videoHeight), info }
  } finally {
    video.removeAttribute('src')
    video.load()
  }
}

async function imageThumb(item: MediaItem): Promise<Uint8Array> {
  const response = await fetch(mediaUrl(item.id))
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const bitmap = await createImageBitmap(await response.blob(), { imageOrientation: 'from-image' })
  try {
    return await drawJpeg(bitmap, bitmap.width, bitmap.height)
  } finally {
    bitmap.close()
  }
}

async function run(): Promise<void> {
  if (busy) return
  busy = true
  while (queue.length) {
    const { item, resolve } = queue.shift()!
    try {
      if (item.kind === 'video') {
        const { bytes, info } = await videoThumb(item)
        await api.storeThumbnail(item.id, item.version, bytes, info)
      } else {
        await api.storeThumbnail(item.id, item.version, await imageThumb(item), null)
      }
      resolve(true)
    } catch {
      resolve(false)
    }
  }
  busy = false
}

/** Make a thumbnail in this window (once per file version). Resolves true when it was stored. */
export function generateThumb(item: MediaItem): Promise<boolean> {
  if (item.kind === 'image' && item.ext !== 'jpg' && item.ext !== 'jpeg') return Promise.resolve(false)
  const key = `${item.id}|${item.version}`
  const existing = known.get(key)
  if (existing) return existing
  const promise = new Promise<boolean>((resolve) => queue.push({ item, resolve }))
  known.set(key, promise)
  void run()
  return promise
}

/** The size and length of a video, read by loading only its header. */
export async function probeVideo(item: MediaItem): Promise<VideoInfo | null> {
  const video = document.createElement('video')
  video.crossOrigin = 'anonymous'
  video.preload = 'metadata'
  video.muted = true
  video.src = mediaUrl(item.id)
  try {
    await wait(video, 'loadedmetadata')
    return { width: video.videoWidth, height: video.videoHeight, duration: Number.isFinite(video.duration) ? video.duration * 1000 : 0 }
  } catch {
    return null
  } finally {
    video.removeAttribute('src')
    video.load()
  }
}
