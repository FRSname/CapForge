/**
 * The Thumbnail card's three actions that leave the panel: grab a frame at the
 * playhead, delete a frame, and save the cover out through Electron.
 *
 * Grab and delete bump the record's `rev` themselves, so the pending drafts
 * are **flushed first** — otherwise the user's own unsaved cover or idea edit
 * would come back as a 409 against the revision the grab created. The new
 * record is not installed from the response: both routes fire
 * `record_updated`, and `usePublishRecord`'s existing subscription re-reads
 * it (the soft lock included).
 *
 * Kept out of `usePublishRecord`, which is at its size ceiling. Every failure
 * is toasted.
 */

import { useCallback, useState } from 'react'
import type { PublishController } from './usePublishRecord'
import type { ToastType } from './useToast'
import { deleteFrame, grabFrames } from '../lib/framesApi'
import { NO_COVER_MESSAGE, coverSavedMessage, frameFailureMessage } from '../lib/publishThumbnail'

export interface ThumbnailFramesInput {
  publish: PublishController
  /** Where the player is now — the grab's time. */
  getPlayhead: () => number
  toast: (message: string, type?: ToastType) => void
}

export interface ThumbnailFrames {
  /** A grab or delete is in flight. */
  busy: boolean
  grabAtPlayhead: () => void
  removeFrame: (name: string) => void
  saveCover: () => void
}

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function useThumbnailFrames({
  publish,
  getPlayhead,
  toast,
}: ThumbnailFramesInput): ThumbnailFrames {
  const [busy, setBusy] = useState(false)
  const videoId = publish.record?.id ?? null
  const { flushDrafts } = publish

  /** Flush, then run the frames call; one toast per failure, never thrown. */
  const run = useCallback(
    async (failure: string, action: (id: string) => Promise<void>) => {
      if (!videoId) return
      setBusy(true)
      try {
        await flushDrafts()
        await action(videoId)
      } catch (err) {
        toast(`${failure}: ${reasonOf(err)}`, 'error')
      } finally {
        setBusy(false)
      }
    },
    [videoId, flushDrafts, toast]
  )

  const grabAtPlayhead = useCallback(() => {
    const at = Math.max(0, getPlayhead())
    void run('Could not grab a frame', async (id) => {
      const result = await grabFrames(id, [at])
      for (const failed of result.failed) toast(frameFailureMessage(failed), 'error')
    })
  }, [run, getPlayhead, toast])

  const removeFrame = useCallback(
    (name: string) => {
      void run('Could not delete the frame', async (id) => {
        await deleteFrame(id, name)
      })
    },
    [run]
  )

  const cover = publish.fields.thumbnail.cover
  const title = publish.fields.title
  const saveCover = useCallback(() => {
    if (!videoId || !cover) {
      toast(NO_COVER_MESSAGE, 'info')
      return
    }
    window.subforge
      .saveLibraryFrame(videoId, cover, title)
      .then((saved) => {
        if (saved) toast(coverSavedMessage(saved), 'success')
      })
      .catch((err: unknown) => toast(`Could not save the cover: ${reasonOf(err)}`, 'error'))
  }, [videoId, cover, title, toast])

  return { busy, grabAtPlayhead, removeFrame, saveCover }
}
