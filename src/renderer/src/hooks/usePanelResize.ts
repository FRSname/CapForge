/**
 * A column width plus the mousedown handler for its drag handle. The width is
 * per session, like the editor's always was — it is not remembered.
 */

import { useCallback, useState } from 'react'
import type React from 'react'
import { resizedWidth } from '../lib/panelResize'
import type { PanelSide, PanelWidthBounds } from '../lib/panelResize'

export function usePanelResize(bounds: PanelWidthBounds, side: PanelSide) {
  const [width, setWidth] = useState(bounds.initial)

  const onHandleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const startX = e.clientX
      const startWidth = width
      const onMouseMove = (ev: MouseEvent) => {
        setWidth(resizedWidth({ startWidth, startX, clientX: ev.clientX, bounds, side }))
      }
      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
      }
      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    [width, bounds, side]
  )

  return { width, onHandleMouseDown }
}
