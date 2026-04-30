/**
 * Canvas timeline: ruler + subtitle blocks + playhead.
 * Mirrors drawTimeline() and its interaction code from renderer/js/app.js.
 *
 * Returns a draw function (call it in useEffect when currentTime changes)
 * and mouse-event handlers to attach to the canvas element.
 */

import { useCallback, useEffect, useRef } from 'react'
import type { Segment } from '../types/app'

const RULER_H  = 20
const TRACK_H  = 32
const TOTAL_H  = RULER_H + TRACK_H
const EDGE_HIT = 6   // px tolerance for edge-drag detection

export const TIMELINE_HEIGHT = TOTAL_H

// Read a CSS custom property from :root so canvas drawing tracks the theme.
function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

interface UseTimelineOptions {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  segments: Segment[]
  /** Current total duration in seconds. */
  duration: number
  /** Accent color for the background color of subtitle blocks (hex string). */
  blockColor?: string
  /** When true, the timeline auto-pans to keep the playhead visible. */
  isPlaying?: boolean
  /** Called when user clicks to seek to a time. */
  onSeek?: (time: number) => void
  /** Called when a segment's start or end time is edited via edge-drag. */
  onSegmentEdge?: (segId: string, edge: 'start' | 'end', newTime: number) => void
}

interface TimelineState {
  zoom:    number
  scrollT: number
}

