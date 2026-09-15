/**
 * A record's card picture as an object URL the library card can put in an
 * `<img>`: the cover chosen in Publish → Thumbnail when there is one, else the
 * poster grabbed at import (`cardImageAsset`).
 *
 * A thin reading of `useLibraryAssetUrl` (fetch with the local token → `blob:`
 * URL, because the CSP forbids `127.0.0.1` images). `video.cover` and
 * `video.poster` are the backend's word that a file exists, so a record with
 * neither costs no request.
 *
 * A failed fetch keeps the placeholder and is logged, not toasted: one card's
 * picture is not worth interrupting the library for.
 */

import { useCallback } from 'react'
import type { LibraryVideo } from '../lib/libraryTypes'
import { cardImageAsset } from '../lib/libraryView'
import { useLibraryAssetUrl } from './useLibraryAssetUrl'

export function posterFailedMessage(id: string, reason: string): string {
  return `Poster for ${id} could not be loaded: ${reason}`
}

export function usePosterUrl(video: Pick<LibraryVideo, 'id' | 'poster' | 'cover'>): string | null {
  const logFailure = useCallback(
    (reason: string) => console.warn(posterFailedMessage(video.id, reason)),
    [video.id]
  )
  return useLibraryAssetUrl(video.id, cardImageAsset(video), logFailure)
}
