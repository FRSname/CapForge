/**
 * AudioPlayer — video/waveform/timeline player.
 * Ports initAudioPlayer(), drawTimeline() and their interaction code from app.js.
 *
 * For video files: renders a <video> element + waveform controlled by WaveSurfer.
 * For audio-only:  renders an audio-preview background + waveform.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api'
import { useWaveSurfer } from '../../hooks/useWaveSurfer'
import { useTimeline, TIMELINE_HEIGHT } from '../../hooks/useTimeline'
import { useSubtitleOverlay } from '../../hooks/useSubtitleOverlay'
import { useVideoZoom } from '../../hooks/useVideoZoom'
import type { Segment } from '../../types/app'
import type { StudioSettings } from '../studio/StudioPanel'

const VIDEO_EXTS = /\.(mp4|mkv|webm|mov|avi|m4v)$/i

interface AudioPlayerProps {
  audioPath: string
  segments: Segment[]
  settings: StudioSettings
  resolution?: [number, number]
  onTimeUpdate?: (time: number) => void
  onSeek?: () => void
  /** When set, AudioPlayer immediately seeks to this time then calls onSeek(). */
  seekTo?: number | null
  /** Called when user drags a subtitle block edge in the timeline. */
  onSegmentEdge?: (segId: string, edge: 'start' | 'end', newTime: number) => void
}

