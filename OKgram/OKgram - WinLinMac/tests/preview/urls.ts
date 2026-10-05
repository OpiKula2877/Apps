// Preview replacement of src/renderer/src/urls.ts: blob URLs of the sample files.
export const blobs = new Map<string, { url: string; thumb: string }>()

export const mediaUrl = (id: string): string => blobs.get(id)?.url ?? ''
export const thumbUrl = (id: string): string => blobs.get(id)?.thumb ?? ''
