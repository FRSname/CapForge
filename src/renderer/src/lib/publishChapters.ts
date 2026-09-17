/**
 * Editing a chapter list — the four transforms the Chapters card performs,
 * kept pure (and therefore tested) rather than inline in the hook.
 *
 * Nothing here validates: whether a list is legal (first at `00:00`, at least
 * three, ascending, at least 10 s apart, inside the duration) is Python's
 * answer, rendered under the card. These only *edit*.
 *
 * `chapterLines` is the one non-edit: the `MM:SS Title` block the Chapters
 * card copies, the twin of `backend/library/package.py`'s `chapter_lines`
 * (same rows, same timestamp formula, untitled chapters left out), so what is
 * copied from the card is what the upload package pastes.
 *
 * Pure module: no React, no `window`, no I/O.
 */

import type { Chapter, Moment } from './publishTypes'
import type { Word } from '../types/app'
import { chapterSuggestions, formatTimestamp, snapToWordStart } from './youtubeRules'

/** The chapter block as YouTube reads it: one `MM:SS Title` per line, untitled rows skipped. */
export function chapterLines(chapters: readonly Chapter[]): string {
  return chapters
    .filter((c) => c.title.trim() !== '')
    .map((c) => `${formatTimestamp(c.start_s)} ${c.title.trim()}`)
    .join('\n')
}

/** Chapters are always held in time order — YouTube reads them that way. */
export function sortChapters(chapters: readonly Chapter[]): Chapter[] {
  return [...chapters].sort((a, b) => a.start_s - b.start_s)
}

/**
 * A new, untitled chapter at `seconds`, snapped back to the nearest word start
 * so it never lands mid-word. The playhead is where the user is looking; the
 * word boundary is where a chapter belongs.
 */
export function insertChapter(
  chapters: readonly Chapter[],
  seconds: number,
  words: readonly Word[]
): Chapter[] {
  return sortChapters([...chapters, { start_s: snapToWordStart(seconds, words), title: '' }])
}

export function removeChapter(chapters: readonly Chapter[], index: number): Chapter[] {
  return chapters.filter((_, i) => i !== index)
}

export function renameChapter(
  chapters: readonly Chapter[],
  index: number,
  title: string
): Chapter[] {
  return chapters.map((chapter, i) => (i === index ? { ...chapter, title } : chapter))
}

/**
 * The list with the candidates the transcript's pauses and speaker changes
 * suggest folded in. Returns `null` when nothing could be added, so the caller
 * can say so instead of silently writing the same list back.
 */
export function withSuggestions(
  chapters: readonly Chapter[],
  moments: readonly Moment[]
): Chapter[] | null {
  const suggested = chapterSuggestions(moments, chapters)
  return suggested.length === 0 ? null : sortChapters([...chapters, ...suggested])
}
