// Sample photos and a video drawn in the browser, for the UI preview (npm run preview:ui).
import type { MediaItem } from '../../src/shared/ipc'

export interface SampleFile {
  item: MediaItem
  url: string
  thumb: string
}

const DAY = 24 * 3600 * 1000

function rng(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

function drawScene(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number): void {
  const r = rng(seed)
  const hue = Math.floor(r() * 360)
  const sky = ctx.createLinearGradient(0, 0, 0, h)
  sky.addColorStop(0, `hsl(${hue}, 60%, ${30 + r() * 30}%)`)
  sky.addColorStop(1, `hsl(${(hue + 40) % 360}, 70%, ${60 + r() * 20}%)`)
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = `hsl(${(hue + 180) % 360}, 90%, 70%)`
  ctx.beginPath()
  ctx.arc(w * (0.2 + r() * 0.6), h * (0.2 + r() * 0.2), Math.min(w, h) * (0.06 + r() * 0.06), 0, Math.PI * 2)
  ctx.fill()
  for (let layer = 0; layer < 3; layer++) {
    ctx.fillStyle = `hsl(${(hue + 100 + layer * 20) % 360}, 35%, ${12 + layer * 10}%)`
    ctx.beginPath()
    ctx.moveTo(0, h)
    const base = h * (0.55 + layer * 0.12)
    for (let x = 0; x <= w; x += w / 12) ctx.lineTo(x, base - r() * h * 0.18)
    ctx.lineTo(w, h)
    ctx.fill()
  }
}

async function blobUrl(canvas: HTMLCanvasElement, type: string): Promise<{ url: string; size: number }> {
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), type, 0.88))
  return { url: URL.createObjectURL(blob), size: blob.size }
}

/** Sample sources: a folder on this computer and two Google accounts. */
export const sourceOf = (raw: string): string => (raw.startsWith('Léto') || raw.endsWith('.webm') ? 'drive1' : raw.startsWith('Výlet 2025') ? 'drive2' : 'pc')

function base(raw: string, patch: Partial<MediaItem>): MediaItem {
  const ext = raw.split('.').pop()!.toLowerCase()
  const source = sourceOf(raw)
  return {
    id: `${source}:${raw}`,
    source,
    name: raw.split('/').pop()!,
    ext,
    kind: 'image',
    mime: ext === 'png' ? 'image/png' : 'image/jpeg',
    size: 0,
    created: Date.now() - 40 * DAY,
    modified: Date.now() - 40 * DAY,
    taken: null,
    width: null,
    height: null,
    duration: null,
    version: '1',
    shared: false,
    ...patch
  }
}

const NAMES = [
  'Krkonoše východ.jpg', 'Sněžka.jpg', 'Chata večer.jpg', 'Les u potoka.jpg', 'Pole.png', 'Západ slunce.jpg',
  'Babička 80.jpg', 'Praha most.jpg', 'Jezero.jpg', 'Údolí.jpg', 'Mlha ráno.jpg', 'Kopce.png',
  'Léto 2026/Moře 1.jpg', 'Léto 2026/Moře 2.jpg', 'Léto 2026/Pláž.jpg', 'Výlet 2025/Hrad.jpg', 'Výlet 2025/Skály.jpg', 'Plán zahrady.png'
]

export async function makeSamples(): Promise<SampleFile[]> {
  const files: SampleFile[] = []
  for (const [index, id] of NAMES.entries()) {
    const portrait = index % 4 === 3
    const canvas = document.createElement('canvas')
    canvas.width = portrait ? 900 : 1400
    canvas.height = portrait ? 1200 : 900
    drawScene(canvas.getContext('2d')!, canvas.width, canvas.height, index * 7919 + 13)
    const { url, size } = await blobUrl(canvas, id.endsWith('.png') ? 'image/png' : 'image/jpeg')
    files.push({
      item: base(id, { width: canvas.width, height: canvas.height, size, taken: Date.now() - (index * 9 + 2) * DAY, created: Date.now() - (index < 4 ? index : 40 + index) * DAY }),
      url,
      thumb: url
    })
  }
  files.push(await makeVideo())
  return files
}

async function makeVideo(): Promise<SampleFile> {
  const canvas = document.createElement('canvas')
  canvas.width = 640
  canvas.height = 360
  const ctx = canvas.getContext('2d')!
  const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: 'video/webm' })
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => chunks.push(e.data)
  recorder.start(100)
  for (let frame = 0; frame < 45; frame++) {
    drawScene(ctx, 640, 360, 4242)
    ctx.fillStyle = '#c8102e'
    ctx.beginPath()
    ctx.arc(60 + frame * 12, 250, 34, 0, Math.PI * 2)
    ctx.fill()
    await new Promise((r) => setTimeout(r, 33))
  }
  recorder.stop()
  await new Promise((r) => (recorder.onstop = r))
  const blob = new Blob(chunks, { type: 'video/webm' })
  drawScene(ctx, 640, 360, 4242)
  return {
    item: base('Výlet na kole.webm', { kind: 'video', mime: 'video/webm', ext: 'webm', size: blob.size, width: 640, height: 360, duration: 1500, created: Date.now() - DAY }),
    url: URL.createObjectURL(blob),
    thumb: (await blobUrl(canvas, 'image/jpeg')).url
  }
}
