/**
 * Which video's name is an input, and the pause between a click on a selected
 * item's name and the rename it starts (`RENAME_CLICK_DELAY_MS`): a
 * double-click, a drag, a right-click or any other selection change inside the
 * pause cancels it. One timer for the whole screen, cleared on unmount.
 *
 * A rename belongs to the location it started in (`scopeKey`): navigating away
 * ends it, so coming back never reopens a stale input.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ItemKey } from '../lib/librarySelection'
import { RENAME_CLICK_DELAY_MS } from '../lib/librarySelection'

export interface RenameClick {
  renamingVideoId: string | null
  startVideo: (videoId: string) => void
  stop: () => void
  /** Run `start` for `key` after the pause unless `cancel` comes first. */
  schedule: (key: ItemKey, start: () => void) => void
  cancel: () => void
  /** A click on another item cancels; the click on the pending item's own name does not. */
  cancelOther: (key: ItemKey) => void
}

export function useRenameClick(scopeKey: string): RenameClick {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingKey = useRef<ItemKey | null>(null)
  const [renaming, setRenaming] = useState<{ videoId: string; scopeKey: string } | null>(null)

  const cancel = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    pendingKey.current = null
  }, [])

  const schedule = useCallback(
    (key: ItemKey, start: () => void) => {
      cancel()
      pendingKey.current = key
      timer.current = setTimeout(() => {
        timer.current = null
        pendingKey.current = null
        start()
      }, RENAME_CLICK_DELAY_MS)
    },
    [cancel]
  )
  const cancelOther = useCallback(
    (key: ItemKey) => {
      if (pendingKey.current !== key) cancel()
    },
    [cancel]
  )

  useEffect(() => cancel, [cancel])

  const startVideo = useCallback(
    (videoId: string) => {
      cancel()
      setRenaming({ videoId, scopeKey })
    },
    [cancel, scopeKey]
  )
  const stop = useCallback(() => setRenaming(null), [])
  const renamingVideoId =
    renaming !== null && renaming.scopeKey === scopeKey ? renaming.videoId : null

  return { renamingVideoId, startVideo, stop, schedule, cancel, cancelOther }
}
