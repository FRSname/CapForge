/**
 * A record asset (the poster, a thumbnail frame) as an object URL an `<img>`
 * can show.
 *
 * The renderer CSP is `img-src 'self' data: blob:`, so a JPEG the backend
 * serves from `127.0.0.1` cannot be an `<img src>` directly — it is fetched
 * with the local token (`getLibraryAsset`) and wrapped in a `blob:` URL,
 * revoked when the component unmounts or the asset changes. A `null`
 * `assetPath` is the caller's word that there is nothing to load, and costs no
 * request.
 *
 * Failures go to `onError` — the library card logs (one poster is not worth
 * interrupting the library for), the thumbnail strip toasts.
 */

import { useEffect, useRef, useState } from 'react'
import { getLibraryAsset } from '../lib/libraryApi'

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function useLibraryAssetUrl(
  videoId: string,
  assetPath: string | null,
  onError: (reason: string) => void
): string | null {
  const [loaded, setLoaded] = useState<{ key: string; url: string } | null>(null)
  // Through a ref: a new callback identity must not refetch the image.
  const onErrorRef = useRef(onError)
  useEffect(() => {
    onErrorRef.current = onError
  }, [onError])
  const key = `${videoId}/${assetPath ?? ''}`

  useEffect(() => {
    if (!assetPath) return undefined
    let cancelled = false
    let objectUrl: string | null = null
    getLibraryAsset(videoId, assetPath)
      .then((blob) => {
        if (cancelled || !blob) return
        objectUrl = URL.createObjectURL(blob)
        setLoaded({ key: `${videoId}/${assetPath}`, url: objectUrl })
      })
      .catch((err: unknown) => {
        if (!cancelled) onErrorRef.current(reasonOf(err))
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [videoId, assetPath])

  // Derived, not reset in the effect: a URL only counts for the asset it was
  // fetched for, and only while the caller still says the asset exists.
  return assetPath && loaded?.key === key ? loaded.url : null
}
