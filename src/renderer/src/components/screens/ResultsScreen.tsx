/**
 * Results screen — shown after transcription completes.
 * Layout mirrors the vanilla renderer's #screen-results structure:
 *   results-main (flex-1) | results-sidebar (380px fixed)
 *
 * Heavy components (WaveformPlayer, SubtitleEditor) are stubs — they need the
 * wavesurfer.js integration and canvas timeline ported from renderer/js/app.js.
 */

import type { TranscriptionResult } from '../../types/app'
import { StudioPanel } from '../studio/StudioPanel'

interface ResultsScreenProps {
  result: TranscriptionResult
}

export function ResultsScreen({ result }: ResultsScreenProps) {
  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Main area ──────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Audio / video player + timeline */}
        <AudioPlayer audioPath={result.audioPath} />

        {/* Subtitle word editor */}
        <SubtitleEditor result={result} />
      </div>

      {/* ── Right sidebar: Studio settings ─────────────────── */}
      <StudioPanel />
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────
   AudioPlayer stub
   TODO: Port wavesurfer.js init + canvas timeline from app.js
   ──────────────────────────────────────────────────────────────── */
function AudioPlayer({ audioPath }: { audioPath: string }) {
  return (
    <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)] p-4 flex flex-col gap-3">
      {/* Video / waveform area placeholder */}
      <div className="w-full aspect-video max-h-40 rounded-lg bg-black/40 flex items-center justify-center text-[var(--color-text-subtle)] text-xs">
        {/* TODO: <video> element + canvas subtitle overlay */}
        {audioPath.match(/\.(mp4|mkv|webm|mov)$/i) ? 'Video player' : 'Audio waveform'}
      </div>

      {/* Playback controls */}
      <div className="flex items-center gap-3">
        <button className="icon-btn" title="Play / Pause (Space)">
          <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm4.879-2.773 4.264 2.559a.25.25 0 0 1 0 .428l-4.264 2.559A.25.25 0 0 1 6 10.559V5.442a.25.25 0 0 1 .379-.215Z" />
          </svg>
        </button>
        <span className="text-xs text-[var(--color-text-muted)] tabular-nums">00:00 / 00:00</span>
      </div>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────
   SubtitleEditor stub
   TODO: Port word-by-word click editing + word-style-popup from app.js
   ──────────────────────────────────────────────────────────────── */
function SubtitleEditor({ result }: { result: TranscriptionResult }) {
  return (
    <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
      {result.segments.map(seg => (
        <div
          key={seg.id}
          className="p-3 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] text-sm leading-relaxed"
        >
          {/* Timing badge */}
          <div className="text-xs text-[var(--color-text-subtle)] mb-1.5 tabular-nums">
            {formatTime(seg.start)} → {formatTime(seg.end)}
            {seg.speaker && <span className="ml-2 text-[var(--color-accent)]">{seg.speaker}</span>}
          </div>

          {/* Word tokens — each will get click-to-edit + style popup */}
          <div className="flex flex-wrap gap-x-1">
            {seg.words.map((w, i) => (
              <span
                key={i}
                className="cursor-pointer hover:text-[var(--color-accent)] transition-colors"
                title={`${formatTime(w.start)} → ${formatTime(w.end)}`}
              >
                {w.word}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = (seconds % 60).toFixed(1).padStart(4, '0')
  return `${m}:${s}`
}
