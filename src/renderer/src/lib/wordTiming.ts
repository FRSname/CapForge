/**
 * Word-timing reconciliation after a manual text correction.
 *
 * The invariant this module exists to enforce — the same one the Python side
 * documents in `mcp_server/cleanup.py`:
 *
 *   **Timing is never shifted.** CapForge is a finishing tool used after the
 *   video is cut elsewhere, so captions must stay locked to the original audio.
 *
 * Concretely: every word the user did *not* touch keeps a byte-identical
 * `start`/`end`. Only the run of words that actually changed is retimed, and
 * only inside that run's own time span. Editing one word must never move its
 * neighbours.
 *
 * Timings are matched by an LCS diff of the token text, never by array index —
 * index-keyed reuse is what made inserting a word shift every later word onto
 * its neighbour's slot.
 */

import type { Word } from '../types/app'

/** Minimum duration a retimed word may occupy, in seconds. */
export const MIN_WORD_DUR = 0.04

/** Split caption text into words on whitespace. */
export function tokenize(text: string): string[] {
  return text.split(/\s+/).filter(Boolean)
}

/**
 * Lowercase and strip surrounding punctuation, so a pure punctuation/casing
 * fix ("world" → "World,") counts as the same word and keeps its timing.
 * Mirrors `_normalize()` in `mcp_server/cleanup.py`.
 */
export function normalizeToken(token: string): string {
  return token
    .trim()
    .replace(/^[\p{P}\p{S}]+/gu, '')
    .replace(/[\p{P}\p{S}]+$/gu, '')
    .toLowerCase()
}

/**
 * Keys for the LCS. A token that normalizes to nothing (bare punctuation) gets
 * a unique sentinel so it can never match another such token by accident.
 */
function matchKeys(tokens: readonly string[], side: string): string[] {
  return tokens.map((t, i) => {
    const n = normalizeToken(t)
    return n === '' ? `\u0000${side}${i}` : n
  })
}

/** Indices of the longest common subsequence, as (oldIdx, newIdx) pairs. */
function lcsPairs(a: readonly string[], b: readonly string[]): Array<[number, number]> {
  const n = a.length
  const m = b.length
  // dp[i][j] = LCS length of a[i..] and b[j..]
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const pairs: Array<[number, number]> = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j])
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++
    } else {
      j++
    }
  }
  return pairs
}

/**
 * Lay `tokens` out across `[start, end)`, proportional to token length.
 *
 * Every word gets at least `MIN_WORD_DUR` when the span allows it; when the
 * span is too short for that (many tokens carved out of one brief word) the
 * span is split evenly instead. Overflowing into a neighbour is never an
 * option — locality outranks the minimum duration.
 */
function distribute(
  tokens: readonly string[],
  start: number,
  end: number
): Array<{ start: number; end: number }> {
  const n = tokens.length
  const span = Math.max(end - start, 0)
  const weights = tokens.map((t) => Math.max(t.length, 1))
  const weightSum = weights.reduce((acc, w) => acc + w, 0)

  // Surplus above the per-word floor is what gets shared out by weight; this
  // sums back to `span` exactly and keeps every word at or above the floor.
  const durations =
    span >= MIN_WORD_DUR * n
      ? weights.map((w) => MIN_WORD_DUR + ((span - MIN_WORD_DUR * n) * w) / weightSum)
      : weights.map(() => span / n)

  const out: Array<{ start: number; end: number }> = []
  let cursor = start
  for (let i = 0; i < n; i++) {
    const next = i === n - 1 ? end : cursor + durations[i]
    out.push({ start: cursor, end: next })
    cursor = next
  }
  return out
}

/**
 * Re-derive word timings after a text edit, changing only the words that
 * actually changed.
 *
 * Words matched between `oldWords` and `newTokens` keep their exact `start`,
 * `end` and `overrides`. A changed run is retimed within its own span. An
 * inserted word takes the silent gap between its neighbours when one exists,
 * and otherwise carves off the tail of the word before it — so at most one
 * neighbour moves, and only at the edge touching the edit. A deleted word's
 * span is absorbed by the surviving word before it (or, for a leading run, by
 * pulling the next survivor's start back), mirroring `apply_word_edits()` in
 * `mcp_server/cleanup.py`.
 *
 * @param bounds Fallback span used when there are no old words to anchor to.
 */
