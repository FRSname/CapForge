/**
 * The four things the track UI does to the store: add a language, close one,
 * re-flow the active track, and describe every track for the tab strip.
 *
 * It lives beside `useTrackStore` rather than in `App.tsx` for the usual
 * reason — App is at the file-size ceiling — but also because of one real
 * constraint: **the writes go through `lib/trackCommands.ts`**, the same pure
 * transition the MCP agent's `create_track` / `reflow_track` commands take. The
 * UI is not a second implementation of "add a track"; it is a second caller.
 * Anything the agent is refused (a source with no word ids, an unknown
 * language) the user is refused too, with the same sentence.
 *
 * Toasts can't be raised from here: `App` renders `ToastProvider` itself and so
 * sits above the context. Messages are returned as a `notice` for App to hand
 * to `<ToastRelay>`, the existing precedent for exactly this.
 */

import { useCallback, useMemo, useState } from 'react'
import type { ToastType } from './useToast'
import type { CaptionTrack } from '../lib/tracks'
import type { TrackClassification } from '../lib/trackStaleness'
import { applyTrackCommand } from '../lib/trackCommands'
import { languageLabel, languageScript } from '../lib/languages'
import { loadAllFonts, type FontInfo } from '../lib/fonts'
import type { TrackTabInfo } from '../components/tracks/TrackTabs'

export interface TrackNotice {
  message: string
  type: ToastType
}

/**
 * The §G-2 font hint, as a pure function.
 *
 * A new track copies the active track's style verbatim — there is deliberately
 * no language→font mapping (every face in `Fonts/` is a Latin display font, so
 * any mapping would be a lie). What we *can* say without guessing: if the
 * language is not written in the Latin alphabet and the copied font is one of
 * those bundled faces, its glyphs are missing and the captions will render as
 * boxes or fallbacks. An empty `fontName` counts — that is CapForge's own
 * default face, not a system font.
 *
 * Returns null whenever the answer isn't clearly yes (unknown font, a system or
 * user font, a Latin-script language): a hint that fires on a working setup is
 * worse than no hint.
 */
export function bundledFontHint(
  lang: string,
  fontName: string,
  fonts: readonly FontInfo[]
): string | null {
  if (languageScript(lang) === 'latin') return null
  const face = fontName.trim()
  const isBundled = face === '' || fonts.some((f) => f.name === face && f.source === 'bundled')
  if (!isBundled) return null
  return `${languageLabel(lang)} is not written in the Latin alphabet, and this track copied one of CapForge's bundled display fonts. Pick a system font in Typography if characters come out blank.`
}

interface UseTrackActionsArgs {
  tracks: CaptionTrack[]
  activeTrackId: string
  activeTrack: CaptionTrack
  sourceTrack: CaptionTrack
  /** Positional against `tracks`; null for the source. */
  classifications: Array<TrackClassification | null>
  commitTracks: (tracks: CaptionTrack[], activeTrackId: string) => void
  bumpRevision: (id: string) => void
}

export interface TrackActions {
  /** Tab-strip view of the store, counts folded in. */
  tabs: TrackTabInfo[]
  /** The active track's classification, or null on the source. */
  activeClassification: TrackClassification | null
  /** A message App should hand to `<ToastRelay>`. */
  notice: TrackNotice | null
  clearNotice: () => void
  addTrack: (lang: string) => void
  closeTrack: (id: string) => void
  reflowActiveTrack: () => void
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function useTrackActions({
  tracks,
  activeTrackId,
  activeTrack,
  sourceTrack,
  classifications,
  commitTracks,
  bumpRevision,
}: UseTrackActionsArgs): TrackActions {
  const [notice, setNotice] = useState<TrackNotice | null>(null)
  const clearNotice = useCallback(() => setNotice(null), [])

  const tabs = useMemo<TrackTabInfo[]>(
    () =>
      tracks.map((track, i) => {
        const c = classifications[i]
        return {
          id: track.id,
          label: track.label,
          lang: track.lang,
          isSource: track.isSource,
          staleCount: c?.staleCount ?? 0,
          untranslatedCount: c?.untranslatedCount ?? 0,
          reflowNeeded: c?.reflowNeeded ?? false,
        }
      }),
    [tracks, classifications]
  )

  const activeClassification = useMemo(() => {
    const i = tracks.findIndex((t) => t.id === activeTrackId)
    return i === -1 ? null : classifications[i]
  }, [tracks, classifications, activeTrackId])

  /** Advisory only — a font list that fails to load must not fail the create. */
  const hintAboutFont = useCallback((lang: string, fontName: string) => {
    void loadAllFonts()
      .then((fonts) => {
        const hint = bundledFontHint(lang, fontName, fonts)
        if (hint) setNotice({ message: hint, type: 'info' })
      })
      .catch(() => {
        /* no font list, no hint — the track itself was created fine */
      })
  }, [])

  const addTrack = useCallback(
    (lang: string) => {
      // The style comes from the ACTIVE track, not the source: "style the
      // English, then add Polish" has to inherit what the user can see.
      const fontName = activeTrack.settings.fontName
      try {
        const next = applyTrackCommand(tracks, activeTrackId, {
          op: 'create_track',
          payload: { lang, copy_style_from: activeTrackId },
        })
        commitTracks(next.tracks, next.activeTrackId)
        hintAboutFont(lang, fontName)
      } catch (err) {
        // A source whose words have no ids can't be linked to — say so and
        // create nothing, rather than a track that silently drifts.
        setNotice({ message: messageOf(err), type: 'error' })
      }
    },
    [tracks, activeTrackId, activeTrack.settings.fontName, commitTracks, hintAboutFont]
  )

  const closeTrack = useCallback(
    (id: string) => {
      const index = tracks.findIndex((t) => t.id === id)
      const track = tracks[index]
      // The source is the transcript itself; there is no such thing as closing it.
      if (!track || track.isSource) return
      const c = classifications[index]
      const confirmed = window.confirm(
        `Close “${track.label}”?\n\n` +
          `${track.groups.length} captions — ${c?.untranslatedCount ?? 0} still untranslated, ` +
          `${c?.staleCount ?? 0} stale.\n\n` +
          'Its text is removed from this project. This cannot be undone.'
      )
      if (!confirmed) return
      commitTracks(
        tracks.filter((t) => t.id !== id),
        sourceTrack.id
      )
    },
    [tracks, classifications, sourceTrack.id, commitTracks]
  )

  const reflowActiveTrack = useCallback(() => {
    try {
      const next = applyTrackCommand(tracks, activeTrackId, {
        op: 'reflow_track',
        payload: { track_id: activeTrackId },
      })
      commitTracks(next.tracks, next.activeTrackId)
      // The editor owns its own copy of this track while it is mounted, so the
      // new skeleton only becomes visible on a remount.
      if (next.remountTrackId) bumpRevision(next.remountTrackId)
    } catch (err) {
      setNotice({ message: messageOf(err), type: 'error' })
    }
  }, [tracks, activeTrackId, commitTracks, bumpRevision])

  return {
    tabs,
    activeClassification,
    notice,
    clearNotice,
    addTrack,
    closeTrack,
    reflowActiveTrack,
  }
}
