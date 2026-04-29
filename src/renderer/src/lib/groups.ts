/**
 * Subtitle grouping engine — turns the backend's sentence-level segments into
 * display groups of N words each. Ports buildStudioGroups() from
 * renderer/js/app.js:2390-2424.
 *
 * Source `segments` remain the edit target (one per sentence); the returned
 * `groups` are what gets painted on the preview canvas and timeline.
 */

import type { Segment, Word } from '../types/app'

/**
 * Re-chunk each segment's words into groups of `wordsPerGroup` words.
 *
 * - Preserves per-word `overrides` so user word-styles survive re-grouping.
 * - Segments that have no word-level timing (rare) become a single group
 *   carrying their whole text.
 * - Group `start`/`end` are the outer bounds of its first/last word, matching
 *   vanilla behaviour.
 */
export function buildStudioGroups(segments: Segment[], wordsPerGroup: number): Segment[] {
  const wpg = Math.max(1, Math.floor(wordsPerGroup) || 3)
  const groups: Segment[] = []

  for (const seg of segments) {
    // Degenerate case: segment without word-level timing.
    if (!seg.words || seg.words.length === 0) {
      groups.push({
        id:      `${seg.id}:0`,
        start:   seg.start,
        end:     seg.end,
        text:    seg.text,
        words:   [{ word: seg.text, start: seg.start, end: seg.end }],
        speaker: seg.speaker,
      })
      continue
    }

    for (let i = 0; i < seg.words.length; i += wpg) {
      const chunk = seg.words.slice(i, i + wpg)
      if (chunk.length === 0) continue
      const normalized: Word[] = chunk.map(w => ({
        ...w,
        word: w.word.trim(),
      }))
      groups.push({
        // Stable-ish id so React keys don't thrash on wpg changes.
        id:      `${seg.id}:${i}`,
        start:   normalized[0].start,
        end:     normalized[normalized.length - 1].end,
        text:    normalized.map(w => w.word).join(' '),
        words:   normalized,
        speaker: seg.speaker,
      })
    }
  }

  return groups
}

// ── Group-editor primitives ──────────────────────────────────────
// These operate on an already-built groups array; they do NOT mutate. Callers
// pass the result back up to ResultsScreen.setSegments (or a groups store).

/** Merge the group at `index` with the next group. No-op if out of range. */
export function mergeGroups(groups: Segment[], index: number): Segment[] {
  if (index < 0 || index >= groups.length - 1) return groups
  const a = groups[index]
  const b = groups[index + 1]
  const combined: Segment = {
    id:      `${a.id}+${b.id}`,
    start:   a.start,
    end:     b.end,
    text:    `${a.text} ${b.text}`.trim(),
    words:   [...a.words, ...b.words],
    speaker: a.speaker ?? b.speaker,
  }
  return [...groups.slice(0, index), combined, ...groups.slice(index + 2)]
}

/**
 * Split group at `index` after the Nth word (1-based). Words `[0..n-1]` stay
 * in the left group; `[n..]` become a new right group. No-op if n is at the
 * edges (nothing to split off).
 */
export function splitGroup(groups: Segment[], index: number, n: number): Segment[] {
  const g = groups[index]
  if (!g) return groups
  if (n <= 0 || n >= g.words.length) return groups
  const left:  Word[] = g.words.slice(0, n)
  const right: Word[] = g.words.slice(n)
  const a: Segment = {
    id:      `${g.id}#L`,
    start:   left[0].start,
    end:     left[left.length - 1].end,
    text:    left.map(w => w.word).join(' '),
    words:   left,
    speaker: g.speaker,
  }
  const b: Segment = {
    id:      `${g.id}#R`,
    start:   right[0].start,
    end:     right[right.length - 1].end,
    text:    right.map(w => w.word).join(' '),
    words:   right,
    speaker: g.speaker,
  }
  return [...groups.slice(0, index), a, b, ...groups.slice(index + 1)]
}

/**
 * Move a word from one group to another. `destGroupIndex` may be any other
 * group, not just an adjacent one. When moving down, the word is prepended to
 * the destination; when moving up, it is appended. If the source group becomes
 * empty as a result, it is dropped from the array entirely.
 */
export function moveWord(
  groups:         Segment[],
  groupIndex:     number,
  wordIndex:      number,
  destGroupIndex: number,
): Segment[] {
  if (groupIndex === destGroupIndex) return groups
  const src = groups[groupIndex]
  const dst = groups[destGroupIndex]
  if (!src || !dst) return groups
  const word = src.words[wordIndex]
  if (!word) return groups

  const movingDown = destGroupIndex > groupIndex
  const newDstWords = movingDown ? [word, ...dst.words] : [...dst.words, word]
  const newSrcWords = src.words.filter((_, i) => i !== wordIndex)

  // Source becomes empty — drop it and write the merged dst at its old slot.
  if (newSrcWords.length === 0) {
    const merged = finalizeBounds({ ...dst, words: newDstWords })
    const next = [...groups]
    next[destGroupIndex] = merged
    next.splice(groupIndex, 1)
    return next
  }

  const newSrc = finalizeBounds({ ...src, words: newSrcWords })
  const newDst = finalizeBounds({ ...dst, words: newDstWords })
  const next = [...groups]
  next[groupIndex] = newSrc
  next[destGroupIndex] = newDst
  return next
}

function finalizeBounds(g: Segment): Segment {
  if (g.words.length === 0) return g
  return {
    ...g,
    start: g.words[0].start,
    end:   g.words[g.words.length - 1].end,
    text:  g.words.map(w => w.word).join(' '),
  }
}