export function AudioPlayer({ audioPath, segments, settings, resolution = [1920, 1080], onTimeUpdate, onSeek, seekTo, onSegmentEdge }: AudioPlayerProps) {
  const isVideo = VIDEO_EXTS.test(audioPath)
  const audioUrl = api.audioUrl(audioPath)

  // DOM refs
  const videoRef      = useRef<HTMLVideoElement>(null)
  const waveformRef   = useRef<HTMLDivElement>(null)
  const canvasRef     = useRef<HTMLCanvasElement>(null)
  const overlayRef    = useRef<HTMLCanvasElement>(null)
  const previewAreaRef = useRef<HTMLDivElement>(null)

  const [zoom, setZoomState] = useState(1)
  const zoomLabel = `${Math.round(zoom * 100)}%`

  // ── Subtitle overlay ────────────────────────────────────────────
  const { draw: overlayDraw } = useSubtitleOverlay({
    canvasRef: overlayRef,
    anchorRef: previewAreaRef as React.RefObject<HTMLElement>,
    segments,
    settings,
    resolution,
  })

  // ── WaveSurfer ──────────────────────────────────────────────────
  const { playing, currentTime, duration, ready, playPause, seekTo: wsSeekTo } = useWaveSurfer({
    containerRef: waveformRef as React.RefObject<HTMLElement>,
    videoEl:  isVideo ? videoRef.current : undefined,
    audioUrl: isVideo ? undefined : audioUrl,
    onTimeUpdate: useCallback((t: number) => {
      onTimeUpdate?.(t)
      timelineDraw(t)
      overlayDraw(t)
    }, [overlayDraw]),  // eslint-disable-line react-hooks/exhaustive-deps
    onSeek: useCallback(() => onSeek?.(), [onSeek]),
  })

  // Respond to external seekTo prop (driven by SubtitleEditor word click)
  useEffect(() => {
    if (seekTo != null) {
      wsSeekTo(seekTo)
      onSeek?.()
    }
  }, [seekTo]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Timeline ────────────────────────────────────────────────────
  const { draw: timelineDraw, onMouseDown, onMouseMove, onMouseUp, onWheel, setZoom: setTlZoom } = useTimeline({
    canvasRef,
    segments,
    duration,
    onSeek: wsSeekTo,
    onSegmentEdge,
  })

  // Initial draw when ready
  useEffect(() => {
    if (ready) { timelineDraw(0); overlayDraw(0) }
  }, [ready, segments, overlayDraw, timelineDraw])

  // Re-draw when segments, duration, settings, or draw functions change
  useEffect(() => {
    timelineDraw(currentTime)
    overlayDraw(currentTime)
  }, [segments, duration, settings, overlayDraw, timelineDraw]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Video zoom (video-area zoom, independent of timeline zoom) ──
  const vz = useVideoZoom()

  // ── Timeline zoom controls ───────────────────────────────────────
  function handleZoomIn() {
    const next = Math.min(zoom * 1.5, 200)
    setZoomState(next)
    setTlZoom(next)
    timelineDraw(currentTime)
  }
  function handleZoomOut() {
    const next = Math.max(zoom / 1.5, 1)
    setZoomState(next)
    setTlZoom(next)
    timelineDraw(currentTime)
  }
  function handleZoomReset() {
    setZoomState(1)
    setTlZoom(1)
    timelineDraw(currentTime)
  }

  return (
    <div className="flex flex-col border-b border-[var(--color-border)] bg-[var(--color-surface)] select-none">

      {/* ── Video / audio preview area ──────────────────────────── */}
      <div className="relative flex-1 min-h-0">
        {/* Video zoom toolbar */}
        <div className="absolute top-1 right-1 z-10 flex items-center gap-1 bg-black/50 rounded px-1.5 py-0.5">
          <span className="text-[10px] text-white/40 mr-1 hidden sm:block">Ctrl+Wheel: zoom · Dbl-click: toggle</span>
          <button className="tl-btn" onClick={vz.zoomOut}>−</button>
          <span className="text-[10px] text-white/60 w-10 text-center">{Math.round(vz.zoom * 100)}%</span>
          <button className="tl-btn" onClick={vz.zoomIn}>+</button>
          <button className="tl-btn" onClick={vz.zoomReset}>Reset</button>
        </div>

        {isVideo ? (
          <div
            ref={(el) => {
              // Assign to both refs — previewAreaRef for overlay, wrapRef for zoom
              (previewAreaRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
              (vz.wrapRef as React.MutableRefObject<HTMLDivElement | null>).current = el
            }}
            className="relative w-full mx-auto overflow-hidden bg-black"
            style={{
              // When zoomed, drop the aspect-ratio constraint so the wrapper
              // can use the full available main-area width — otherwise the
              // 55vh × aspect maxWidth clips the scaled content on the sides.
              // Video stays correct aspect via object-contain inside.
              ...(vz.isZoomed
                ? { height: '55vh' }
                : {
                    aspectRatio: `${resolution[0]} / ${resolution[1]}`,
                    maxHeight: '55vh',
                    maxWidth:  `calc(55vh * ${resolution[0] / resolution[1]})`,
                  }),
              cursor: vz.isZoomed ? 'grab' : 'default',
            }}
            {...vz.handlers}
          >
            <div
              className="relative w-full h-full"
              style={{ transform: vz.transform, transformOrigin: '0 0', transition: 'none' }}
            >
              <video
                ref={videoRef}
                src={audioUrl}
                className="w-full h-full object-contain"
              />
              <canvas
                ref={overlayRef}
                className="absolute inset-0 pointer-events-none"
              />
            </div>
          </div>
        ) : (
          <div
            ref={previewAreaRef}
            className="relative w-full mx-auto overflow-hidden bg-[#0d1117] flex items-center justify-center"
            style={{
              // Audio-only: use the configured resolution so captions still preview
              // at the correct aspect ratio against a neutral backdrop.
              aspectRatio: `${resolution[0]} / ${resolution[1]}`,
              maxHeight: '40vh',
              maxWidth:  `calc(40vh * ${resolution[0] / resolution[1]})`,
            }}
          >
            <span className="text-xs text-white/20">Audio only</span>
            {/* Subtitle overlay canvas for audio-only mode */}
            <canvas
              ref={overlayRef}
              className="absolute inset-0 pointer-events-none"
            />
          </div>
        )}
      </div>

      {/* ── Timeline zoom toolbar ───────────────────────────────── */}
      <div className="flex items-center gap-1 px-2 py-1 border-t border-[var(--color-border)]">
        <span className="text-[10px] text-white/30 flex-1">Ctrl+Wheel: zoom · Wheel: pan</span>
        <button className="tl-btn" title="Zoom out" onClick={handleZoomOut}>−</button>
        <span className="text-[10px] text-white/60 w-10 text-center">{zoomLabel}</span>
        <button className="tl-btn" title="Zoom in"  onClick={handleZoomIn}>+</button>
        <button className="tl-btn" title="Fit"      onClick={handleZoomReset}>Fit</button>
      </div>

      {/* ── Canvas timeline ─────────────────────────────────────── */}
      <div className="w-full" style={{ height: TIMELINE_HEIGHT }}>
        <canvas
          ref={canvasRef}
          className="block w-full cursor-pointer"
          style={{ height: TIMELINE_HEIGHT }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onWheel={onWheel}
        />
      </div>

      {/* ── Waveform ────────────────────────────────────────────── */}
      <div ref={waveformRef} className="w-full" />

      {/* ── Playback controls ────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-3 py-2 border-t border-[var(--color-border)]">
        <button
          className="icon-btn"
          title="Play / Pause (Space)"
          onClick={playPause}
          disabled={!ready}
        >
          {playing ? (
            <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0ZM6 4.75A.75.75 0 0 1 6.75 4h.5a.75.75 0 0 1 .75.75v6.5a.75.75 0 0 1-.75.75h-.5a.75.75 0 0 1-.75-.75Zm4 0a.75.75 0 0 1-.75.75h-.5A.75.75 0 0 1 8 4.75v6.5a.75.75 0 0 1 .75.75h.5a.75.75 0 0 1 .75-.75Z" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm4.879-2.773 4.264 2.559a.25.25 0 0 1 0 .428l-4.264 2.559A.25.25 0 0 1 6 10.559V5.442a.25.25 0 0 1 .379-.215Z" />
            </svg>
          )}
        </button>
        <span className="text-xs text-[var(--color-text-muted)] tabular-nums">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      </div>
    </div>
  )
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60)
  const sec = String(Math.floor(s % 60)).padStart(2, '0')
  return `${m}:${sec}`
}
