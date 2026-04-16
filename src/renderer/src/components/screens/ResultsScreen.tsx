/**
 * Results screen — shown after transcription completes.
 * Layout: results-main (flex-1) | results-sidebar (StudioPanel, 380px).
 */

import { useCallback, useState } from 'react'
import type { TranscriptionResult, Segment } from '../../types/app'
import { AudioPlayer } from '../player/AudioPlayer'
import { SubtitleEditor } from '../editor/SubtitleEditor'
import { StudioPanel } from '../studio/StudioPanel'

interface ResultsScreenProps {
  result: TranscriptionResult
}

export function ResultsScreen({ result }: ResultsScreenProps) {
  // Segments are mutable (user can edit timing + word overrides)
  const [segments, setSegments] = useState<Segment[]>(result.segments)
  const [currentTime, setCurrentTime] = useState(0)
  const [seekTarget, setSeekTarget] = useState<number | null>(null)

  const handleTimeUpdate = useCallback((t: number) => setCurrentTime(t), [])

  const handleSeek = useCallback((t: number) => {
    setCurrentTime(t)
    setSeekTarget(t)   // AudioPlayer reads this to imperatively seek WaveSurfer
  }, [])

  const handleSeekDone = useCallback(() => setSeekTarget(null), [])

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Main area ────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <AudioPlayer
          audioPath={result.audioPath}
          segments={segments}
          onTimeUpdate={handleTimeUpdate}
          onSeek={handleSeekDone}
          seekTo={seekTarget}
        />
        <SubtitleEditor
          segments={segments}
          currentTime={currentTime}
          onSeek={handleSeek}
          onChange={setSegments}
        />
      </div>

      {/* ── Studio sidebar ────────────────────────────────────────── */}
      <StudioPanel />
    </div>
  )
}
