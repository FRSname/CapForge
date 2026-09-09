import { describe, expect, test } from 'vitest'
import { bakeTranslation, propagateSourceTiming } from './trackTiming'
import { buildSourceIndex } from './trackStaleness'
import { createTrackFromSource } from './tracks'
import { MIN_WORD_DUR } from './wordTiming'
import { chunkTranslatedGroups } from './trackChunking'
import { makeSourceTrack, sourceWords } from './trackFixtures.testutil'
import type { CaptionTrack } from './tracks'
import type { Segment } from '../types/app'

const source = makeSourceTrack()
const index = () => buildSourceIndex(source)

/** A Polish track with both groups translated. */
function makePolish(src: CaptionTrack = source): CaptionTrack {
  const track = createTrackFromSource(src, { id: 't1', lang: 'pl' })
  const idx = buildSourceIndex(src)
  const texts = ['jeden dwa trzy', 'cztery piec szesc']
  const groups = track.groups.map((g, i) => bakeTranslation(g, texts[i], idx))
  return { ...track, groups, segments: groups.map((g) => ({ ...g })) }
}

// ── bakeTranslation ──────────────────────────────────────────────

describe('bakeTranslation', () => {
  const blank = createTrackFromSource(source, { id: 't1', lang: 'pl' }).groups[0]

  test('a fresh translation is laid out proportionally across the group span', () => {
    const baked = bakeTranslation(blank, 'jeden dwa trzy', index())
    expect(baked.text).toBe('jeden dwa trzy')
    expect(baked.words.map((w) => w.word)).toEqual(['jeden', 'dwa', 'trzy'])
    expect(baked.words[0].start).toBe(blank.start)
    expect(baked.words[2].end).toBe(blank.end)
    // Monotonic, contiguous, inside the span.
    for (let i = 1; i < baked.words.length; i++) {
      expect(baked.words[i].start).toBeCloseTo(baked.words[i - 1].end, 9)
    }
    // Char-weighted: "jeden" (5) is longer than "dwa" (3).
    const dur = (i: number) => baked.words[i].end - baked.words[i].start
    expect(dur(0)).toBeGreaterThan(dur(1))
  })

  test('the group start/end never move', () => {
    const baked = bakeTranslation(blank, 'a b c d e f g', index())
    expect(baked.start).toBe(blank.start)
    expect(baked.end).toBe(blank.end)
  })

  test('every freshly derived word is marked timingDerived and gets a wid', () => {
    const baked = bakeTranslation(blank, 'jeden dwa', index())
    expect(baked.words.every((w) => w.timingDerived === true)).toBe(true)
    expect(baked.words.every((w) => typeof w.wid === 'string' && w.wid.length > 0)).toBe(true)
    expect(new Set(baked.words.map((w) => w.wid)).size).toBe(2)
  })

  test('re-records sourceWords from the current source', () => {
    const baked = bakeTranslation(blank, 'jeden', index())
    expect(baked.sourceWords).toEqual([
      { wid: 's1w0', text: 'the' },
      { wid: 's1w1', text: 'quick' },
      { wid: 's1w2', text: 'brown' },
    ])
  })

  test('re-recording picks up a corrected source word, clearing staleness', () => {
    const corrected = makeSourceTrack(
      sourceWords().map((w) => (w.word === 'brown' ? { ...w, word: 'braun' } : w))
    )
    const baked = bakeTranslation(blank, 'jeden', buildSourceIndex(corrected))
    expect(baked.sourceWords?.map((s) => s.text)).toEqual(['the', 'quick', 'braun'])
  })

  test('an unchanged word keeps a byte-identical timing and its pinned status', () => {
    const first = bakeTranslation(blank, 'jeden dwa trzy', index())
    // Pin the middle word the way a timeline drag does.
    const { timingDerived: _pinned, ...pinnedWord } = first.words[1]
    const pinned: Segment = {
      ...first,
      words: [first.words[0], { ...pinnedWord, start: 0.6, end: 0.9 }, first.words[2]],
    }
    const second = bakeTranslation(pinned, 'jeden dwa cztery', index())
    expect(second.words[1].start).toBe(0.6)
    expect(second.words[1].end).toBe(0.9)
    expect(second.words[1].wid).toBe(pinned.words[1].wid)
    expect('timingDerived' in second.words[1]).toBe(false)
    // Only the changed word is re-derived.
    expect(second.words[0]).toEqual(first.words[0])
    expect(second.words[2].timingDerived).toBe(true)
  })

  test('a one-for-one rewrite keeps the word slot but re-marks it derived', () => {
    const first = bakeTranslation(blank, 'jeden dwa trzy', index())
    const second = bakeTranslation(first, 'jeden dwaj trzy', index())
    expect(second.words[1].wid).toBe(first.words[1].wid)
    expect(second.words[1].timingDerived).toBe(true)
  })

  test('empty text keeps the group as a placeholder with its own timing', () => {
    const filled = bakeTranslation(blank, 'jeden dwa', index())
    const cleared = bakeTranslation(filled, '   ', index())
    expect(cleared.words).toEqual([])
    expect(cleared.text).toBe('')
    expect(cleared.start).toBe(blank.start)
    expect(cleared.end).toBe(blank.end)
    expect(cleared.sourceWords).toEqual(blank.sourceWords)
  })

  test('setting text clears the previousText a reflow attached', () => {
    const carried: Segment = { ...blank, previousText: 'stary tekst' }
    expect(bakeTranslation(carried, 'nowy', index()).previousText).toBeUndefined()
    expect('previousText' in bakeTranslation(carried, 'nowy', index())).toBe(false)
  })

  test('does not mutate the group it is given', () => {
    const snapshot = JSON.stringify(blank)
    bakeTranslation(blank, 'jeden dwa trzy', index())
    expect(JSON.stringify(blank)).toBe(snapshot)
  })
})

