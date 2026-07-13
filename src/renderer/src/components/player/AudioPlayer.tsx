/**
 * AudioPlayer — video/waveform/timeline player.
 * Ports initAudioPlayer(), drawTimeline() and their interaction code from app.js.
 *
 * For video files: renders a <video> element + waveform controlled by WaveSurfer.
 * For audio-only:  renders an audio-preview background + waveform.
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { SegmentBodyMove } from '../../hooks/useTimeline'
import { api } from '../../lib/api'
import { useWaveSurfer } from '../../hooks/useWaveSurfer'
import { useTimeline, TIMELINE_HEIGHT, TIMELINE_HEIGHT_EXPANDED } from '../../hooks/useTimeline'
import { useSubtitleOverlay } from '../../hooks/useSubtitleOverlay'
import { useVideoZoom } from '../../hooks/useVideoZoom'
import { SafeZoneOverlay } from './SafeZoneOverlay'
import type { Segment } from '../../types/app'
import type { StudioSettings } from '../studio/StudioPanel'

const VIDEO_EXTS = /\.(mp4|mkv|webm|mov|avi|m4v)$/i

export interface AudioPlayerHandle {
  seekRelative: (dt: number) => void
  seekToTime: (t: number) => void
  playPause: () => void
  getDuration: () => number
}

interface AudioPlayerProps {
  audioPath: string
  segments: Segment[]
  settings: StudioSettings
  resolution?: [number, number]
  onTimeUpdate?: (time: number) => void
  onSeek?: () => void
  /** When set, AudioPlayer immediately seeks to this time then calls onSeek(). */
  seekTo?: number | null
  /** Called when user drags a subtitle block edge or body in the timeline. */
  onSegmentEdge?: (
    segId: string,
    edge: 'start' | 'end' | 'body',
    newVal: number | SegmentBodyMove
  ) => void
  /** Called once when the drag begins (before any movement). */
  onSegmentEdgeDragStart?: (segId: string, edge: 'start' | 'end' | 'body') => void
  /** Called when user drags a word block/edge in the expanded word lane. */
  onWordEdge?: (segId: string, wordIdx: number, patch: { start: number; end: number }) => void
  /** Called once when a word drag begins (before any movement). */
  onWordEdgeDragStart?: (segId: string, wordIdx: number) => void
}

