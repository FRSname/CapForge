/**
 * A column width plus the mousedown handler for its drag handle.
 *
 * The width is remembered across sessions under an `app-state` key
 * (`PANEL_WIDTH_KEYS`, electron/app-state.js): read once on mount through
 * the same `state:get` / `state:set` bridge the library view uses, written
 * once per drag when the mouse goes up. Until the read lands the default
 * shows, and a drag made before it lands wins over the stored value. A
 * failed read or write goes to `notify`; the column keeps resizing either way.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type React from 'react'
import { parseStoredPanelWidth, resizedWidth } from '../lib/panelResize'
import type { PanelSide, PanelWidthBounds } from '../lib/panelResize'

export interface PanelResizeOptions {
  bounds: PanelWidthBounds
  side: PanelSide
  /** One of `PANEL_WIDTH_KEYS`. */
  storageKey: string
  notify: (message: string) => void
}

export function panelWidthReadFailedMessage(reason: string): string {
  return `Could not read the remembered panel width: ${reason}`
}

export function panelWidthWriteFailedMessage(reason: string): string {
  return `Could not remember the panel width: ${reason}`
}

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** `window` is absent under vitest's node env. */
function appState(): Window['subforge'] | null {
  return typeof window === 'undefined' ? null : (window.subforge ?? null)
}

export function usePanelResize({ bounds, side, storageKey, notify }: PanelResizeOptions) {
  const [width, setWidth] = useState(bounds.initial)
  const widthRef = useRef(width)
  const touchedRef = useRef(false)
  const notifyRef = useRef(notify)
  useEffect(() => {
    notifyRef.current = notify
  })

  useEffect(() => {
    const bridge = appState()
    if (!bridge) return
    let live = true
    bridge.getState<unknown>(storageKey, null).then(
      (stored) => {
        if (!live || touchedRef.current) return
        const next = parseStoredPanelWidth(stored, bounds)
        widthRef.current = next
        setWidth(next)
      },
      (err: unknown) => {
        if (live) notifyRef.current(panelWidthReadFailedMessage(reasonOf(err)))
      }
    )
    return () => {
      live = false
    }
  }, [storageKey, bounds])

  const onHandleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      touchedRef.current = true
      const startX = e.clientX
      const startWidth = widthRef.current
      const onMouseMove = (ev: MouseEvent) => {
        const next = resizedWidth({ startWidth, startX, clientX: ev.clientX, bounds, side })
        widthRef.current = next
        setWidth(next)
      }
      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
        const bridge = appState()
        if (!bridge) return
        bridge.setState(storageKey, widthRef.current).catch((err: unknown) => {
          notifyRef.current(panelWidthWriteFailedMessage(reasonOf(err)))
        })
      }
      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    [bounds, side, storageKey]
  )

  return { width, onHandleMouseDown }
}