export function retimeWords(
  oldWords: readonly Word[],
  newTokens: readonly string[],
  bounds: { start: number; end: number }
): Word[] {
  if (newTokens.length === 0) return []

  if (oldWords.length === 0) {
    return distribute(newTokens, bounds.start, bounds.end).map((span, i) => ({
      word: newTokens[i],
      start: span.start,
      end: span.end,
    }))
  }

  const pairs = lcsPairs(matchKeys(oldWords.map((w) => w.word), 'a'), matchKeys(newTokens, 'b'))

  const out: Word[] = []
  /** Set on the next word pushed: a deleted leading run pulls its start back,
   *  a head insertion with no gap pushes it forward. */
  let pendingStart: number | null = null

  const push = (word: Word): void => {
    if (pendingStart !== null) {
      out.push({ ...word, start: Math.min(pendingStart, word.end - MIN_WORD_DUR) })
      pendingStart = null
      return
    }
    out.push(word)
  }

  /** Handle the changed run oldWords[i0..i1) ↔ newTokens[j0..j1). */
  const emitRun = (i0: number, i1: number, j0: number, j1: number): void => {
    const removed = oldWords.slice(i0, i1)
    const added = newTokens.slice(j0, j1)

    // Pure deletion — absorb the freed span, never resync anything else.
    if (added.length === 0) {
      const lastRemoved = removed[removed.length - 1]
      const prev = out[out.length - 1]
      if (prev) {
        out[out.length - 1] = { ...prev, end: Math.max(prev.end, lastRemoved.end) }
      } else {
        const earliest = Math.min(...removed.map((w) => w.start))
        pendingStart = pendingStart === null ? earliest : Math.min(pendingStart, earliest)
      }
      return
    }

    // Rewrite / split / merge — retime strictly inside the old run's own span.
    if (removed.length > 0) {
      const spans = distribute(added, removed[0].start, removed[removed.length - 1].end)
      const sameCount = removed.length === added.length
      added.forEach((token, k) => {
        // One-for-one rewrite ("teh" → "the") is the same word slot, so it keeps
        // both its styling and its identity (`wid`, lib/wordIds.ts) — losing the
        // id would read as delete+insert to reconcileGroups and could move the
        // word out of the group the user put it in.
        const carried = sameCount ? removed[k].overrides : undefined
        const carriedId = sameCount ? removed[k].wid : undefined
        push({
          word: token,
          start: spans[k].start,
          end: spans[k].end,
          ...(carriedId ? { wid: carriedId } : {}),
          ...(carried ? { overrides: carried } : {}),
        })
      })
      return
    }

    // Pure insertion — nothing was removed, so there is no span to reuse.
    const prev = out[out.length - 1]
    const prevEnd = prev ? prev.end : bounds.start
    const nextStart = i0 < oldWords.length ? oldWords[i0].start : bounds.end

    // Preferred: the words land in silence and nothing else moves at all.
    if (nextStart - prevEnd >= MIN_WORD_DUR * added.length) {
      distribute(added, prevEnd, nextStart).forEach((span, k) => {
        push({ word: added[k], start: span.start, end: span.end })
      })
      return
    }

    const addedChars = added.reduce((acc, t) => acc + Math.max(t.length, 1), 0)

    if (prev) {
      // Carve off the tail of the preceding word — the only word that moves.
      const prevDur = prev.end - prev.start
      const prevChars = Math.max(prev.word.length, 1)
      const wanted = (prevDur * addedChars) / (prevChars + addedChars)
      const carve = Math.max(Math.min(wanted, prevDur - MIN_WORD_DUR), 0)
      const splitAt = prev.end - carve
      out[out.length - 1] = { ...prev, end: splitAt }
      distribute(added, splitAt, prev.end).forEach((span, k) => {
        push({ word: added[k], start: span.start, end: span.end })
      })
      return
    }

    // Insertion at the very head with no gap: carve off the head of the word
    // that follows, applied when it is pushed.
    const next = oldWords[i0]
    const nextDur = next ? next.end - next.start : bounds.end - bounds.start
    const nextChars = next ? Math.max(next.word.length, 1) : 1
    const wanted = (nextDur * addedChars) / (nextChars + addedChars)
    const carve = Math.max(Math.min(wanted, nextDur - MIN_WORD_DUR), 0)
    distribute(added, nextStart, nextStart + carve).forEach((span, k) => {
      out.push({ word: added[k], start: span.start, end: span.end })
    })
    pendingStart = nextStart + carve
  }

  let oi = 0
  let nj = 0
  for (const [i, j] of pairs) {
    if (i > oi || j > nj) emitRun(oi, i, nj, j)
    push({ ...oldWords[i], word: newTokens[j] })
    oi = i + 1
    nj = j + 1
  }
  if (oi < oldWords.length || nj < newTokens.length) {
    emitRun(oi, oldWords.length, nj, newTokens.length)
  }

  // Safety net: a degenerate transcript (zero-length or inverted word) must not
  // produce an inverted result. Only ever widens the word's own end.
  return out.map((w) => (w.end > w.start ? w : { ...w, end: w.start + MIN_WORD_DUR }))
}

/** Join words into caption text, skipping empties so no double space appears. */
export function joinWords(words: readonly Word[]): string {
  return words
    .map((w) => w.word)
    .filter((w) => w.trim())
    .join(' ')
}
