/**
 * The state behind one record's `…` menu (`LibraryCardMenu`), shared by the
 * grid card and the list row so both menus behave identically: the inline
 * Delete confirm, "Locate…" reopening on its "link anyway?" confirm, and the
 * "Move to collection…" sub-list.
 *
 * Returns everything `LibraryCardMenu` takes except `video` and `collections`,
 * plus whether the menu is open and the `…` button's toggle.
 */

import { useState } from 'react'
import type { LibraryCardMenuProps } from '../components/library/LibraryCard'
import type { CreateCollectionResult } from '../lib/collectionCreate'
import type { LocateOutcome } from '../lib/libraryImport'
import type { LibraryVideo } from '../lib/libraryTypes'

/** The record actions a card or row hands its menu. */
export interface RecordMenuActions {
  onRemove: (video: LibraryVideo) => void
  onDelete: (video: LibraryVideo) => void
  onLocate: (video: LibraryVideo) => Promise<LocateOutcome>
  onForceLocate: (video: LibraryVideo, path: string) => void
  onMoveToCollection: (video: LibraryVideo, collectionId: string | null) => void
  onCreateCollection: (name: string) => Promise<CreateCollectionResult>
}

export type RecordMenuState = Omit<LibraryCardMenuProps, 'video' | 'collections'>

export interface RecordMenu {
  open: boolean
  /** The `…` button: open, or close (and reset) when open. */
  toggle: () => void
  menu: RecordMenuState
}

export function useRecordMenu(video: LibraryVideo, actions: RecordMenuActions): RecordMenu {
  const [open, setOpen] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [pendingLinkPath, setPendingLinkPath] = useState<string | null>(null)
  const [moving, setMoving] = useState(false)

  function close() {
    setOpen(false)
    setConfirmingDelete(false)
    setPendingLinkPath(null)
    setMoving(false)
  }

  function locate() {
    close()
    void actions.onLocate(video).then((outcome) => {
      if (outcome.kind !== 'confirm') return
      // Reopen on the confirm: the picker took the focus away from the card.
      setPendingLinkPath(outcome.path)
      setOpen(true)
    })
  }

  function link() {
    const path = pendingLinkPath
    close()
    if (path) actions.onForceLocate(video, path)
  }

  function pickCollection(collectionId: string | null) {
    close()
    if (collectionId !== video.collection_id) actions.onMoveToCollection(video, collectionId)
  }

  return {
    open,
    toggle: () => (open ? close() : setOpen(true)),
    menu: {
      confirmingDelete,
      pendingLinkPath,
      moving,
      onRemove: () => {
        close()
        actions.onRemove(video)
      },
      onAskDelete: () => setConfirmingDelete(true),
      onDelete: () => {
        close()
        actions.onDelete(video)
      },
      onCancelDelete: () => setConfirmingDelete(false),
      onLocate: locate,
      onLink: link,
      onCancelLink: close,
      onAskMove: () => setMoving(true),
      onBackFromMove: () => setMoving(false),
      onPickCollection: pickCollection,
      onCreateCollection: actions.onCreateCollection,
    },
  }
}
