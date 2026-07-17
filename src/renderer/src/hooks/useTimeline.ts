/**
 * Canvas timeline: ruler + subtitle blocks + playhead.
 * Mirrors drawTimeline() and its interaction code from renderer/js/app.js.
 *
 * Returns a draw function (call it in useEffect when currentTime changes)
 * and mouse-event handlers to attach to the canvas element.
 */

import { useCallback, useEffect, useRef } from 'react'
import type { Segment } from '../types/app'
import {
  niceStep,
  nearestSnap,
  computePixelsPerSecond,
  timeToPixel,
  clientXToTime,
  clampScrollT,
  computeAutoPanScrollT,
  computeZoomAtPointer,
  computeWheelScroll,
  clampZoom,
} from '../lib/timelineMath'

const RULER_H = 20
const TRACK_H = 32
const TOTAL_H = RULER_H + TRACK_H
const WORD_TRACK_H = 24 // extra lane shown while a group is selected
const EDGE_HIT = 6 // px tolerance for edge-drag detection
const SNAP_THRESHOLD_PX = 8 // px within which a value snaps to a target
const MIN_WORD_DUR = 0.04 // a word can never collapse below this (seconds)
const CLICK_SLOP_PX = 2 // movement below this counts as a click, not a drag

export const TIMELINE_HEIGHT = TOTAL_H
export const TIMELINE_HEIGHT_EXPANDED = TOTAL_H + WORD_TRACK_H

// Read a CSS custom property from :root so canvas drawing tracks the theme.
function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

/** Payload for body-drag: both endpoints move together. */
export type SegmentBodyMove = { start: number; end: number }

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
  /** Called when a segment's start/end time is edited (edge drag) or both are
   *  moved together (body drag). */
  onSegmentEdge?: (
    segId: string,
    edge: 'start' | 'end' | 'body',
    newVal: number | SegmentBodyMove
  ) => void
  /** Called once when the user first grabs a segment (before any movement). */
  onSegmentEdgeDragStart?: (segId: string, edge: 'start' | 'end' | 'body') => void
  /** Group whose words render in the word lane (null/undefined = lane collapsed). */
  selectedSegId?: string | null
  /** Fired when the user clicks a block (select/toggle) or empty space (null). */
  onSelectSegment?: (segId: string | null) => void
  /** Called while a word in the lane is dragged — patch carries both endpoints. */
  onWordEdge?: (segId: string, wordIdx: number, patch: { start: number; end: number }) => void
  /** Called once when the user first grabs a word (before any movement). */
  onWordEdgeDragStart?: (segId: string, wordIdx: number) => void
  /** Called while the cursor moves with no active drag: segId is the segment
   *  under the cursor (null if none), time is seconds at cursor position. */
  onHover?: (segId: string | null, time: number, clientX: number, clientY: number) => void
  /** Called when zoom or scroll changes so the caller can sync other views. */
  onZoomChange?: (zoom: number, scrollT: number) => void
  onScrollChange?: (scrollT: number, zoom: number) => void
}

interface TimelineState {
  zoom: number
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
  onSegmentEdgeDragStart,
  selectedSegId = null,
  onSelectSegment,
  onWordEdge,
  onWordEdgeDragStart,
  onHover,
  onZoomChange,
  onScrollChange,
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
  // Active snap target in seconds while a drag is in progress (null = no snap).
  const snapTargetRef = useRef<number | null>(null)

  // ── Draw ──────────────────────────────────────────────────────────

