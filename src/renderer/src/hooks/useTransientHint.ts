/**
 * A discovery hint that shows itself the first time the pointer reaches its
 * surface and never again in this session (`lib/transientHint.ts`).
 *
 * The memory is module-level on purpose: it is per *session*, not per mount, so
 * remounting the player — which happens on every track switch — must not bring
 * the hints back. Nothing is persisted, so a relaunch shows them once more.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { HINT_VISIBLE_MS, firstReveal } from '../lib/transientHint'

const seen = new Set<string>()

export interface TransientHint {
  /** Whether the hint should be rendered right now. */
  visible: boolean
  /** Reveal it — a no-op after the first time this session. */
  reveal: () => void
}

export function useTransientHint(id: string): TransientHint {
  const [visible, setVisible] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timer.current != null) clearTimeout(timer.current)
    }
  }, [])

  const reveal = useCallback(() => {
    if (!firstReveal(seen, id)) return
    setVisible(true)
    timer.current = setTimeout(() => {
      timer.current = null
      setVisible(false)
    }, HINT_VISIBLE_MS)
  }, [id])

  return { visible, reveal }
}
