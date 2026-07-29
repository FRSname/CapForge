import { useCallback, useEffect, useState } from 'react'

/** `app-state.json` key holding the user's favorited font family names. */
export const FAVORITE_FONTS_KEY = 'favoriteFonts'

export interface FavoriteFonts {
  favorites: ReadonlySet<string>
  toggle: (fontName: string) => void
  isReady: boolean
}

/**
 * Font families the user has starred, pinned to the top of every font picker.
 *
 * Persisted through the existing `state:get`/`state:set` IPC (already exposed
 * by both preloads) rather than a dedicated channel — see the dual-preload
 * gotcha in CLAUDE.md. Each mount hydrates from disk, so the global picker and
 * the per-word popup agree on first paint and stay in sync after a toggle.
 */
export function useFavoriteFonts(): FavoriteFonts {
  const [favorites, setFavorites] = useState<ReadonlySet<string>>(() => new Set())
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    window.subforge
      .getState<string[]>(FAVORITE_FONTS_KEY, [])
      .then((stored) => {
        if (cancelled) return
        setFavorites(new Set(Array.isArray(stored) ? stored : []))
      })
      .catch(() => {
        // A missing or unreadable key just means "no favorites yet" — the
        // picker still works, it simply has nothing pinned.
      })
      .finally(() => {
        if (!cancelled) setIsReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const toggle = useCallback((fontName: string) => {
    setFavorites((prev) => {
      const next = new Set(prev)
      if (!next.delete(fontName)) next.add(fontName)
      // Persist optimistically; the in-memory set is the source of truth for
      // this session, so a failed write costs the preference, not the picker.
      void Promise.resolve(window.subforge.setState(FAVORITE_FONTS_KEY, [...next])).catch(() => {})
      return next
    })
  }, [])

  return { favorites, toggle, isReady }
}