export const AudioPlayer = forwardRef<AudioPlayerHandle, AudioPlayerProps>(function AudioPlayer(
  {
    audioPath,
    segments,
    settings,
    resolution = [1920, 1080],
    onTimeUpdate,
    onSeek,
    seekTo,
    onSegmentEdge,
    onSegmentEdgeDragStart,
    onWordEdge,
    onWordEdgeDragStart,
  },
  ref
) {
  const isVideo = VIDEO_EXTS.test(audioPath)
  const audioUrl = api.audioUrl(audioPath)

  // DOM refs
  const videoRef = useRef<HTMLVideoElement>(null)
  const waveformRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const previewAreaRef = useRef<HTMLDivElement>(null)

  const [zoom, setZoomState] = useState(1)
  const zoomLabel = `${Math.round(zoom * 100)}%`

  // Phase 2: Hover tooltip state
  const [hoverState, setHoverState] = useState<{
    segId: string | null
    time: number
    x: number
    y: number
  } | null>(null)

  // Phase 4: selected group opens the word lane below the segment track
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)

  // Deselect if the selected group vanishes (merge/split/regroup)
  useEffect(() => {
    if (selectedGroupId && !segments.some((s) => s.id === selectedGroupId)) {
      setSelectedGroupId(null)
    }
  }, [segments, selectedGroupId])

  // ── Subtitle overlay ────────────────────────────────────────────
  const { draw: overlayDraw } = useSubtitleOverlay({
    canvasRef: overlayRef,
    anchorRef: previewAreaRef as React.RefObject<HTMLElement>,
    segments,
    settings,
    resolution,
  })

  // Stable ref so the WaveSurfer onTimeUpdate callback always calls the latest
  // timelineDraw without capturing a stale closure (timelineDraw closes over
  // `duration` which is 0 before WaveSurfer fires 'ready', causing early return).
  const timelineDrawRef = useRef<((t: number) => void) | undefined>(undefined)
  const currentTimeRef = useRef(0)
  // Stable ref for the waveform→timeline scroll sync callback (setTlScroll not yet defined here).
  const tlScrollSyncRef = useRef<((visibleStartTime: number) => void) | null>(null)

  // ── WaveSurfer ──────────────────────────────────────────────────
  const {
    playing,
    currentTime,
    duration,
    ready,
    playPause,
    seekTo: wsSeekTo,
    wsRef,
  } = useWaveSurfer({
    containerRef: waveformRef as React.RefObject<HTMLElement>,
    videoEl: isVideo ? videoRef.current : undefined,
    audioUrl: isVideo ? undefined : audioUrl,
    onTimeUpdate: useCallback(
      (t: number) => {
        currentTimeRef.current = t
        onTimeUpdate?.(t)
        timelineDrawRef.current?.(t)
        overlayDraw(t)
      },
      [overlayDraw]
    ),
    onSeek: useCallback(() => onSeek?.(), [onSeek]),
    onScroll: useCallback((visibleStartTime: number) => {
      tlScrollSyncRef.current?.(visibleStartTime)
    }, []),
  })

  // ── Imperative handle for keyboard shortcuts ─────────────────
  useImperativeHandle(
    ref,
    () => ({
      seekRelative: (dt: number) => {
        const t = Math.max(0, Math.min(currentTime + dt, duration || Infinity))
        wsSeekTo(t)
      },
      seekToTime: (t: number) => wsSeekTo(t),
      playPause,
      getDuration: () => duration,
    }),
    [currentTime, duration, wsSeekTo, playPause]
  )

  // Respond to external seekTo prop (driven by SubtitleEditor word click)
  useEffect(() => {
    if (seekTo != null) {
      wsSeekTo(seekTo)
      onSeek?.()
    }
    // Only re-run when the external seekTo request itself changes — wsSeekTo/onSeek
    // are intentionally excluded so a fresh render doesn't re-trigger the same seek.
  }, [seekTo]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Waveform sync ───────────────────────────────────────────────
  // Syncs WaveSurfer zoom and scroll to match the timeline canvas state.
  // pxPerSec = canvasWidth * zoom / duration keeps both views aligned on the same time axis.
  const syncWaveformRef = useRef<(zoom: number, scrollT: number) => void>(() => {})
  syncWaveformRef.current = (zoom: number, scrollT: number) => {
    const canvas = canvasRef.current
    const ws = wsRef.current
    if (!canvas || !ws || !duration) return
    const pxPerSec = (canvas.clientWidth * zoom) / duration
    ws.zoom(pxPerSec)
    ws.setScroll(scrollT * pxPerSec)
  }

  // ── Timeline ────────────────────────────────────────────────────
  const {
    draw: timelineDraw,
    onMouseDown,
    onMouseMove,
    onMouseUp,
    onMouseLeave: onCanvasLeave,
    setZoom: setTlZoom,
    setScroll: setTlScroll,
  } = useTimeline({
    canvasRef,
    segments,
    duration,
    isPlaying: playing,
    onSeek: wsSeekTo,
    onSegmentEdge,
    onSegmentEdgeDragStart,
    selectedSegId: selectedGroupId,
    onSelectSegment: setSelectedGroupId,
    onWordEdge,
    onWordEdgeDragStart,
    onHover: useCallback((segId, time, x, y) => {
      setHoverState(segId !== null || time > 0 ? { segId, time, x, y } : null)
    }, []),
    onZoomChange: (z, s) => syncWaveformRef.current(z, s),
    onScrollChange: (s, z) => syncWaveformRef.current(z, s),
  })
  // Keep refs current every render so WaveSurfer callbacks are never stale.
  timelineDrawRef.current = timelineDraw
  tlScrollSyncRef.current = (visibleStartTime: number) => {
    setTlScroll(visibleStartTime)
    timelineDraw(currentTimeRef.current)
  }

  // Initial draw when ready
  useEffect(() => {
    if (ready) {
      timelineDraw(0)
      overlayDraw(0)
    }
  }, [ready, segments, overlayDraw, timelineDraw])

  // Reset waveform zoom once when media first becomes ready (separate from segment changes)
  useEffect(() => {
    if (ready) syncWaveformRef.current(1, 0)
  }, [ready]) // eslint-disable-line react-hooks/exhaustive-deps

  // Re-draw when segments, duration, settings, or draw functions change
  useEffect(() => {
    timelineDraw(currentTime)
    overlayDraw(currentTime)
    // currentTime is intentionally excluded — it ticks on every playback frame, and
    // including it here would re-run this structural redraw on every tick instead of
    // only when segments/duration/settings actually change.
  }, [segments, duration, settings, overlayDraw, timelineDraw]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Video zoom (video-area zoom, independent of timeline zoom) ──
  const vz = useVideoZoom()

  // ── Timeline zoom controls ───────────────────────────────────────
  function handleZoomIn() {
    const next = Math.min(zoom * 1.5, 200)
    setZoomState(next)
    setTlZoom(next) // setTlZoom now calls onZoomChange which triggers syncWaveform
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

  // Phase 5: Keyboard shortcuts for zoom and segment navigation.
  // Guards against firing inside text inputs/textareas.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement)?.tagName
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        (document.activeElement as HTMLElement)?.isContentEditable
      )
        return

      if (e.key === '=' || e.key === '+') {
        e.preventDefault()
        handleZoomIn()
      } else if (e.key === '-') {
        e.preventDefault()
        handleZoomOut()
      } else if (e.key === '0') {
        e.preventDefault()
        handleZoomReset()
      } else if (e.key === ',') {
        e.preventDefault()
        wsSeekTo(Math.max(0, currentTime - 0.1))
      } else if (e.key === '.') {
        e.preventDefault()
        wsSeekTo(Math.min(duration, currentTime + 0.1))
      } else if (e.key === '[') {
        // Jump to start of containing or previous segment
        e.preventDefault()
        const prev = [...segments].reverse().find((s) => s.start < currentTime - 0.05)
        wsSeekTo(prev ? prev.start : 0)
      } else if (e.key === ']') {
        // Jump to start of next segment
        e.preventDefault()
        const next = segments.find((s) => s.start > currentTime + 0.05)
        if (next) wsSeekTo(next.start)
      } else if (e.key === 'Escape') {
        setSelectedGroupId(null)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTime, duration, segments, zoom])

  const tlHeight = selectedGroupId ? TIMELINE_HEIGHT_EXPANDED : TIMELINE_HEIGHT

  return (
    <div className="flex flex-col flex-1 min-h-0 border-b border-[var(--color-border)] bg-[var(--color-surface)] select-none">
      {/* ── Video / audio preview area ──────────────────────────── */}
      {/* container-type: size lets the aspect wrapper letterbox-fit via cqw/cqh
          units — the wrapper keeps the exact video aspect (SafeZoneOverlay
          relies on wrapper box == video box) while using all available space. */}
      <div
        className="relative flex-1 min-h-0 flex items-center justify-center"
        style={{ containerType: 'size' }}
      >
        {/* Video zoom toolbar */}
        <div
          className="absolute top-1 right-1 z-10 flex items-center gap-1 rounded px-1.5 py-0.5"
          style={{ background: 'var(--color-surface)' }}
        >
          <span className="text-2xs mr-1 hidden sm:block" style={{ color: 'var(--color-text-3)' }}>
            Ctrl+Wheel: zoom · Dbl-click: toggle
          </span>
          <button className="tl-btn" onClick={vz.zoomOut}>
            −
          </button>
          <span className="text-2xs w-10 text-center" style={{ color: 'var(--color-text-2)' }}>
            {Math.round(vz.zoom * 100)}%
          </span>
          <button className="tl-btn" onClick={vz.zoomIn}>
            +
          </button>
          <button className="tl-btn" onClick={vz.zoomReset}>
            Reset
          </button>
        </div>

        {isVideo ? (
          <div
            ref={(el) => {
              // Assign to both refs — previewAreaRef for overlay, wrapRef for zoom
              ;(previewAreaRef as React.MutableRefObject<HTMLDivElement | null>).current = el
              ;(vz.wrapRef as React.MutableRefObject<HTMLDivElement | null>).current = el
            }}
            className="relative overflow-hidden"
            style={{
              // When zoomed, drop the aspect-ratio constraint so the wrapper
              // can use the full preview area — otherwise the letterbox width
              // clips the scaled content on the sides. Video stays correct
              // aspect via object-contain inside.
              ...(vz.isZoomed
                ? { width: '100%', height: '100%' }
                : {
                    aspectRatio: `${resolution[0]} / ${resolution[1]}`,
                    width: `min(100cqw, ${(resolution[0] / resolution[1]) * 100}cqh)`,
                  }),
              cursor: vz.isZoomed ? 'grab' : 'default',
            }}
            {...vz.handlers}
          >
            <div
              className="relative w-full h-full"
              style={{ transform: vz.transform, transformOrigin: '0 0', transition: 'none' }}
            >
              <video ref={videoRef} src={audioUrl} className="w-full h-full object-contain" />
              <canvas ref={overlayRef} className="absolute inset-0 pointer-events-none" />
              {/* Preview-only platform safe-zone guides — separate layer, never
                  drawn by useSubtitleOverlay (parity harness unaffected). */}
              <SafeZoneOverlay platform={settings.safeZone ?? 'off'} />
            </div>
          </div>
        ) : (
          <div
            ref={previewAreaRef}
            className="relative overflow-hidden bg-[var(--color-bg)] flex items-center justify-center"
            style={{
              // Audio-only: use the configured resolution so captions still preview
              // at the correct aspect ratio against a neutral backdrop.
              aspectRatio: `${resolution[0]} / ${resolution[1]}`,
              width: `min(100cqw, ${(resolution[0] / resolution[1]) * 100}cqh)`,
            }}
          >
            <span className="text-xs opacity-60" style={{ color: 'var(--color-text-3)' }}>
              Audio only
            </span>
            {/* Subtitle overlay canvas for audio-only mode */}
            <canvas ref={overlayRef} className="absolute inset-0 pointer-events-none" />
          </div>
        )}
      </div>

      {/* ── Timeline zoom toolbar ───────────────────────────────── */}
      <div className="flex items-center gap-1 px-2 py-1 border-t border-[var(--color-border)]">
        <span className="text-2xs flex-1" style={{ color: 'var(--color-text-3)' }}>
          Ctrl+Wheel: zoom · Wheel: pan
        </span>
        <button className="tl-btn" title="Zoom out" onClick={handleZoomOut}>
          −
        </button>
        <span className="text-2xs w-10 text-center" style={{ color: 'var(--color-text-2)' }}>
          {zoomLabel}
        </span>
        <button className="tl-btn" title="Zoom in" onClick={handleZoomIn}>
          +
        </button>
        <button className="tl-btn" title="Fit" onClick={handleZoomReset}>
          Fit
        </button>
      </div>

      {/* ── Canvas timeline ─────────────────────────────────────── */}
      <div
        className="w-full relative"
        style={{ height: tlHeight, transition: 'height 150ms ease' }}
      >
        <canvas
          ref={canvasRef}
          className="block w-full cursor-pointer"
          style={{ height: tlHeight }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={() => {
            onCanvasLeave()
            setHoverState(null)
          }}
        />
        {/* Phase 2: Hover tooltip */}
        {hoverState && (
          <div
            className="pointer-events-none fixed z-[var(--z-dropdown)] rounded px-2 py-1 text-xs max-w-xs truncate shadow-lg"
            style={{
              left: hoverState.x + 12,
              top: hoverState.y - 36,
              background: 'var(--color-bg)',
              color: 'var(--color-text)',
              border: '1px solid var(--color-border-2)',
            }}
          >
            {hoverState.segId
              ? (segments.find((s) => s.id === hoverState.segId)?.text ?? '')
              : formatTime(hoverState.time)}
          </div>
        )}
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
        <span className="text-xs tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      </div>
    </div>
  )
})

function formatTime(s: number): string {
  const m = Math.floor(s / 60)
  const sec = String(Math.floor(s % 60)).padStart(2, '0')
  return `${m}:${sec}`
}