// ── propagateSourceTiming ────────────────────────────────────────

describe('propagateSourceTiming', () => {
  test('returns the same reference when nothing moved', () => {
    const polish = makePolish()
    expect(propagateSourceTiming(polish, source)).toBe(polish)
  })

  test('dragging the source group end by +0.2 s moves the linked end by +0.2 s', () => {
    const polish = makePolish()
    const dragged: CaptionTrack = {
      ...source,
      groups: [{ ...source.groups[0], end: source.groups[0].end + 0.2, endEdited: true }, source.groups[1]],
    }
    const next = propagateSourceTiming(polish, dragged)
    expect(next.groups[0].end).toBeCloseTo(polish.groups[0].end + 0.2, 9)
    // A hand-placed source end rides across, so gap closing respects it on both tabs.
    expect(next.groups[0].endEdited).toBe(true)
    // The untouched neighbour is left alone, object identity and all.
    expect(next.groups[1]).toBe(polish.groups[1])
  })

  test('a timingLinked:false group is never moved', () => {
    const polish = makePolish()
    const pinnedTrack: CaptionTrack = {
      ...polish,
      groups: [{ ...polish.groups[0], timingLinked: false }, polish.groups[1]],
    }
    const dragged: CaptionTrack = {
      ...source,
      groups: [{ ...source.groups[0], end: 4 }, source.groups[1]],
    }
    const next = propagateSourceTiming(pinnedTrack, dragged)
    expect(next.groups[0]).toBe(pinnedTrack.groups[0])
  })

  test('derived words are re-distributed across the new span', () => {
    const polish = makePolish()
    const dragged: CaptionTrack = {
      ...source,
      groups: [{ ...source.groups[0], end: 3 }, source.groups[1]],
    }
    const g = propagateSourceTiming(polish, dragged).groups[0]
    expect(g.end).toBe(3)
    expect(g.words[0].start).toBe(0)
    expect(g.words[g.words.length - 1].end).toBe(3)
    for (let i = 1; i < g.words.length; i++) {
      expect(g.words[i].start).toBeCloseTo(g.words[i - 1].end, 9)
    }
  })

  test('a pinned word is clamped into a shrinking span, derived neighbours reflow', () => {
    const polish = makePolish()
    const first = polish.groups[0]
    const { timingDerived: _p, ...last } = first.words[2]
    const withPin: CaptionTrack = {
      ...polish,
      groups: [{ ...first, words: [first.words[0], first.words[1], { ...last }] }, polish.groups[1]],
    }
    const shrunk: CaptionTrack = {
      ...source,
      groups: [{ ...source.groups[0], end: 1.0 }, source.groups[1]],
    }
    const g = propagateSourceTiming(withPin, shrunk).groups[0]
    expect(g.end).toBe(1.0)
    for (const w of g.words) {
      expect(w.start).toBeGreaterThanOrEqual(0)
      expect(w.end).toBeLessThanOrEqual(1.0 + 1e-9)
      expect(w.end - w.start).toBeGreaterThanOrEqual(MIN_WORD_DUR - 1e-9)
    }
    // The pinned word keeps its pin.
    expect('timingDerived' in g.words[2]).toBe(false)
  })

  test('an untranslated placeholder still tracks the source span', () => {
    const fresh = createTrackFromSource(source, { id: 't1', lang: 'pl' })
    const dragged: CaptionTrack = {
      ...source,
      groups: [{ ...source.groups[0], end: 2.5 }, source.groups[1]],
    }
    const g = propagateSourceTiming(fresh, dragged).groups[0]
    expect(g.end).toBe(2.5)
    expect(g.words).toEqual([])
  })

  test('a group whose recorded words all vanished is left alone', () => {
    const polish = makePolish()
    const gone = makeSourceTrack(sourceWords().slice(3))
    const next = propagateSourceTiming(polish, gone)
    expect(next.groups[0]).toBe(polish.groups[0])
  })

  test('the source track itself is returned untouched', () => {
    expect(propagateSourceTiming(source, source)).toBe(source)
  })

  test('does not mutate its inputs', () => {
    const polish = makePolish()
    const before = JSON.stringify(polish)
    const dragged: CaptionTrack = {
      ...source,
      groups: [{ ...source.groups[0], end: 3 }, source.groups[1]],
    }
    propagateSourceTiming(polish, dragged)
    expect(JSON.stringify(polish)).toBe(before)
  })
})

