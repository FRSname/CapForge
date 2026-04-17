/**
 * Video preview zoom & pan — ports applyVideoZoom/zoomAt/clampVzPan from app.js.
 *
 * Returns:
 * - transform string for the inner container's CSS `transform`
 * - event handlers to wire onto the preview wrapper
 * - zoom in/out/reset callbacks for toolbar buttons
 * - current zoom level for the label
 */

import { useCallback, useRef, useState } from 'react'

const VZ_MIN = 1
const VZ_MAX = 6

interface VideoZoomState {
  scale: number
  tx: number
  ty: number
}

export function useVideoZoom() {
  const [state, setState] = useState<VideoZoomState>({ scale: 1, tx: 0, ty: 0 })
  const wrapRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ active: boolean; lastX: number; lastY: number }>({
    active: false, lastX: 0, lastY: 0,
  })

  const clampPan = useCallback((s: VideoZoomState): VideoZoomState => {
    const el = wrapRef.current
    if (!el) return s
    const w = el.clientWidth
    const h = el.clientHeight
    const maxX = (s.scale - 1) * w
    const maxY = (s.scale - 1) * h
    return {
      ...s,
      tx: Math.min(0, Math.max(-maxX, s.tx)),
      ty: Math.min(0, Math.max(-maxY, s.ty)),
    }
  }, [])

  const zoomAt = useCallback((cx: number, cy: number, factor: number) => {
    setState(prev => {
      const newScale = Math.min(VZ_MAX, Math.max(VZ_MIN, prev.scale * factor))
      if (Math.abs(newScale - prev.scale) < 1e-4) return prev
      // Keep point under cursor stationary
      const lx = (cx - prev.tx) / prev.scale
      const ly = (cy - prev.ty) / prev.scale
      const next: VideoZoomState = {
        scale: newScale,
        tx: cx - lx * newScale,
        ty: cy - ly * newScale,
      }
      return clampPan(next)
    })
  }, [clampPan])

  // ── Ctrl+Wheel zoom ──────────────────────────────────────────
  const onWheel = useCallback((e: React.WheelEvent) => {
    if (!e.ctrlKey) return
    e.preventDefault()
    e.stopPropagation()
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
    zoomAt(cx, cy, factor)
  }, [zoomAt])

  // ── Drag to pan ──────────────────────────────────────────────
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    // Only start drag when zoomed in
    if (state.scale <= 1 || e.button !== 0) return
    dragRef.current = { active: true, lastX: e.clientX, lastY: e.clientY }
    e.preventDefault()
  }, [state.scale])

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const d = dragRef.current
    if (!d.active) return
    const dx = e.clientX - d.lastX
    const dy = e.clientY - d.lastY
    d.lastX = e.clientX
    d.lastY = e.clientY
    setState(prev => clampPan({ ...prev, tx: prev.tx + dx, ty: prev.ty + dy }))
  }, [clampPan])

  const onMouseUp = useCallback(() => {
    dragRef.current.active = false
  }, [])

  // ── Double-click: toggle 2x / reset ──────────────────────────
  const onDoubleClick = useCallback((e: React.MouseEvent) => {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top
    if (state.scale > 1) {
      // Reset to 1x
      setState({ scale: 1, tx: 0, ty: 0 })
    } else {
      zoomAt(cx, cy, 2)
    }
  }, [state.scale, zoomAt])

  // ── Toolbar callbacks ────────────────────────────────────────
  const zoomIn = useCallback(() => {
    const el = wrapRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    zoomAt(r.width / 2, r.height / 2, 1.25)
  }, [zoomAt])

  const zoomOut = useCallback(() => {
    const el = wrapRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    zoomAt(r.width / 2, r.height / 2, 1 / 1.25)
  }, [zoomAt])

  const zoomReset = useCallback(() => {
    setState({ scale: 1, tx: 0, ty: 0 })
  }, [])

  const transform = `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`
  const isZoomed = state.scale > 1

  return {
    wrapRef,
    transform,
    zoom: state.scale,
    isZoomed,
    zoomIn,
    zoomOut,
    zoomReset,
    handlers: { onWheel, onMouseDown, onMouseMove, onMouseUp, onDoubleClick },
  }
}
