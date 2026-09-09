/**
 * The two `window` keydown listeners `ResultsScreen` owns: undo/redo, and
 * playback + view switching.
 *
 * Lifted out of `ResultsScreen.tsx` verbatim when that file crossed the
 * 800-line ceiling — same two effects, same order of registration, same
 * dependency arrays, so the behaviour is unchanged. The catalogue of what each
 * key does still lives in `lib/shortcuts.ts` (the help sheet); this is the
 * implementation.
 *
 * Both listeners are on `window`, so they are global while the editor is
 * mounted. The playback one bails out inside a text field (`INPUT`,
 * `TEXTAREA`, `contentEditable`) — the undo one deliberately does not, because
 * ⌘Z there is the browser's own and never reaches us.
 */

import { useEffect } from 'react'
import type { RefObject } from 'react'
import type { Segment } from '../types/app'
import type { AudioPlayerHandle } from '../components/player/AudioPlayer'

/** One frame at 30fps — the arrow-key nudge. */
const FRAME_STEP = 1 / 30

/** J/L jump, in seconds. */
const JOG_STEP = 2

/** Slack when asking "which group is before/after the playhead?". */
const SEEK_EPSILON = 0.01

export interface EditorShortcutsOptions {
  undo: () => void
  redo: () => void
  playerRef: RefObject<AudioPlayerHandle | null>
  /** Raw groups — `,` / `.` seek to their starts. */
  groups: Segment[]
  currentTime: number
  setView: (view: 'text' | 'groups') => void
}

export function useEditorShortcuts({
  undo,
  redo,
  playerRef,
  groups,
  currentTime,
  setView,
}: EditorShortcutsOptions): void {
  // ── Undo/redo ───────────────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      }
      if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undo, redo])

  // ── Playback + view ─────────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      const editable =
        tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable
      if (editable) return

      // ⌘1 / ⌘2 — switch editor view (registered in lib/shortcuts.ts).
      const mod = e.metaKey || e.ctrlKey
      if (mod && (e.key === '1' || e.key === '2')) {
        e.preventDefault()
        setView(e.key === '1' ? 'text' : 'groups')
        return
      }

      const p = playerRef.current
      if (!p) return

      switch (e.key) {
        case ' ':
        case 'Spacebar':
          e.preventDefault()
          p.playPause()
          break
        case 'j':
        case 'J':
          e.preventDefault()
          p.seekRelative(-JOG_STEP)
          break
        case 'k':
        case 'K':
          e.preventDefault()
          p.playPause()
          break
        case 'l':
        case 'L':
          e.preventDefault()
          p.seekRelative(JOG_STEP)
          break
        case 'ArrowLeft':
          e.preventDefault()
          p.seekRelative(-FRAME_STEP)
          break
        case 'ArrowRight':
          e.preventDefault()
          p.seekRelative(FRAME_STEP)
          break
        case ',': {
          e.preventDefault()
          let gi = -1
          for (let i = groups.length - 1; i >= 0; i--) {
            if (groups[i].start < currentTime - SEEK_EPSILON) {
              gi = i
              break
            }
          }
          if (gi >= 0) p.seekToTime(groups[gi].start)
          break
        }
        case '.': {
          e.preventDefault()
          const gi = groups.findIndex((g) => g.start > currentTime + SEEK_EPSILON)
          if (gi >= 0) p.seekToTime(groups[gi].start)
          break
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // Deliberately narrow, exactly as it was inline: the handler reads `setView`
    // and `playerRef`, both stable for the life of the mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, currentTime])
}
