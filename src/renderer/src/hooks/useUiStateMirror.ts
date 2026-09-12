/**
 * The UI-state mirror.
 *
 * Mirror UI state to the backend so the agent can read what to change AND so
 * /api/render-frame renders with the live style. `render` is the snake_case
 * body (the casing bridge lives only in buildRenderBody). Debounced — settings
 * churn during edits.
 * Mirrors on EVERY screen (not just results) so the agent can see where the
 * app is and which presets exist before a video is loaded — `list_presets`
 * and `load_video` both have to work from the drop screen.
 *
 * Written in two halves, because they change at wildly different rates: the
 * legacy keys churn on every keystroke, while the per-track inventory (a
 * render body + a classification per track) only moves when a track does.
 * Each half writes into this hook's ref and the pusher sends the merge, so
 * neither can blank the other.
 *
 * **The halves store INPUTS, not built bodies.** Serializing is the expensive
 * part (`buildUiStateCore` runs `buildRenderBody` over every display group, and
 * `buildTrackEntries` does it once per track), so a drag that fires forty
 * renders used to pay for forty bodies and throw away thirty-nine. The effects
 * only snapshot what they read and arm the shared timer; the debounced push
 * builds, merges and PUTs once, from the latest inputs.
 */

import { useCallback, useEffect, useRef } from 'react'
import type { Screen, Segment, TranscriptionResult } from '../types/app'
import { api } from '../lib/api'
import { builtinPresetNames } from '../lib/agentCommands'
import type { CaptionTrack } from '../lib/tracks'
import type { TrackClassification } from '../lib/trackStaleness'
import {
  buildTrackEntries,
  buildUiStateBody,
  buildUiStateCore,
  mergeUiStateBody,
} from '../lib/uiStateMirror'
import type { AgentCommandEcho, UiStateCoreInput } from '../lib/uiStateMirror'

/**
 * Trailing debounce before a PUT. Kept short on purpose: the MCP side confirms
 * a write by polling the mirror and gives up after 5 s, so the mirror has to
 * land well inside that.
 */
const MIRROR_DEBOUNCE_MS = 300

/** What the core half reads, snapshotted at effect time. */
type CoreInputs = Omit<UiStateCoreInput, 'builtinPresets'>

/** What the per-track half reads, snapshotted at effect time. */
interface TrackInputs {
  tracks: readonly CaptionTrack[]
  sourceTrack: CaptionTrack
  classifications: ReadonlyArray<TrackClassification | null>
}

export interface UiStateMirrorInput extends TrackInputs {
  screen: Screen
  /** Project metadata — the resync half's `result`, absent off the results screen. */
  result: TranscriptionResult | null
  activeTrack: CaptionTrack
  displayGroups: Segment[]
  userPresetNames: string[]
  agentEcho: AgentCommandEcho
}

export function useUiStateMirror({
  screen,
  result,
  activeTrack,
  displayGroups,
  userPresetNames,
  agentEcho,
  tracks,
  sourceTrack,
  classifications,
}: UiStateMirrorInput): void {
  const mirrorRef = useRef<{ core: CoreInputs | null; tracks: TrackInputs | null }>({
    core: null,
    tracks: null,
  })
  // One shared trailing debounce, so a change that moves both halves still costs
  // a single PUT.
  const mirrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleMirror = useCallback(() => {
    if (mirrorTimerRef.current) clearTimeout(mirrorTimerRef.current)
    mirrorTimerRef.current = setTimeout(() => {
      mirrorTimerRef.current = null
      const { core, tracks: trackInputs } = mirrorRef.current
      if (!core) return
      const body = mergeUiStateBody(
        buildUiStateCore({ ...core, builtinPresets: builtinPresetNames() }),
        trackInputs
          ? buildTrackEntries(
              trackInputs.tracks,
              trackInputs.sourceTrack,
              trackInputs.classifications
            )
          : []
      )
      api.putUiState(body).catch(() => {
        /* best-effort mirror */
      })
    }, MIRROR_DEBOUNCE_MS)
  }, [])

  useEffect(
    () => () => {
      if (mirrorTimerRef.current) clearTimeout(mirrorTimerRef.current)
    },
    []
  )

  useEffect(() => {
    mirrorRef.current = {
      ...mirrorRef.current,
      core: {
        screen,
        activeTrack,
        activeDisplayGroups: displayGroups,
        userPresetNames,
        agent: agentEcho,
      },
    }
    scheduleMirror()
  }, [screen, activeTrack, displayGroups, userPresetNames, agentEcho, scheduleMirror])

  useEffect(() => {
    mirrorRef.current = {
      ...mirrorRef.current,
      tracks: { tracks, sourceTrack, classifications },
    }
    scheduleMirror()
  }, [tracks, sourceTrack, classifications, scheduleMirror])

  // Resync-after-reconnect: give the API layer a snapshot of the live result +
  // UI state so that if the backend crashes/restarts, the control socket's reopen
  // handler can re-push what the backend lost (mirrors the two effects above).
  useEffect(() => {
    api.registerResync(() => {
      // No project open (drop/progress screen): re-push UI state only. The
      // `result` half is genuinely absent, not lost, so it must stay undefined.
      const liveResult = screen === 'results' ? result : null
      return {
        result: liveResult
          ? {
              segments: sourceTrack.segments,
              language: liveResult.language,
              duration: liveResult.duration,
              audio_path: liveResult.audioPath,
              alignment_degraded: Boolean(liveResult.alignmentDegraded),
            }
          : undefined,
        uiState: buildUiStateBody({
          screen,
          activeTrack,
          activeDisplayGroups: displayGroups,
          builtinPresets: builtinPresetNames(),
          userPresetNames,
          agent: agentEcho,
          tracks,
          sourceTrack,
          classifications,
        }),
      }
    })
    return () => api.registerResync(null)
  }, [
    screen,
    result,
    activeTrack,
    displayGroups,
    userPresetNames,
    agentEcho,
    tracks,
    sourceTrack,
    classifications,
  ])
}
