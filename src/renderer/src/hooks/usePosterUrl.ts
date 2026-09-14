/**
 * A record's poster as an object URL the card can put in an `<img>`.
 *
 * The renderer CSP is `img-src 'self' data: blob:`, so the JPEG the backend
 * serves from `127.0.0.1` cannot be an `<img src>` directly — it is fetched
 * (with the local token) and wrapped in a `blob:` URL, revoked when the card
 * unmounts or the record changes. `video.poster` is the backend's word that a
 * file exists, so a record without one costs no request at all.
 *
 * A failed fetch keeps the placeholder and is logged, not toasted: one card's
 * picture is not worth interrupting the library for.
 */

import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { LibraryVideo } from '../lib/libraryTypes'

export function posterFailedMessage(id: string, reason: string): string {
  return `Poster for ${id} could not be loaded: ${reason}`
}

export function usePosterUrl(video: Pick<LibraryVideo, 'id' | 'poster'>): string | null {
  const [loaded, setLoaded] = useState<{ id: string; url: string } | null>(null)

  useEffect(() => {
    if (!video.poster) return undefined
    let cancelled = false
    let objectUrl: string | null = null
    api
      .getLibraryPoster(video.id)
      .then((blob) => {
        if (cancelled || !blob) return
        objectUrl = URL.createObjectURL(blob)
        setLoaded({ id: video.id, url: objectUrl })
      })
      .catch((err: unknown) => {
        console.warn(
          posterFailedMessage(video.id, err instanceof Error ? err.message : String(err))
        )
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [video.id, video.poster])

  // Derived, not reset in the effect: a URL only counts for the record it was
  // fetched for, and only while the backend still says a poster exists.
  return video.poster && loaded?.id === video.id ? loaded.url : null
}
