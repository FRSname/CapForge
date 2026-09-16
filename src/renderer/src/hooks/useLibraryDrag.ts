/**
 * Drag and drop between the library's cards, rows, folders and path crumbs
 * (docs/plans/library-finder.md §4.3). Every decision is `lib/libraryDrag.ts`;
 * this hook only binds it to React's drag events.
 *
 * A source writes its payload into the `DataTransfer` **and** remembers it,
 * because while a drag is in flight the browser lets `dragover` read only the
 * types, not the data — and a target has to know *what* is dragged to decide
 * whether to show its affordance. The drop itself re-reads the payload from
 * the `DataTransfer` and validates it there (the boundary), then checks again.
 *
 * A target that refuses the drag does not call `preventDefault`, so the
 * browser shows no drop cursor, and it lets the event bubble: a file dragged
 * from the OS still reaches the screen's import drop. The drag image is the
 * browser's default ghost of the dragged card, row or folder.
 */

import { useRef, useState } from 'react'
import type { DragEvent } from 'react'
import type { TreeItem } from '../lib/collectionTree'
import type { DragPayload } from '../lib/libraryDrag'
import {
  COLLECTION_DRAG_TYPE,
  VIDEOS_DRAG_TYPE,
  canDrop,
  dragKind,
  encodeVideoIds,
  readDragPayload,
} from '../lib/libraryDrag'
import type { LibraryVideo } from '../lib/libraryTypes'

export interface DragSourceProps {
  draggable: boolean
  onDragStart?: (e: DragEvent) => void
  onDragEnd?: () => void
}

export interface DropTargetProps {
  onDragEnter?: (e: DragEvent) => void
  onDragOver?: (e: DragEvent) => void
  onDragLeave?: (e: DragEvent) => void
  onDrop?: (e: DragEvent) => void
}

export interface DropTargetBinding {
  props: DropTargetProps
  /** A drag this target accepts is over it: draw the affordance. */
  over: boolean
}

export interface LibraryDrag {
  /**
   * `ids`: what the drag carries, asked for when it starts (the selected videos
   * when this one is among them); absent, the video alone.
   */
  videoSource: (video: LibraryVideo, ids?: () => readonly string[]) => DragSourceProps
  folderSource: (folderId: string) => DragSourceProps
  /** `targetId`: a folder, or null for the Library root. `key` tells same-id targets apart. */
  target: (targetId: string | null, key: string) => DropTargetBinding
}

/** Nothing drags and nothing accepts — for static markup and places that take no part. */
export const INERT_LIBRARY_DRAG: LibraryDrag = {
  videoSource: () => ({ draggable: false }),
  folderSource: () => ({ draggable: false }),
  target: () => ({ props: {}, over: false }),
}

export interface LibraryDragInput {
  collections: readonly TreeItem[]
  videos: readonly LibraryVideo[]
  onMoveVideos: (videos: LibraryVideo[], collectionId: string | null) => void
  onMoveFolder: (folderId: string, parentId: string | null) => void
}

/** The drop is left, not just a child of the target entered. */
function leftTarget(e: DragEvent): boolean {
  const next = e.relatedTarget
  return !(next instanceof Node && e.currentTarget.contains(next))
}

export function useLibraryDrag(input: LibraryDragInput): LibraryDrag {
  const payloadRef = useRef<DragPayload | null>(null)
  const [overKey, setOverKey] = useState<string | null>(null)
  const { collections, videos } = input

  function start(e: DragEvent, payload: DragPayload) {
    payloadRef.current = payload
    e.dataTransfer.effectAllowed = 'move'
    if (payload.kind === 'videos') {
      e.dataTransfer.setData(VIDEOS_DRAG_TYPE, encodeVideoIds(payload.ids))
    } else {
      e.dataTransfer.setData(COLLECTION_DRAG_TYPE, payload.id)
    }
  }

  function end() {
    payloadRef.current = null
    setOverKey(null)
  }

  function hover(e: DragEvent, targetId: string | null, key: string) {
    const kind = dragKind(e.dataTransfer.types)
    if (!canDrop(kind, payloadRef.current, targetId, collections, videos)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (overKey !== key) setOverKey(key)
  }

  function drop(e: DragEvent, targetId: string | null) {
    const kind = dragKind(e.dataTransfer.types)
    const payload = readDragPayload(kind, (type) => e.dataTransfer.getData(type))
    if (!canDrop(kind, payload, targetId, collections, videos) || payload === null) return
    e.preventDefault()
    e.stopPropagation()
    end()
    if (payload.kind === 'collection') {
      input.onMoveFolder(payload.id, targetId)
      return
    }
    const ids = new Set(payload.ids)
    input.onMoveVideos(
      videos.filter((v) => ids.has(v.id) && v.collection_id !== targetId),
      targetId
    )
  }

  return {
    videoSource: (video, ids) => ({
      draggable: true,
      onDragStart: (e) => start(e, { kind: 'videos', ids: ids ? ids() : [video.id] }),
      onDragEnd: end,
    }),
    folderSource: (folderId) => ({
      draggable: true,
      onDragStart: (e) => {
        // A folder row sits inside the sidebar tree: this drag is the folder's only.
        e.stopPropagation()
        start(e, { kind: 'collection', id: folderId })
      },
      onDragEnd: end,
    }),
    target: (targetId, key) => ({
      over: overKey === key,
      props: {
        onDragEnter: (e) => hover(e, targetId, key),
        onDragOver: (e) => hover(e, targetId, key),
        onDragLeave: (e) => {
          if (overKey === key && leftTarget(e)) setOverKey(null)
        },
        onDrop: (e) => drop(e, targetId),
      },
    }),
  }
}
