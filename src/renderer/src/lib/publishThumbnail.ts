/**
 * Editing the dossier's `thumbnail` block — the Thumbnail card's transforms,
 * and the composition every thumbnail write goes through.
 *
 * **Candidates are files.** Only `POST/DELETE /api/library/{id}/frames` may
 * change `thumbnail.candidates`; a `PATCH` whose list differs from the stored
 * one is refused (`422 candidates_managed`). So a draft's own `candidates` is
 * never trusted on the wire: `composeThumbnailPatch` takes the list from the
 * latest record at send time, and `withManagedCandidates` applies that to any
 * patch about to leave the renderer (the debounced drafts, Revert).
 *
 * Nothing here validates — `cover` and "exactly one recommended" are Python's
 * rules. These only edit.
 *
 * Pure module: no React, no `window`, no I/O.
 */

import type { Thumbnail, ThumbnailIdea } from './publishMediaTypes'
import { THUMBNAIL_IDEA_TYPES, parseThumbnail } from './publishMediaTypes'
import { formatTimestamp } from './youtubeRules'

/** The one part of a record the composition reads. */
export interface LatestThumbnail {
  thumbnail: Thumbnail
}

/** The row fields a user edits in place; `recommended` goes through `toggleRecommended`. */
export type IdeaEdit = Partial<Omit<ThumbnailIdea, 'recommended'>>

export function setCover(thumbnail: Thumbnail, name: string | null): Thumbnail {
  return { ...thumbnail, cover: name }
}

/** Recommend the idea at `index` and no other — a radio, so re-picking keeps it. */
export function toggleRecommended(thumbnail: Thumbnail, index: number): Thumbnail {
  return {
    ...thumbnail,
    ideas: thumbnail.ideas.map((idea, i) => ({ ...idea, recommended: i === index })),
  }
}

/** An empty idea row. The first one is recommended, so the list keeps exactly one. */
export function addIdea(thumbnail: Thumbnail): Thumbnail {
  const idea: ThumbnailIdea = {
    label: '',
    type: THUMBNAIL_IDEA_TYPES[0],
    headline: '',
    recommended: thumbnail.ideas.length === 0,
  }
  return { ...thumbnail, ideas: [...thumbnail.ideas, idea] }
}

/** Remove a row; removing the recommended one hands the mark to the first remaining idea. */
export function removeIdea(thumbnail: Thumbnail, index: number): Thumbnail {
  const removed = thumbnail.ideas[index]
  const rest = thumbnail.ideas.filter((_, i) => i !== index)
  const next = { ...thumbnail, ideas: rest }
  return removed?.recommended && rest.length > 0 ? toggleRecommended(next, 0) : next
}

export function updateIdea(thumbnail: Thumbnail, index: number, edit: IdeaEdit): Thumbnail {
  return {
    ...thumbnail,
    ideas: thumbnail.ideas.map((idea, i) => (i === index ? { ...idea, ...edit } : idea)),
  }
}

/**
 * The thumbnail a write carries: the draft's authored half (`ideas`, `cover`)
 * over the **latest record's** `candidates`.
 *
 * A cover naming a frame that is no longer a candidate (deleted since the edit)
 * is sent as `null`: the file is gone, so it cannot be the cover, and sending
 * the stale name would refuse every other draft riding the same `PATCH`.
 */
export function composeThumbnailPatch(draft: Thumbnail, latest: LatestThumbnail): Thumbnail {
  const candidates = [...latest.thumbnail.candidates]
  const cover = draft.cover !== null && candidates.includes(draft.cover) ? draft.cover : null
  return { ideas: draft.ideas, candidates, cover }
}

/**
 * `patch` ready for the wire: its `thumbnail` (when it has one) composed over
 * the latest record; every other entry by identity. A patch with no thumbnail
 * is returned as the same object. The value may be a raw history `prev`
 * (Revert), so it is read through the boundary guard first.
 */
export function withManagedCandidates(
  patch: Record<string, unknown>,
  latest: LatestThumbnail
): Record<string, unknown> {
  if (!('thumbnail' in patch)) return patch
  return { ...patch, thumbnail: composeThumbnailPatch(parseThumbnail(patch.thumbnail), latest) }
}

/** The toast for one time the backend could not grab. */
export function frameFailureMessage(frame: { time_s: number; reason: string }): string {
  const at = `Could not grab the frame at ${formatTimestamp(frame.time_s)}`
  return frame.reason ? `${at}: ${frame.reason}` : at
}

export function coverSavedMessage(savedPath: string): string {
  return `Saved the cover to ${savedPath}`
}

export const NO_COVER_MESSAGE = 'Pick a frame as the cover first — click one in the strip.'

/** What a user can write — everything but `candidates`. What the soft lock compares. */
export function authoredThumbnail(thumbnail: Thumbnail): Omit<Thumbnail, 'candidates'> {
  return { ideas: thumbnail.ideas, cover: thumbnail.cover }
}