  const draw = useCallback(
    (currentTime: number) => {
      lastTimeRef.current = currentTime
      const canvas = canvasRef.current
      if (!canvas || !duration) return

      const wrap = canvas.parentElement
      if (!wrap) return

      // Word lane is only open while a (still-existing) group is selected.
      const selectedSeg = selectedSegId ? segments.find((s) => s.id === selectedSegId) : undefined

      const dpr = window.devicePixelRatio || 1
      const cssW = wrap.clientWidth || 600
      const cssH = selectedSeg ? TOTAL_H + WORD_TRACK_H : TOTAL_H
      const bW = Math.round(cssW * dpr)
      const bH = Math.round(cssH * dpr)

      if (canvas.width !== bW || canvas.height !== bH) {
        canvas.width = bW
        canvas.height = bH
        canvas.style.width = `${cssW}px`
        canvas.style.height = `${cssH}px`
      }

      const ctx = canvas.getContext('2d')!
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, cssW, cssH)

      // Resolve theme colors fresh each draw so the canvas tracks light/dark.
      const rulerBg = cssVar('--color-bg', '#0d1117')
      const trackBg = cssVar('--color-surface', '#161b22')
      const tickLine = cssVar('--color-border-2', '#30363d')
      const tickLabel = cssVar('--color-text-3', '#8b949e')
      const blockBg = blockColor || cssVar('--color-amber', '#D4952A')
      const blockText = '#ffffff' // amber stays brand-colored — white text reads on both themes
      const accent = cssVar('--color-accent', '#4f8ef7')

      const { zoom, scrollT: rawScrollT } = stateRef.current
      const visibleDur = duration / zoom

      // ── Playhead follow (must run before drawing so the whole frame is consistent)
      // When playing, pan so the playhead sits at ~20% from the left.
      // Triggers when playhead goes past 85% of the visible window or off-screen.
      if (isPlayingRef.current) {
        const autoPanScrollT = computeAutoPanScrollT(currentTime, rawScrollT, duration, visibleDur)
        if (autoPanScrollT !== null) {
          stateRef.current.scrollT = autoPanScrollT
        }
      }

      const scrollT = clampScrollT(stateRef.current.scrollT, duration, visibleDur)
      stateRef.current.scrollT = scrollT

      const pps = computePixelsPerSecond(cssW, visibleDur)
      const t0 = scrollT
      const t1 = scrollT + visibleDur
      const tToX = (t: number) => timeToPixel(t, t0, pps)

      // ── Background ────────────────────────────────────────────────
      ctx.fillStyle = rulerBg
      ctx.fillRect(0, 0, cssW, RULER_H)
      ctx.fillStyle = trackBg
      ctx.fillRect(0, RULER_H, cssW, TRACK_H)

      // ── Phase 4: Adaptive ruler — minor ticks + labeled major ticks ─
      const majorStep = niceStep(visibleDur, cssW)
      const minorStep = majorStep / 5
      ctx.font = '10px -apple-system, "Segoe UI", sans-serif'
      ctx.textBaseline = 'middle'

      // Minor ticks (no label, short, dimmed)
      const firstMinor = Math.floor(t0 / minorStep) * minorStep
      ctx.strokeStyle = tickLine
      ctx.lineWidth = 1
      ctx.globalAlpha = 0.5
      for (let t = firstMinor; t <= t1 + minorStep * 0.001; t += minorStep) {
        const isMajor = Math.abs(Math.round(t / majorStep) * majorStep - t) < majorStep * 0.001
        if (isMajor) continue
        const x = Math.round(tToX(t))
        if (x < 0 || x > cssW) continue
        ctx.beginPath()
        ctx.moveTo(x + 0.5, RULER_H - 5)
        ctx.lineTo(x + 0.5, RULER_H)
        ctx.stroke()
      }
      ctx.globalAlpha = 1

      // Major ticks with labels
      const firstMajor = Math.floor(t0 / majorStep) * majorStep
      for (let t = firstMajor; t <= t1 + 0.001; t += majorStep) {
        const x = Math.round(tToX(t))
        ctx.strokeStyle = tickLine
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(x + 0.5, 0)
        ctx.lineTo(x + 0.5, RULER_H)
        ctx.stroke()

        const mins = Math.floor(t / 60)
        const secs = Math.floor(t % 60)
        const sub = majorStep < 1 ? (t % 1).toFixed(majorStep < 0.1 ? 2 : 1).slice(1) : ''
        const label = mins > 0 ? `${mins}:${String(secs).padStart(2, '0')}${sub}` : `${secs}${sub}s`
        ctx.fillStyle = tickLabel
        ctx.fillText(label, x + 3, RULER_H / 2)
      }

      // ── Phase 6: Subtitle blocks with active-segment highlight ────
      const PAD = 3
      for (const seg of segments) {
        if (seg.end < t0 || seg.start > t1) continue

        const x = tToX(seg.start)
        const w = Math.max((seg.end - seg.start) * pps - 1, 3)
        const y = RULER_H + PAD
        const h = TRACK_H - PAD * 2
        const r = Math.min(4, h / 2)
        const isActive = currentTime >= seg.start && currentTime < seg.end

        const roundRect = () => {
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
        }

        ctx.fillStyle = blockBg
        ctx.globalAlpha = isActive ? 1.0 : 0.75
        roundRect()
        ctx.fill()
        ctx.globalAlpha = 1

        if (isActive) {
          ctx.strokeStyle = accent
          ctx.lineWidth = 2
          roundRect()
          ctx.stroke()
        } else if (seg.id === selectedSegId) {
          ctx.strokeStyle = accent
          ctx.lineWidth = 1.5
          ctx.globalAlpha = 0.9
          roundRect()
          ctx.stroke()
          ctx.globalAlpha = 1
        }

        if (w > 18) {
          ctx.save()
          ctx.beginPath()
          ctx.rect(x + 5, y, Math.max(w - 10, 1), h)
          ctx.clip()
          ctx.fillStyle = blockText
          ctx.font = 'bold 11px -apple-system, "Segoe UI", sans-serif'
          ctx.textBaseline = 'middle'
          const label =
            seg.words
              .slice(0, 5)
              .map((w) => w.word)
              .join(' ')
              .trim() || seg.text.trim().split(/\s+/).slice(0, 5).join(' ')
          ctx.fillText(label, x + 5, y + h / 2)
          ctx.restore()
        }
      }

      // ── Word lane: the selected group's words as draggable sub-blocks ─
      if (selectedSeg) {
        ctx.fillStyle = rulerBg
        ctx.fillRect(0, TOTAL_H, cssW, WORD_TRACK_H)

        const wy = TOTAL_H + 2
        const wh = WORD_TRACK_H - 4
        for (const word of selectedSeg.words) {
          if (word.end < t0 || word.start > t1) continue

          const wx = tToX(word.start)
          const ww = Math.max((word.end - word.start) * pps - 1, 2)
          const isActiveWord = currentTime >= word.start && currentTime < word.end

          roundRectPath(ctx, wx, wy, ww, wh, Math.min(3, wh / 2))
          ctx.fillStyle = accent
          ctx.globalAlpha = isActiveWord ? 1.0 : 0.55
          ctx.fill()
          ctx.globalAlpha = 1

          if (ww > 14) {
            ctx.save()
            ctx.beginPath()
            ctx.rect(wx + 3, wy, Math.max(ww - 6, 1), wh)
            ctx.clip()
            ctx.fillStyle = blockText
            ctx.font = '9px -apple-system, "Segoe UI", sans-serif'
            ctx.textBaseline = 'middle'
            ctx.fillText(word.word.trim(), wx + 3, wy + wh / 2)
            ctx.restore()
          }
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

      // ── Phase 3: Snap indicator (dashed vertical line during drag) ─
      const snapT = snapTargetRef.current
      if (snapT !== null && snapT >= t0 && snapT <= t1) {
        const sx = Math.round(tToX(snapT))
        ctx.strokeStyle = accent
        ctx.lineWidth = 1
        ctx.globalAlpha = 0.6
        ctx.setLineDash([3, 3])
        ctx.beginPath()
        ctx.moveTo(sx + 0.5, 0)
        ctx.lineTo(sx + 0.5, cssH)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.globalAlpha = 1
      }
    },
    [canvasRef, segments, duration, blockColor, selectedSegId]
  )

  // Redraw when the theme class on <html> flips so colors switch live.
  useEffect(() => {
    const root = document.documentElement
    const obs = new MutationObserver(() => draw(lastTimeRef.current))
    obs.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [draw])

  // ── Interactions ──────────────────────────────────────────────────

  // Phase 1: dragRef now tracks body drags in addition to edge drags.
  const dragRef = useRef<{
    segId: string
    edge: 'start' | 'end' | 'body'
    startClientX: number
    origStart: number
    origEnd: number
  } | null>(null)
  // Word-lane drag (mutually exclusive with dragRef — word hits win on mousedown).
  const wordDragRef = useRef<{
    segId: string
    wordIdx: number
    edge: 'start' | 'end' | 'body'
    startClientX: number
    origStart: number
    origEnd: number
  } | null>(null)
  // Whether the pointer moved beyond click-slop since mousedown — distinguishes
  // click-to-select from an actual drag so a plain click never nudges timings.
  const movedRef = useRef(false)

  function timeAtX(clientX: number): number {
    const canvas = canvasRef.current
    if (!canvas || !duration) return 0
    const rect = canvas.getBoundingClientRect()
    const { zoom, scrollT } = stateRef.current
    const visibleDur = duration / zoom
    return clientXToTime(clientX, rect.left, rect.width, scrollT, visibleDur)
  }

  // Phase 1: returns 'body' (instead of null) when cursor is over a segment's center.
  function findEdge(clientX: number): { segId: string; edge: 'start' | 'end' | 'body' } | null {
    const canvas = canvasRef.current
    if (!canvas || !duration) return null
    const rect = canvas.getBoundingClientRect()
    const { zoom, scrollT } = stateRef.current
    const visibleDur = duration / zoom
    const pps = computePixelsPerSecond(rect.width, visibleDur)

    for (const seg of segments) {
      const startPx = (seg.start - scrollT) * pps + rect.left
      const endPx = (seg.end - scrollT) * pps + rect.left
      if (Math.abs(clientX - startPx) <= EDGE_HIT) return { segId: seg.id, edge: 'start' }
      if (Math.abs(clientX - endPx) <= EDGE_HIT) return { segId: seg.id, edge: 'end' }
      const t = timeAtX(clientX)
      if (t >= seg.start && t <= seg.end) return { segId: seg.id, edge: 'body' }
    }
    return null
  }

  /** True when the cursor's Y falls inside the (open) word lane. */
  function isInWordLane(clientY: number): boolean {
    if (!selectedSegId) return false
    const canvas = canvasRef.current
    if (!canvas) return false
    const y = clientY - canvas.getBoundingClientRect().top
    return y >= TOTAL_H && y <= TOTAL_H + WORD_TRACK_H
  }

  /** Hit-test the selected group's words. Edges are checked across ALL words
   *  first so a wide word's body can't swallow a neighbour's edge grip. */
  function findWordHit(
    clientX: number,
    clientY: number
  ): { wordIdx: number; edge: 'start' | 'end' | 'body' } | null {
    if (!isInWordLane(clientY)) return null
    const seg = segments.find((s) => s.id === selectedSegId)
    if (!seg) return null
    const canvas = canvasRef.current
    if (!canvas || !duration) return null
    const rect = canvas.getBoundingClientRect()
    const { zoom, scrollT } = stateRef.current
    const pps = computePixelsPerSecond(rect.width, duration / zoom)

    for (let i = 0; i < seg.words.length; i++) {
      const startPx = (seg.words[i].start - scrollT) * pps + rect.left
      const endPx = (seg.words[i].end - scrollT) * pps + rect.left
      if (Math.abs(clientX - startPx) <= EDGE_HIT) return { wordIdx: i, edge: 'start' }
      if (Math.abs(clientX - endPx) <= EDGE_HIT) return { wordIdx: i, edge: 'end' }
    }
    const t = timeAtX(clientX)
    for (let i = 0; i < seg.words.length; i++) {
      if (t >= seg.words[i].start && t <= seg.words[i].end) return { wordIdx: i, edge: 'body' }
    }
    return null
  }

  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      movedRef.current = false

      // Word lane wins: grabbing a word must never fall through to the segment.
      const wordHit = findWordHit(e.clientX, e.clientY)
      if (wordHit && selectedSegId) {
        const seg = segments.find((s) => s.id === selectedSegId)
        if (seg) {
          const word = seg.words[wordHit.wordIdx]
          wordDragRef.current = {
            segId: seg.id,
            wordIdx: wordHit.wordIdx,
            edge: wordHit.edge,
            startClientX: e.clientX,
            origStart: word.start,
            origEnd: word.end,
          }
          onWordEdgeDragStart?.(seg.id, wordHit.wordIdx)
          e.preventDefault()
          return
        }
      }
      // Empty lane space never grabs the segment track behind it — a mouseup
      // there falls through to seek + deselect.
      if (isInWordLane(e.clientY)) return

      const hit = findEdge(e.clientX)
      if (hit) {
        const seg = segments.find((s) => s.id === hit.segId)!
        dragRef.current = {
          segId: hit.segId,
          edge: hit.edge,
          startClientX: e.clientX,
          origStart: seg.start,
          origEnd: seg.end,
        }
        onSegmentEdgeDragStart?.(hit.segId, hit.edge)
        e.preventDefault()
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [segments, duration, selectedSegId, onSegmentEdgeDragStart, onWordEdgeDragStart]
  )

  const onMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current

      // Phase 2: Hover feedback when not dragging — cursor shape + onHover callback.
      if (!dragRef.current && !wordDragRef.current) {
        const wordHit = findWordHit(e.clientX, e.clientY)
        const hit = wordHit || isInWordLane(e.clientY) ? null : findEdge(e.clientX)
        if (canvas) {
          canvas.style.cursor = wordHit
            ? wordHit.edge === 'body'
              ? 'grab'
              : 'ew-resize'
            : hit?.edge === 'start' || hit?.edge === 'end'
              ? 'ew-resize'
              : hit?.edge === 'body'
                ? 'grab'
                : 'pointer'
        }
        onHover?.(hit?.segId ?? null, timeAtX(e.clientX), e.clientX, e.clientY)
        return
      }

      if (!canvas || !duration) return

      // ── Word drag (lane) ─────────────────────────────────────────
      const wd = wordDragRef.current
      if (wd) {
        canvas.style.cursor = wd.edge === 'body' ? 'grabbing' : 'ew-resize'
        if (Math.abs(e.clientX - wd.startClientX) <= CLICK_SLOP_PX && !movedRef.current) return
        movedRef.current = true

        const rect = canvas.getBoundingClientRect()
        const pps = computePixelsPerSecond(rect.width, duration / stateRef.current.zoom)
        const dt = (e.clientX - wd.startClientX) / pps

        const segIdx = segments.findIndex((s) => s.id === wd.segId)
        if (segIdx < 0) return
        const seg = segments[segIdx]
        const prevW = seg.words[wd.wordIdx - 1]
        const nextW = seg.words[wd.wordIdx + 1]
        // First/last word may push past the group bounds (the group follows in
        // the caller) but never into a neighbouring group.
        const lowerBound = prevW ? prevW.end : segIdx > 0 ? segments[segIdx - 1].end : 0
        const upperBound = nextW
          ? nextW.start
          : segIdx < segments.length - 1
            ? segments[segIdx + 1].start
            : duration

        const snapThresholdT = SNAP_THRESHOLD_PX / pps
        const snapTargets: number[] = [lastTimeRef.current]
        for (let i = 0; i < seg.words.length; i++) {
          if (i !== wd.wordIdx) snapTargets.push(seg.words[i].start, seg.words[i].end)
        }

        if (wd.edge === 'body') {
          const dur = wd.origEnd - wd.origStart
          let newStart = wd.origStart + dt
          newStart = Math.max(lowerBound, Math.min(newStart, upperBound - dur))
          const snapped = nearestSnap(newStart, snapTargets, snapThresholdT)
          snapTargetRef.current = snapped
          if (snapped !== null) newStart = snapped
          newStart = Math.max(lowerBound, Math.min(newStart, upperBound - dur))
          onWordEdge?.(wd.segId, wd.wordIdx, { start: newStart, end: newStart + dur })
        } else if (wd.edge === 'start') {
          let v = wd.origStart + dt
          const snapped = nearestSnap(v, snapTargets, snapThresholdT)
          snapTargetRef.current = snapped
          if (snapped !== null) v = snapped
          v = Math.max(lowerBound, Math.min(v, wd.origEnd - MIN_WORD_DUR))
          onWordEdge?.(wd.segId, wd.wordIdx, { start: v, end: wd.origEnd })
        } else {
          let v = wd.origEnd + dt
          const snapped = nearestSnap(v, snapTargets, snapThresholdT)
          snapTargetRef.current = snapped
          if (snapped !== null) v = snapped
          v = Math.max(wd.origStart + MIN_WORD_DUR, Math.min(v, upperBound))
          onWordEdge?.(wd.segId, wd.wordIdx, { start: wd.origStart, end: v })
        }

        draw(lastTimeRef.current)
        e.preventDefault()
        return
      }

      if (!dragRef.current) return
      canvas.style.cursor = dragRef.current.edge === 'body' ? 'grabbing' : 'ew-resize'
      // Click-slop: a body press that never moves is a click-to-select, and it
      // must not nudge the segment (snap could otherwise shift it on mousedown).
      if (Math.abs(e.clientX - dragRef.current.startClientX) <= CLICK_SLOP_PX && !movedRef.current)
        return
      movedRef.current = true

      const { zoom } = stateRef.current
      const rect = canvas.getBoundingClientRect()
      const pps = computePixelsPerSecond(rect.width, duration / zoom)
      const dt = (e.clientX - dragRef.current.startClientX) / pps

      const segIdx = segments.findIndex((s) => s.id === dragRef.current!.segId)
      if (segIdx < 0) return
      const seg = segments[segIdx]
      const MIN_GAP = 0.01

      // Phase 3: Collect snap targets — adjacent segment boundaries + playhead.
      const snapThresholdT = SNAP_THRESHOLD_PX / pps
      const snapTargets: number[] = [lastTimeRef.current]
      for (let i = 0; i < segments.length; i++) {
        if (i !== segIdx) {
          snapTargets.push(segments[i].start, segments[i].end)
        }
      }

      function snapNearest(t: number): number {
        const best = nearestSnap(t, snapTargets, snapThresholdT)
        snapTargetRef.current = best
        return best !== null ? best : t
      }

      if (dragRef.current.edge === 'body') {
        const segDur = dragRef.current.origEnd - dragRef.current.origStart
        let newStart = dragRef.current.origStart + dt
        newStart = Math.max(0, Math.min(newStart, duration - segDur))
        if (segIdx > 0) newStart = Math.max(newStart, segments[segIdx - 1].end + MIN_GAP)
        if (segIdx < segments.length - 1) {
          newStart = Math.min(newStart, segments[segIdx + 1].start - segDur - MIN_GAP)
        }
        newStart = snapNearest(newStart)
        newStart = Math.max(0, Math.min(newStart, duration - segDur))
        onSegmentEdge?.(dragRef.current.segId, 'body', { start: newStart, end: newStart + segDur })
      } else {
        const isStart = dragRef.current.edge === 'start'
        const origVal = isStart ? dragRef.current.origStart : dragRef.current.origEnd
        let newVal = Math.max(0, Math.min(duration, origVal + dt))

        if (isStart) {
          newVal = Math.min(newVal, seg.end - MIN_GAP)
          if (segIdx > 0) newVal = Math.max(newVal, segments[segIdx - 1].end + MIN_GAP)
        } else {
          newVal = Math.max(newVal, seg.start + MIN_GAP)
          if (segIdx < segments.length - 1) {
            newVal = Math.min(newVal, segments[segIdx + 1].start - MIN_GAP)
          }
        }
        newVal = snapNearest(newVal)
        onSegmentEdge?.(dragRef.current.segId, dragRef.current.edge, newVal)
      }

      draw(lastTimeRef.current)
      e.preventDefault()
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [segments, duration, onSegmentEdge, onWordEdge, onHover, draw, selectedSegId]
  )

  const onMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const segDrag = dragRef.current
      const wasDragging = !!segDrag || !!wordDragRef.current
      dragRef.current = null
      wordDragRef.current = null
      snapTargetRef.current = null
      const canvas = canvasRef.current
      if (canvas) canvas.style.cursor = 'pointer'
      if (!wasDragging) {
        onSeek?.(timeAtX(e.clientX))
        onSelectSegment?.(null)
      } else if (segDrag && segDrag.edge === 'body' && !movedRef.current) {
        // A body press that never moved is a click: toggle selection.
        onSelectSegment?.(segDrag.segId === selectedSegId ? null : segDrag.segId)
      }
      draw(lastTimeRef.current)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [onSeek, duration, draw, onSelectSegment, selectedSegId]
  )

