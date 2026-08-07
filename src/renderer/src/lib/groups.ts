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
        id: `${seg.id}:0`,
        start: seg.start,
        end: seg.end,
        text: seg.text,
        words: [{ word: seg.text, start: seg.start, end: seg.end }],
        speaker: seg.speaker,
      })
      continue
    }

    for (let i = 0; i < seg.words.length; i += wpg) {
      const chunk = seg.words.slice(i, i + wpg)
      if (chunk.length === 0) continue
      const normalized: Word[] = chunk.map((w) => ({
        ...w,
        word: w.word.trim(),
      }))
      groups.push({
        // Stable-ish id so React keys don't thrash on wpg changes.
        id: `${seg.id}:${i}`,
        start: normalized[0].start,
        end: normalized[normalized.length - 1].end,
        text: normalized.map((w) => w.word).join(' '),
        words: normalized,
        speaker: seg.speaker,
      })
    }
  }

  return groups
}

/**
 * Stretch each group's end to the next group's start so captions persist
 * through silence gaps. Mirrors the backend's `fill_group_gaps()`
 * (`backend/exporters/video_render.py`).
 *
 * For every group except the last, if the next group's start is later than
 * this group's end (i.e. there is a gap), extend this group's end to meet
 * it. Never shrinks an end (overlapping/out-of-order groups are left as-is).
 * The last group is unchanged. Word timings and group membership are untouched —
 * only the group's outer `end` moves. Returns a new array of new objects; the
 * input is never mutated.
 *
 * Since `ce73fef` this is a one-shot **bake**, not a derived view: the Groups
 * toolbar's "Fill gaps" button writes the result straight into editable group
 * state (`handleFillGaps` in `ResultsScreen.tsx`) so the user can then shorten
 * individual ends to carve out deliberate gaps. The stretched `end` is therefore
 * a manual bound, and `reconcileGroups` preserves it for any group whose words
 * did not change.
 */
