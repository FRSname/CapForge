/**
 * Probe the source media once per transcript and apply what it says about
 * *geometry* to every caption track.
 *
 * Moved out of `App.tsx` verbatim when the library screen landed (App is at its
 * size ceiling, §9.3). The rule it encodes is unchanged: output resolution and
 * fps are facts about the source file, not per-track style choices, so they
 * land on all tracks — while a failed probe is silent, because "no video info"
 * is the normal answer for an audio-only file.
 */

import { useCallback, useEffect, useState } from 'react'
import { api, type VideoInfo } from '../lib/api'
import type { CaptionTrack } from '../lib/tracks'
import { snapFps } from '../components/studio/StudioPanel'

export interface SourceVideoInfo {
  /** The probe result for the loaded media; null before it answers. */
  sourceVideoInfo: VideoInfo | null
  /** A new video is being loaded — forget the previous file's geometry. */
  resetSourceVideoInfo: () => void
}

export function useSourceVideoInfo(
  audioPath: string | undefined,
  updateAllTracks: (update: (track: CaptionTrack) => CaptionTrack) => void
): SourceVideoInfo {
  const [sourceVideoInfo, setSourceVideoInfo] = useState<VideoInfo | null>(null)

  useEffect(() => {
    if (!audioPath) return
    let cancelled = false
    api
      .getVideoInfo(audioPath)
      .then((info) => {
        if (cancelled) return
        setSourceVideoInfo(info)
        // Output geometry is a fact about the source media, not a per-track
        // style choice, so it lands on every track.
        updateAllTracks((track) => {
          const next = { ...track.settings }
          let changed = false
          if (info.width && info.height) {
            next.resolution = [info.width, info.height]
            next.resolutionIsSource = true
            changed = true
          }
          if (info.fps) {
            next.fps = snapFps(info.fps)
            changed = true
          }
          return changed ? { ...track, settings: next } : track
        })
      })
      .catch(() => {
        /* ignore — likely audio-only */
      })
    return () => {
      cancelled = true
    }
  }, [audioPath, updateAllTracks])

  const resetSourceVideoInfo = useCallback(() => setSourceVideoInfo(null), [])

  return { sourceVideoInfo, resetSourceVideoInfo }
}
