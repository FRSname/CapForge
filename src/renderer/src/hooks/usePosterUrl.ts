/**
 * A record's poster as an object URL the library card can put in an `<img>`.
 *
 * A thin reading of `useLibraryAssetUrl` (fetch with the local token → `blob:`
 * URL, because the CSP forbids `127.0.0.1` images). `video.poster` is the
 * backend's word that a file exists, so a record without one costs no request.
 *
 * A failed fetch keeps the placeholder and is logged, not toasted: one card's
 * picture is not worth interrupting the library for.
 */

import { useCallback } from 'react'
import type { LibraryVideo } from '../lib/libraryTypes'
import { useLibraryAssetUrl } from './useLibraryAssetUrl'

const POSTER_ASSET = 'poster.jpg'

export function posterFailedMessage(id: string, reason: string): string {
  return `Poster for ${id} could not be loaded: ${reason}`
}

export function usePosterUrl(video: Pick<LibraryVideo, 'id' | 'poster'>): string | null {
  const logFailure = useCallback(
    (reason: string) => console.warn(posterFailedMessage(video.id, reason)),
    [video.id]
  )
  return useLibraryAssetUrl(video.id, video.poster ? POSTER_ASSET : null, logFailure)
}
