// The open library for the components of the library window.
import { createContext, useContext } from 'react'
import type { MediaItem, SourceState } from '../../../shared/ipc'
import type { Album, LibraryData } from '../../../shared/model'

export interface AlbumPickOptions {
  title: string
  confirmText: string
  /** Albums that cannot be chosen (moving an album into itself). */
  exclude?: Set<string>
  /** Offer "top level" (moving an album). */
  allowTop?: boolean
}

export interface LibraryServices {
  sources: SourceState[]
  /** Media of the ticked sources. */
  media: MediaItem[]
  byId: Map<string, MediaItem>
  data: LibraryData
  sourceOf(item: MediaItem): SourceState | undefined
  showDetails(item: MediaItem): void
  /** Chosen album id, null = top level, undefined = cancelled. */
  pickAlbum(options: AlbumPickOptions): Promise<string | null | undefined>
  /** Create (parent given) or edit an album; resolves to its id, or null when cancelled. */
  editAlbum(target: { album: Album } | { parent: string | null; items?: string[] }): Promise<string | null>
  /** Show this album in the Albums tab. */
  showAlbum(id: string): void
  /** Upload files (no paths: pick them); asks which source when several are ticked. */
  upload(paths?: string[], albumId?: string | null): Promise<void>
  /** Open the add-source dialog. */
  addSource(): void
}

export const LibraryContext = createContext<LibraryServices | null>(null)

export function useLibrary(): LibraryServices {
  const services = useContext(LibraryContext)
  if (!services) throw new Error('LibraryContext missing')
  return services
}