// ── propagateSourceTiming over a chunked caption (sibling runs) ───
//
// A caption chunked by `wordsPerGroup` on the translated tab is several groups
// carrying one identical source record. The link is with the *caption*, so the
// run moves as a unit and its chunks are rescaled inside the new span — never
// each snapped to the whole span, which would stack them on top of each other.

describe('propagateSourceTiming — sibling runs', () => {
  /** Polish with its first caption chunked into 2 + 1 words. */
  function makeChunked(): CaptionTrack {
    const polish = makePolish()
    return { ...polish, groups: chunkTranslatedGroups(polish.groups, 2) }
  }

  const dragTo = (end: number, patch: Partial<Segment> = {}): CaptionTrack => ({
    ...source,
    groups: [{ ...source.groups[0], end, ...patch }, source.groups[1]],
  })

  test('returns the same reference when nothing moved', () => {
    const chunked = makeChunked()
    expect(propagateSourceTiming(chunked, source)).toBe(chunked)
  })

  test('the run spans the linked span and its chunks are rescaled proportionally', () => {
    const chunked = makeChunked()
    const [a, b] = chunked.groups
    const wasSplitAt = (a.end - a.start) / (b.end - a.start)

    // Source group 0 grows from [0, 1.5] to [0, 3.0].
    const next = propagateSourceTiming(chunked, dragTo(3))

    expect(next.groups[0].start).toBe(0)
    expect(next.groups[1].end).toBe(3)
    // The chunk boundary keeps its place inside the caption.
    expect((next.groups[0].end - 0) / 3).toBeCloseTo(wasSplitAt, 9)
    expect(next.groups[1].start).toBeCloseTo(next.groups[0].end, 9)
    // Words follow their own chunk, not the whole caption.
    expect(next.groups[0].words[0].start).toBe(0)
    expect(next.groups[1].words[next.groups[1].words.length - 1].end).toBe(3)
  })

  test('the neighbouring caption is untouched, object identity and all', () => {
    const chunked = makeChunked()
    const next = propagateSourceTiming(chunked, dragTo(3))
    for (let i = 2; i < chunked.groups.length; i++) {
      expect(next.groups[i]).toBe(chunked.groups[i])
    }
  })

  test('a hand-placed source end lands on the run’s last chunk only', () => {
    const chunked = makeChunked()
    const next = propagateSourceTiming(chunked, dragTo(3, { endEdited: true }))
    expect(next.groups[0].endEdited).toBeUndefined()
    expect(next.groups[1].endEdited).toBe(true)
  })

  test('a pinned chunk drops the run back to per-group linking', () => {
    const chunked = makeChunked()
    const pinned: CaptionTrack = {
      ...chunked,
      groups: [{ ...chunked.groups[0], timingLinked: false }, ...chunked.groups.slice(1)],
    }

    const next = propagateSourceTiming(pinned, dragTo(3))

    // The pinned chunk is never moved…
    expect(next.groups[0]).toBe(pinned.groups[0])
    // …and its sibling falls back to today's whole-span rule.
    expect(next.groups[1].start).toBe(0)
    expect(next.groups[1].end).toBe(3)
  })
})