export function useTimeline({
  canvasRef,
  segments,
  duration,
  blockColor,
  isPlaying = false,
  onSeek,
  onSegmentEdge,
}: UseTimelineOptions) {
  // Zoom + scroll are mutable refs — we don't need React re-renders when they change,
  // the draw function reads them directly.
  const stateRef = useRef<TimelineState>({ zoom: 1, scrollT: 0 })
  // Cached current time so the theme observer can redraw without prop plumbing.
  const lastTimeRef = useRef<number>(0)
  // Track isPlaying via ref so draw() always reads the current value without
  // needing isPlaying in the useCallback dependency array.
  const isPlayingRef = useRef(false)
  isPlayingRef.current = isPlaying

  // ── Draw ──────────────────────────────────────────────────────────

  const draw = useCallback((currentTime: number) => {
    lastTimeRef.current = currentTime
    const canvas = canvasRef.current
    if (!canvas || !duration) return

    const wrap = canvas.parentElement
    if (!wrap) return

    const dpr  = window.devicePixelRatio || 1
    const cssW = wrap.clientWidth || 600
    const cssH = TOTAL_H
    const bW   = Math.round(cssW * dpr)
    const bH   = Math.round(cssH * dpr)

    if (canvas.width !== bW || canvas.height !== bH) {
      canvas.width  = bW
      canvas.height = bH
      canvas.style.width  = `${cssW}px`
      canvas.style.height = `${cssH}px`
    }

    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssW, cssH)

    // Resolve theme colors fresh each draw so the canvas tracks light/dark.
    const rulerBg   = cssVar('--color-bg',        '#0d1117')
    const trackBg   = cssVar('--color-surface',   '#161b22')
    const tickLine  = cssVar('--color-border-2',  '#30363d')
    const tickLabel = cssVar('--color-text-3',    '#8b949e')
    const blockBg   = blockColor || cssVar('--color-amber', '#D4952A')
    const blockText = '#ffffff'  // amber stays brand-colored — white text reads on both themes
    const accent    = cssVar('--color-accent',    '#4f8ef7')

    const { zoom, scrollT: rawScrollT } = stateRef.current
    const visibleDur = duration / zoom

    // ── Playhead follow (must run before drawing so the whole frame is consistent)
    // When playing, pan so the playhead sits at ~20% from the left.
    // Triggers when playhead goes past 85% of the visible window or off-screen.
    if (isPlayingRef.current) {
      const raw = Math.max(0, Math.min(rawScrollT, Math.max(0, duration - visibleDur)))
      if (currentTime < raw || currentTime > raw + visibleDur * 0.85) {
        stateRef.current.scrollT = Math.max(0, currentTime - visibleDur * 0.2)
      }
    }

    const scrollT = Math.max(0, Math.min(stateRef.current.scrollT, Math.max(0, duration - visibleDur)))
    stateRef.current.scrollT = scrollT

    const pps  = cssW / visibleDur
    const t0   = scrollT
    const t1   = scrollT + visibleDur
    const tToX = (t: number) => (t - t0) * pps

    // ── Background ────────────────────────────────────────────────
    ctx.fillStyle = rulerBg
    ctx.fillRect(0, 0, cssW, RULER_H)
    ctx.fillStyle = trackBg
    ctx.fillRect(0, RULER_H, cssW, TRACK_H)

    // ── Ruler ticks + labels ─────────────────────────────────────
    const step = niceStep(visibleDur, cssW)
    ctx.font = '10px -apple-system, "Segoe UI", sans-serif'
    ctx.textBaseline = 'middle'

    const firstTick = Math.floor(t0 / step) * step
    for (let t = firstTick; t <= t1 + 0.001; t += step) {
      const x = Math.round(tToX(t))
      ctx.strokeStyle = tickLine
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x + 0.5, 0)
      ctx.lineTo(x + 0.5, RULER_H)
      ctx.stroke()

      const mins = Math.floor(t / 60)
      const secs = Math.floor(t % 60)
      const sub  = step < 1 ? (t % 1).toFixed(step < 0.1 ? 2 : 1).slice(1) : ''
      const label = mins > 0
        ? `${mins}:${String(secs).padStart(2, '0')}${sub}`
        : `${secs}${sub}s`
      ctx.fillStyle = tickLabel
      ctx.fillText(label, x + 3, RULER_H / 2)
    }

    // ── Subtitle blocks ───────────────────────────────────────────
    const PAD = 3
    for (const seg of segments) {
      if (seg.end < t0 || seg.start > t1) continue

      const x = tToX(seg.start)
      const w = Math.max((seg.end - seg.start) * pps - 1, 3)
      const y = RULER_H + PAD
      const h = TRACK_H - PAD * 2
      const r = Math.min(4, h / 2)

      ctx.fillStyle = blockBg
      ctx.beginPath()
      ctx.moveTo(x + r, y)
      ctx.lineTo(x + w - r, y)
      ctx.quadraticCurveTo(x + w, y, x + w, y + r)
      ctx.lineTo(x + w, y + h - r)
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
      ctx.lineTo(x + r, y + h)
      ctx.quadraticCurveTo(x, y + h, x, y + h - r)
      ctx.lineTo(x, y + r)
      ctx.quadraticCurveTo(x, y, x + r, y)
      ctx.closePath()
      ctx.fill()

      if (w > 18) {
        ctx.save()
        ctx.beginPath()
        ctx.rect(x + 5, y, Math.max(w - 10, 1), h)
        ctx.clip()
        ctx.fillStyle = blockText
        ctx.font = 'bold 11px -apple-system, "Segoe UI", sans-serif'
        ctx.textBaseline = 'middle'
        const label = seg.words.slice(0, 5).map(w => w.word).join(' ').trim()
          || seg.text.trim().split(/\s+/).slice(0, 5).join(' ')
        ctx.fillText(label, x + 5, y + h / 2)
        ctx.restore()
      }
    }

    // ── Playhead ──────────────────────────────────────────────────
    if (currentTime != null && currentTime >= t0 && currentTime <= t1) {
      const px = tToX(currentTime)
      ctx.strokeStyle = accent
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(px, 0)
      ctx.lineTo(px, cssH)
      ctx.stroke()
      ctx.fillStyle = accent
      ctx.beginPath()
      ctx.moveTo(px - 5, 0)
      ctx.lineTo(px + 5, 0)
      ctx.lineTo(px, 7)
      ctx.closePath()
      ctx.fill()
    }
  }, [canvasRef, segments, duration, blockColor])

  // Redraw when the theme class on <html> flips so colors switch live.
  useEffect(() => {
    const root = document.documentElement
    const obs = new MutationObserver(() => draw(lastTimeRef.current))
    obs.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [draw])

  // ── Interactions ──────────────────────────────────────────────────

  const dragRef = useRef<{
    segId: string | null
    edge: 'start' | 'end' | null
    startClientX: number
    origVal: number
  } | null>(null)

  function timeAtX(clientX: number): number {
    const canvas = canvasRef.current
    if (!canvas || !duration) return 0
    const rect = canvas.getBoundingClientRect()
    const { zoom, scrollT } = stateRef.current
    const visibleDur = duration / zoom
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    return scrollT + ratio * visibleDur
  }

  function findEdge(clientX: number): { segId: string; edge: 'start' | 'end' | null } | null {
    const canvas = canvasRef.current
    if (!canvas || !duration) return null
    const rect = canvas.getBoundingClientRect()
    const { zoom, scrollT } = stateRef.current
    const visibleDur = duration / zoom
    const pps = rect.width / visibleDur

    for (const seg of segments) {
      const startPx = (seg.start - scrollT) * pps + rect.left
      const endPx   = (seg.end   - scrollT) * pps + rect.left
      if (Math.abs(clientX - startPx) <= EDGE_HIT) return { segId: seg.id, edge: 'start' }
      if (Math.abs(clientX - endPx)   <= EDGE_HIT) return { segId: seg.id, edge: 'end' }
      const t = timeAtX(clientX)
      if (t >= seg.start && t <= seg.end) return { segId: seg.id, edge: null }
    }
    return null
  }

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const hit = findEdge(e.clientX)
    if (hit?.edge) {
      const seg = segments.find(s => s.id === hit.segId)!
      dragRef.current = {
        segId:       hit.segId,
        edge:        hit.edge,
        startClientX: e.clientX,
        origVal:     hit.edge === 'start' ? seg.start : seg.end,
      }
      e.preventDefault()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, duration])

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!dragRef.current) return
    const canvas = canvasRef.current
    if (!canvas || !duration) return

    const { zoom, scrollT } = stateRef.current
    const rect = canvas.getBoundingClientRect()
    const pps = rect.width / (duration / zoom)
    const dt  = (e.clientX - dragRef.current.startClientX) / pps
    let newVal = Math.max(0, Math.min(duration, dragRef.current.origVal + dt))

    // Prevent overlap with adjacent segments
    const segIdx = segments.findIndex(s => s.id === dragRef.current!.segId)
    if (segIdx >= 0) {
      const seg = segments[segIdx]
      const MIN_GAP = 0.01 // minimum 10ms gap between groups
      if (dragRef.current.edge === 'start') {
        // Can't move start past the segment's own end
        newVal = Math.min(newVal, seg.end - MIN_GAP)
        // Can't overlap previous segment
        if (segIdx > 0) newVal = Math.max(newVal, segments[segIdx - 1].end + MIN_GAP)
      } else {
        // Can't move end before the segment's own start
        newVal = Math.max(newVal, seg.start + MIN_GAP)
        // Can't overlap next segment
        if (segIdx < segments.length - 1) newVal = Math.min(newVal, segments[segIdx + 1].start - MIN_GAP)
      }
    }

    onSegmentEdge?.(dragRef.current.segId!, dragRef.current.edge!, newVal)
    e.preventDefault()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, duration, onSegmentEdge])

  const onMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!dragRef.current) {
      // Simple click → seek
      onSeek?.(timeAtX(e.clientX))
    }
    dragRef.current = null
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onSeek, duration])

  // Wheel handling must use a native listener with { passive: false } so that
  // preventDefault() actually stops the page from scrolling/zooming. React's
  // onWheel JSX prop is registered as passive in modern Chrome and would log
  // "Unable to preventDefault inside passive event listener invocation".
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      const st = stateRef.current
      if (e.ctrlKey || e.metaKey) {
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
        const rect = canvas.getBoundingClientRect()
        const ratio = (e.clientX - rect.left) / rect.width
        const anchorT = st.scrollT + (duration / st.zoom) * ratio
        const newZoom = Math.max(1, Math.min(200, st.zoom * factor))
        st.zoom = newZoom
        st.scrollT = anchorT - (duration / newZoom) * ratio
      } else {
        const step = (duration / st.zoom) * 0.1
        st.scrollT = Math.max(0, Math.min(st.scrollT + (e.deltaY > 0 ? step : -step), duration))
      }
      // Redraw immediately — mutating refs alone won't trigger a re-render.
      draw(lastTimeRef.current)
    }
    canvas.addEventListener('wheel', handler, { passive: false })
    return () => canvas.removeEventListener('wheel', handler)
  }, [canvasRef, duration, draw])

  const setZoom = useCallback((zoom: number) => {
    stateRef.current.zoom = Math.max(1, zoom)
  }, [])

  return { draw, onMouseDown, onMouseMove, onMouseUp, setZoom }
}

// ── Helpers ────────────────────────────────────────────────────────

function niceStep(duration: number, widthPx: number): number {
  const steps = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
  const ideal = duration / (widthPx / 80)
  for (const s of steps) { if (s >= ideal) return s }
  return steps[steps.length - 1]
}