export function fillGroupGaps(groups: Segment[]): Segment[] {
  if (groups.length === 0) return []

  return groups.map((group, i) => {
    const next = groups[i + 1]
    if (next && next.start > group.end) {
      return { ...group, end: next.start }
    }
    return { ...group }
  })
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
    id: `${a.id}+${b.id}`,
    start: a.start,
    end: b.end,
    text: `${a.text} ${b.text}`.trim(),
    words: [...a.words, ...b.words],
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
  const left: Word[] = g.words.slice(0, n)
  const right: Word[] = g.words.slice(n)
  const a: Segment = {
    id: `${g.id}#L`,
    start: left[0].start,
    end: left[left.length - 1].end,
    text: left.map((w) => w.word).join(' '),
    words: left,
    speaker: g.speaker,
  }
  const b: Segment = {
    id: `${g.id}#R`,
    start: right[0].start,
    end: right[right.length - 1].end,
    text: right.map((w) => w.word).join(' '),
    words: right,
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
  groups: Segment[],
  groupIndex: number,
  wordIndex: number,
  destGroupIndex: number
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

/**
 * Move the group at `fromIndex` to appear before the group currently at
 * `toIndex`. Use `toIndex === groups.length` to append at the end.
 * No-op when the operation would leave the order unchanged.
 */
export function reorderGroup(groups: Segment[], fromIndex: number, toIndex: number): Segment[] {
  if (fromIndex < 0 || fromIndex >= groups.length) return groups
  if (toIndex < 0 || toIndex > groups.length) return groups
  // Moving to the position immediately after fromIndex is a no-op.
  if (fromIndex === toIndex || toIndex === fromIndex + 1) return groups
  const filtered = groups.filter((_, i) => i !== fromIndex)
  const insertAt = toIndex > fromIndex ? toIndex - 1 : toIndex
  return [...filtered.slice(0, insertAt), groups[fromIndex], ...filtered.slice(insertAt)]
}

function finalizeBounds(g: Segment): Segment {
  if (g.words.length === 0) return g
  return {
    ...g,
    start: g.words[0].start,
    end: g.words[g.words.length - 1].end,
    text: g.words.map((w) => w.word).join(' '),
  }
}

/**
 * A group under construction. `base` is the previous group it came from, or
 * null for a group created to hold words from a segment that had none.
 */
type Bucket = {
  base: Segment | null
  segmentId: string
  words: Word[]
}

/**
 * Reconcile manually-edited groups against updated source segments **without
 * rebuilding membership**.
 *
 * Group membership is a user decision: a word dragged into a non-adjacent group,
 * or a group dragged to a new position, is not recoverable from document order.
 * So words are matched by `wid` (`lib/wordIds.ts`) and stay exactly where the
 * user put them; only their text and timing are refreshed from the segments.
 *
 * The rules, in full:
 *
 * 1. A word whose `wid` still exists in `segments` is updated in place from the
 *    segment word. Per-word `overrides` are authored in the Groups editor and
 *    live only on the group word, so the group's own overrides win.
 * 2. A word whose `wid` is gone from `segments` was deleted — it is dropped.
 * 3. A word in `segments` that is in no group is new. It is inserted directly
 *    after its predecessor in segment order, in that predecessor's group. A word
 *    from a segment none of whose words are grouped yet (a freshly added
 *    subtitle) starts its own group instead of being absorbed by the previous
 *    one.
 * 4. Groups left with no words are dropped (as `moveWord` already does).
 * 5. Bounds: a group whose word ids are unchanged keeps `start`/`end`
 *    **verbatim** — that is what preserves a manual timeline drag and the
 *    stretched end baked by "Fill gaps". A group whose word set changed gets
 *    bounds recomputed from its words (`finalizeBounds` semantics, matching the
 *    stale-bounds fix in 90c2e7a).
 * 6. `speaker` and `positionOverride` ride the group.
 *
 * Falls back to `restoreManualGroupState(buildStudioGroups(...))` — the old,
 * document-order behaviour — when identity is unavailable: a project saved
 * before word ids existed, or an empty group list. Better a documented reset
 * than a silently scrambled transcript.
 *
 * Pure: neither `previous` nor `segments` is mutated.
 */
export function reconcileGroups(
  previous: Segment[],
  segments: Segment[],
  wordsPerGroup: number
): Segment[] {
  const rebuild = (): Segment[] =>
    restoreManualGroupState(buildStudioGroups(segments, wordsPerGroup), previous)

  if (previous.length === 0) return buildStudioGroups(segments, wordsPerGroup)

  // Identity is all-or-nothing: a partial id set would place some words by wid
  // and strand the rest, which is worse than the honest document-order rebuild.
  const hasIds = (segs: readonly Segment[]): boolean =>
    segs.every((s) => s.words.every((w) => w.wid))
  if (!hasIds(previous) || !hasIds(segments)) return rebuild()

  const bySegWord = new Map<string, Word>()
  const segmentOfWord = new Map<string, string>()
  for (const seg of segments) {
    for (const w of seg.words) {
      bySegWord.set(w.wid!, w)
      segmentOfWord.set(w.wid!, seg.id)
    }
  }

  // Rule 1 + 2 — survivors only, refreshed from the segments, group order kept.
  const buckets: Bucket[] = previous.map((g) => ({
    base: g,
    segmentId: segmentOfWord.get(g.words[0]?.wid ?? '') ?? '',
    words: g.words
      .filter((w) => bySegWord.has(w.wid!))
      .map((w) => {
        const fresh = bySegWord.get(w.wid!)!
        return w.overrides ? { ...fresh, overrides: w.overrides } : { ...fresh }
      }),
  }))

  const bucketOfWord = new Map<string, Bucket>()
  buckets.forEach((b) => b.words.forEach((w) => bucketOfWord.set(w.wid!, b)))

  // Every group word vanished — nothing left to anchor insertions to.
  if (bucketOfWord.size === 0) return rebuild()

  // Rule 3 — walk the segments in document order, placing new words next to the
  // last word we know the home of.
  let lastBucket: Bucket | null = null
  let lastWid: string | null = null
  let lastSegmentId: string | null = null
  const leading: Word[] = []

  for (const seg of segments) {
    for (const w of seg.words) {
      const home = bucketOfWord.get(w.wid!)
      if (home) {
        lastBucket = home
        lastWid = w.wid!
        lastSegmentId = seg.id
        continue
      }
      const fresh = { ...w }
      if (!lastBucket) {
        leading.push(fresh)
        continue
      }
      if (lastSegmentId === seg.id) {
        const at = lastBucket.words.findIndex((x) => x.wid === lastWid)
        lastBucket.words.splice(at + 1, 0, fresh)
      } else {
        const created: Bucket = { base: null, segmentId: seg.id, words: [fresh] }
        buckets.splice(buckets.indexOf(lastBucket) + 1, 0, created)
        lastBucket = created
      }
      bucketOfWord.set(fresh.wid!, lastBucket)
      lastWid = fresh.wid!
      lastSegmentId = seg.id
    }
  }

  // New words ahead of every grouped word: same rule, applied at the front.
  if (leading.length > 0) {
    const first = buckets.find((b) => b.words.length > 0)!
    if (first.segmentId === segmentOfWord.get(leading[0].wid!)) {
      first.words.unshift(...leading)
    } else {
      buckets.unshift({
        base: null,
        segmentId: segmentOfWord.get(leading[0].wid!) ?? '',
        words: leading,
      })
    }
  }

  // Rules 4-6.
  return buckets
    .filter((b) => b.words.length > 0)
    .map((b) => {
      const words = b.words
      if (!b.base) {
        return finalizeBounds({
          id: `${b.segmentId}:+${words[0].wid}`,
          start: 0,
          end: 0,
          text: '',
          words,
        })
      }
      const sameWords =
        words.length === b.base.words.length &&
        words.every((w, i) => w.wid === b.base!.words[i].wid)
      const next: Segment = { ...b.base, words, text: words.map((w) => w.word).join(' ') }
      return sameWords ? next : finalizeBounds(next)
    })
}

/**
 * Carry the user's manual group state across a rebuild from source segments.
 *
 * Group IDs are `${seg.id}:${wordOffset}`, so an ID surviving a rebuild does
 * **not** guarantee the chunk still holds the same words: adding, merging or
 * deleting a word inside a segment shifts every later chunk's contents while
 * some IDs stay the same. Restoring manually-dragged `start`/`end` onto a
 * re-chunked group desyncs it — the group can end before its own last word
 * starts.
 *
 * So manual timing and per-word overrides are restored only when the rebuilt
 * chunk's words are byte-identical to the saved group's (same text and same
 * timings, in the same order); otherwise the chunk genuinely changed and the
 * freshly derived bounds are the correct ones. `positionOverride` is a
 * group-level placement choice rather than a timing claim, so it rides the ID
 * alone — matching what a full rebuild does.
 */
export function restoreManualGroupState(rebuilt: Segment[], previous: Segment[]): Segment[] {
  if (previous.length === 0) return rebuilt
  const savedById = new Map(previous.map((g) => [g.id, g]))

  return rebuilt.map((g) => {
    const saved = savedById.get(g.id)
    if (!saved) return g

    const withPosition = saved.positionOverride
      ? { ...g, positionOverride: saved.positionOverride }
      : g

    const sameWords =
      saved.words.length === g.words.length &&
      saved.words.every(
        (w, j) =>
          w.word === g.words[j].word && w.start === g.words[j].start && w.end === g.words[j].end
      )
    if (!sameWords) return withPosition

    return {
      ...withPosition,
      start: saved.start,
      end: saved.end,
      words: g.words.map((w, j) => {
        const ov = saved.words[j]?.overrides
        return ov ? { ...w, overrides: ov } : w
      }),
    }
  })
}
