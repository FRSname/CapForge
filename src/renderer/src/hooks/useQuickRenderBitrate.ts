/**
 * The quick-render MP4 quality: read once from app-state, written back on
 * every change (`lib/quickRender.ts`). A failed read or write is toasted and
 * the choice still applies for this session.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  DEFAULT_QUICK_RENDER_BITRATE,
  QUICK_RENDER_BITRATE_KEY,
  parseQuickRenderBitrate,
} from '../lib/quickRender'
import { useToast } from './useToast'

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function useQuickRenderBitrate(): [string, (bitrate: string) => void] {
  const { toast } = useToast()
  const [bitrate, setBitrateState] = useState(DEFAULT_QUICK_RENDER_BITRATE)

  useEffect(() => {
    let cancelled = false
    window.subforge
      .getState<unknown>(QUICK_RENDER_BITRATE_KEY, DEFAULT_QUICK_RENDER_BITRATE)
      .then((stored) => {
        if (!cancelled) setBitrateState(parseQuickRenderBitrate(stored))
      })
      .catch((err) => toast(`Could not read the render quality: ${reasonOf(err)}`, 'error'))
    return () => {
      cancelled = true
    }
  }, [toast])

  const setBitrate = useCallback(
    (next: string) => {
      const parsed = parseQuickRenderBitrate(next)
      setBitrateState(parsed)
      window.subforge
        .setState(QUICK_RENDER_BITRATE_KEY, parsed)
        .catch((err) => toast(`Could not remember the render quality: ${reasonOf(err)}`, 'error'))
    },
    [toast]
  )

  return [bitrate, setBitrate]
}
