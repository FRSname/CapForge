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
 * through silence gaps — **every** gap, however long, with no guards. This is
 * the manual "Close all gaps" button, not the automatic pass; for the derived,
 * threshold-limited version see `closeGroupGaps` below. (*This* function has no
 * backend twin — unlike `closeGroupGaps`, this bake is frontend-only and
 * reaches the render because `handleFillGaps` flips `groupsEdited`, the
 * operative trigger for `render.ts` sending `custom_groups` on this path.
 * `positionOverride` is a second, independent trigger in the same condition.)
 *
 * For every group except the last, if the next group's start is later than
 * this group's end (i.e. there is a gap), extend this group's end to meet
 * it. Never shrinks an end (overlapping/out-of-order groups are left as-is).
 * The last group is unchanged. Word timings and group membership are untouched —
 * only the group's outer `end` moves. Returns a new array of new objects; the
 * input is never mutated.
 *
 * Since `ce73fef` this is a one-shot **bake**, not a derived view: the Groups
 * toolbar's "Close all gaps" button writes the result straight into editable group
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

/**
 * Close the *short* gaps between caption groups, and hold the final caption
 * past its last word. The automatic counterpart to `fillGroupGaps`.
 *
 * **This one has a backend twin**: `_close_group_gaps` in
 * `backend/exporters/video_render.py` (applied inside `_build_groups`, i.e. on
 * the path that re-chunks from the stored transcription instead of taking
 * `custom_groups`). The two must agree case for case and change in lockstep —
 * as must their suites, `groups.gaps.test.ts` and
 * `backend/tests/test_group_gap_closing.py`, which share a fixture and a
 * literal expected-ends table.
 *
 * A caption that blinks off for two frames between groups reads as a flicker,
 * while a real pause should still clear the screen — so only a gap of at most
 * `threshold` seconds is closed, by moving the earlier group's `end` up to the
 * later group's `start`. The rules, applied in this order to each consecutive
 * pair `(a, b)`:
 *
 * 1. **Exemption** — `a.endEdited` (the user placed that end by hand) skips the
 *    pair. Checked on `a`, the group whose `end` would move — never on `b`, so
 *    a gap *into* a hand-ended group still closes.
 * 2. **Missing timing** — the pair is skipped unless `a`'s last word `end` and
 *    `b`'s first word `start` are both finite. `Word.start`/`end` are non-optional
 *    in TypeScript, so this only fires on backend data or an old project file;
 *    treating a missing value as `0` would yank a caption to the clip start.
 * 3. **Speaker change** — never bridge one. Compared on the group's `speaker`
 *    (`speaker` lives on `Segment`, not `Word`); two `undefined`s count as the
 *    same speaker. Only reachable at a cross-segment boundary, since a group
 *    never spans segments.
 * 4. **Gap sign + threshold** — the end moves only when
 *    `0 < gap <= threshold`, so an already-closed or overlapping boundary is
 *    left alone and an end is never shortened. The boundary is inclusive.
 *
 * The final group of the whole array then gets `lastGroupHold` seconds added to
 * its end (unless it is `endEdited`), so the last caption doesn't vanish the
 * instant speech stops. The two dials are independent: `threshold <= 0` disables
 * closing but not the hold, and vice versa. The hold is deliberately not clamped
 * to the media duration — holding past the end is a no-op in every renderer.
 *
 * **Not idempotent.** Gap closing is (a closed gap is exactly 0, which fails
 * `gap > 0`), but the tail hold adds `lastGroupHold` every time it runs. Apply
 * this pass **once per pipeline** and never write its output back into group
 * state: `reconcileGroups` Rule 5 would carry the held end forward as a manual
 * bound and the next pass would extend it again, compounding by one hold per
 * edit. It is a derived view — the editors keep the raw groups.
 *
 * Group `words`, `text`, `start`, membership, count, `positionOverride`,
 * `endEdited` and per-word `overrides` are all untouched; only a group's `end`
 * moves. Returns a new array of new objects; the input is never mutated.
 */
export function closeGroupGaps(
  groups: Segment[],
  threshold: number,
  lastGroupHold: number
): Segment[] {
  if (groups.length === 0) return []

  /** The end `a` should carry once the gap into its successor is considered. */
  const closedEnd = (a: Segment, b: Segment | undefined): number => {
    if (!b) return a.end
    if (a.endEdited) return a.end
    // `words` is non-optional in TypeScript, but Guard 06 exists precisely for
    // data TypeScript never saw (backend payload, old project file) — so the
    // whole access is defensive: a group with no `words` array yields
    // `undefined`, fails the finiteness check below, and is skipped.
    const aWords = a.words ?? []
    const bWords = b.words ?? []
    const aLastEnd = aWords[aWords.length - 1]?.end
    const bFirstStart = bWords[0]?.start
    if (!Number.isFinite(aLastEnd) || !Number.isFinite(bFirstStart)) return a.end
    if (a.speaker !== b.speaker) return a.end
    const gap = b.start - a.end
    return gap > 0 && gap <= threshold ? b.start : a.end
  }

  const lastIndex = groups.length - 1

  return groups.map((group, i) => {
    let end = closedEnd(group, groups[i + 1])

    if (i === lastIndex && lastGroupHold > 0 && !group.endEdited) {
      // max(), not +=, is future-proofing only: today the last group has no
      // successor, so `end` is always exactly `group.end` here and the left
      // operand can never win. It keeps the hold correct if the final group
      // ever becomes closable (e.g. closing into a media-duration bound). It
      // does NOT make the pass idempotent across calls — see the doc comment.
      end = Math.max(end, group.end + lastGroupHold)
    }

    return { ...group, end }
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

/**
 * Recompute a group's `start`/`end`/`text` from the words it now holds.
 *
 * This is *the* "bounds derived from words" primitive, so it is also where a
 * stale `endEdited` claim dies: callers such as `moveWord` spread the previous
 * group object (`{ ...dst, words }`), and an end the user placed by hand no
 * longer describes a group whose membership just changed. Clearing it here
 * covers every caller.
 */
function finalizeBounds(g: Segment): Segment {
  const { endEdited: _staleEndClaim, ...rest } = g
  // No words to derive bounds from — keep the ones it has, but the claim that
  // the user placed this `end` is just as stale as on the normal path.
  // (Currently unreachable: every caller drops empty groups before recomputing.)
  if (g.words.length === 0) return { ...rest }
  return {
    ...rest,
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
 *    stretched end baked by "Close all gaps". A group whose word set changed gets
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
 * freshly derived bounds are the correct ones. `endEdited` is a claim *about*
 * that manual `end`, so it travels under the same condition — never on the ID
 * alone. `positionOverride` is a group-level placement choice rather than a
 * timing claim, so it does ride the ID alone — matching what a full rebuild does.
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
      ...(saved.endEdited ? { endEdited: true } : {}),
      words: g.words.map((w, j) => {
        const ov = saved.words[j]?.overrides
        return ov ? { ...w, overrides: ov } : w
      }),
    }
  })
}
