/**
 * The two ways out of a session, moved out of `App.tsx` (which is at its size
 * ceiling):
 *
 * - **New** (`handleNew`) ends the session: it clears the file, the transcript,
 *   every track and the record claim (`activeVideoId`), then shows the
 *   transcribe screen (`NEW_SESSION_SCREEN`) for the next file.
 * - **Library** (`goToLibrary`) only goes home. It flushes the pending record
 *   autosave first so the library holds the current snapshot, and resets
 *   nothing — the Continue hero reopens the record through `openRecord`. The
 *   decisions are in `lib/screenNavigation.ts`.
 */

import { useCallback } from 'react'
import type { Screen, TranscriptionResult } from '../types/app'
import type { CaptionTrack } from '../lib/tracks'
import { SOURCE_TRACK_ID } from '../lib/tracks'
import { NEW_SESSION_SCREEN, goToLibrary as goToLibraryWith } from '../lib/screenNavigation'
import { emptySourceTrack } from './useTrackStore'

/** `autosave.json` could not be removed on New. */
export function autosaveClearFailedMessage(reason: string): string {
  return `Could not clear the local autosave copy: ${reason}`
}

export interface ScreenNavigationInput {
  screen: Screen
  setScreen: (screen: Screen) => void
  setFilePath: (path: string | null) => void
  setResult: (result: TranscriptionResult | null) => void
  replaceTracks: (tracks: CaptionTrack[], activeTrackId: string) => void
  resetSourceVideoInfo: () => void
  /** `useLibrarySession`'s: this session no longer belongs to a record. */
  clearActive: () => void
  /** `useAutosave`'s: write the pending snapshot now. */
  flushAutosave: () => Promise<void>
  /** App's toast relay. */
  notify: (message: string) => void
}

export interface ScreenNavigation {
  handleNew: () => void
  goToLibrary: () => void
}

export function useScreenNavigation(input: ScreenNavigationInput): ScreenNavigation {
  const {
    screen,
    setScreen,
    setFilePath,
    setResult,
    replaceTracks,
    resetSourceVideoInfo,
    clearActive,
    flushAutosave,
    notify,
  } = input

  const handleNew = useCallback(() => {
    setFilePath(null)
    setResult(null)
    // New ends this session's claim on its record and offers the next file.
    clearActive()
    setScreen(NEW_SESSION_SCREEN)
    replaceTracks([emptySourceTrack()], SOURCE_TRACK_ID)
    resetSourceVideoInfo()
    window.subforge
      .autosaveClear()
      .catch((err: unknown) =>
        notify(autosaveClearFailedMessage(err instanceof Error ? err.message : String(err)))
      )
  }, [setFilePath, setResult, clearActive, setScreen, replaceTracks, resetSourceVideoInfo, notify])

  const goToLibrary = useCallback(() => {
    void goToLibraryWith({
      screen,
      flush: flushAutosave,
      showLibrary: () => setScreen('library'),
      notify,
    })
  }, [screen, flushAutosave, setScreen, notify])

  return { handleNew, goToLibrary }
}