  const onMouseLeave = useCallback(() => {
    const canvas = canvasRef.current
    if (canvas) canvas.style.cursor = 'pointer'
    onHover?.(null, 0, 0, 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onHover])

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
        const rect = canvas.getBoundingClientRect()
        const { zoom, scrollT } = computeZoomAtPointer(
          e.deltaY,
          e.clientX,
          rect.left,
          rect.width,
          duration,
          st.zoom,
          st.scrollT
        )
        st.zoom = zoom
        st.scrollT = scrollT
        onZoomChange?.(st.zoom, st.scrollT)
      } else {
        st.scrollT = computeWheelScroll(e.deltaY, duration, st.zoom, st.scrollT)
        onScrollChange?.(st.scrollT, st.zoom)
      }
      // Redraw immediately — mutating refs alone won't trigger a re-render.
      draw(lastTimeRef.current)
    }
    canvas.addEventListener('wheel', handler, { passive: false })
    return () => canvas.removeEventListener('wheel', handler)
  }, [canvasRef, duration, draw, onZoomChange, onScrollChange])

  const setZoom = useCallback(
    (zoom: number) => {
      const clamped = clampZoom(zoom)
      stateRef.current.zoom = clamped
      onZoomChange?.(clamped, stateRef.current.scrollT)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [onZoomChange]
  )

  const setScroll = useCallback((scrollT: number) => {
    stateRef.current.scrollT = Math.max(0, scrollT)
  }, [])

  return { draw, onMouseDown, onMouseMove, onMouseUp, onMouseLeave, setZoom, setScroll }
}

// ── Helpers ────────────────────────────────────────────────────────

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
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
}
