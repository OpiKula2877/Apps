// Supported file formats: extension → kind and MIME type.
import type { MediaKind } from './ipc'

export const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml'
}

export const VIDEO_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  webm: 'video/webm'
}

/** Formats the built-in player (Chromium) usually cannot play; the viewer offers the system player instead. */
export const LIMITED_VIDEO = new Set(['avi'])

export const ALL_EXTENSIONS = [...Object.keys(IMAGE_TYPES), ...Object.keys(VIDEO_TYPES)]

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function kindOf(name: string): MediaKind | null {
  const ext = extensionOf(name)
  if (ext in IMAGE_TYPES) return 'image'
  if (ext in VIDEO_TYPES) return 'video'
  return null
}

export function mimeOf(name: string): string {
  const ext = extensionOf(name)
  return IMAGE_TYPES[ext] ?? VIDEO_TYPES[ext] ?? 'application/octet-stream'
}

/** Name without the extension. */
export function baseName(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

/** Characters no file system or Drive name should carry. */
const BAD_NAME = /[\\/:*?"<>|\u0000-\u001f]/

export function validFileName(name: string): boolean {
  const trimmed = name.trim()
  return trimmed.length > 0 && trimmed.length <= 200 && !BAD_NAME.test(trimmed) && trimmed !== '.' && trimmed !== '..'
}
