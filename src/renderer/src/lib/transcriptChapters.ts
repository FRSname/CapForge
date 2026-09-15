/**
 * The Transcript tab's two lookups: where each chapter's marker is drawn, and
 * which row the playhead is in.
 *
 * Chapters are seconds (`Chapter.start_s`), never word ids, so a marker is
 * placed by time: above the first segment whose `end > start_s` — the segment
 * the chapter starts inside, or the next one when it starts in a silent gap.
 *
 * Pure module: no React, no `window`, no I/O.
 */

import type { Segment } from '../types/app'
import type { Chapter } from './publishTypes'
import { sortChapters } from './publishChapters'

/** No active row: the playhead is before, between or after the segments. */
export const NO_ACTIVE_SEGMENT = -1

export interface PlacedChapters {
  /** Segment index → the chapters drawn above that row, in time order. Sparse. */
  bySegment: ReadonlyMap<number, readonly Chapter[]>
  /** Chapters starting at or after the last segment's end, listed at the end. */
  trailing: readonly Chapter[]
}

/**
 * Place every chapter above its segment. Chapters are sorted first (a copy;
 * the input is never touched). Segments are read in transcript order.
 *
 * Linear: "first index whose end > t" can only move forward as `t` grows (any
 * segment ending after a later time also ends after an earlier one), so one
 * pointer walks the segments once across all the sorted chapters.
 */
export function placeChapters(
  segments: readonly Segment[],
  chapters: readonly Chapter[]
): PlacedChapters {
  const bySegment = new Map<number, Chapter[]>()
  const trailing: Chapter[] = []
  let cursor = 0
  for (const chapter of sortChapters(chapters)) {
    while (cursor < segments.length && !(segments[cursor].end > chapter.start_s)) cursor++
    if (cursor >= segments.length) {
      trailing.push(chapter)
      continue
    }
    bySegment.set(cursor, [...(bySegment.get(cursor) ?? []), chapter])
  }
  return { bySegment, trailing }
}

/**
 * The segment containing `t` (`start <= t < end`), by binary search over the
 * segment starts — the Transcript tab asks on every playback tick, so a
 * 1000-row transcript must not be scanned each time. `NO_ACTIVE_SEGMENT` when
 * the playhead is outside every segment.
 */
export function activeSegmentIndex(segments: readonly Segment[], t: number): number {
  if (!Number.isFinite(t)) return NO_ACTIVE_SEGMENT
  let lo = 0
  let hi = segments.length - 1
  let last = NO_ACTIVE_SEGMENT
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (segments[mid].start <= t) {
      last = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return last !== NO_ACTIVE_SEGMENT && t < segments[last].end ? last : NO_ACTIVE_SEGMENT
}
