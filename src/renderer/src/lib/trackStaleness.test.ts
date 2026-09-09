import { describe, expect, test } from 'vitest'
import { buildSourceIndex, classifyTrack, sourceTextFor } from './trackStaleness'
import { bakeTranslation } from './trackTiming'
import { createTrackFromSource } from './tracks'
import { buildStudioGroups } from './groups'
import { makeSourceTrack, sourceSegment, sourceWords, word } from './trackFixtures.testutil'
import type { CaptionTrack } from './tracks'
import type { Segment, Word } from '../types/app'

// ── Fixtures ─────────────────────────────────────────────────────

/** A Polish track over the standard six-word source, both groups translated. */
function makePolish(source: CaptionTrack): CaptionTrack {
  const track = createTrackFromSource(source, { id: 't1', lang: 'pl' })
  const index = buildSourceIndex(source)
  const texts = ['jeden dwa trzy', 'cztery piec szesc']
  const groups = track.groups.map((g, i) => bakeTranslation(g, texts[i], index))
  return { ...track, groups, segments: groups.map((g) => ({ ...g })) }
}

/** Rebuild a source track around new segment words, keeping `wordsPerGroup`. */
function resource(words: Word[], wordsPerGroup = 3): CaptionTrack {
  return makeSourceTrack(words, wordsPerGroup)
}

// ── §D worked examples ───────────────────────────────────────────

describe('classifyTrack — the §D worked-example table', () => {
  const source = makeSourceTrack()
  const polish = makePolish(source)

  test('a fresh translation over an untouched source is entirely clean', () => {
    const c = classifyTrack(polish, source)
    expect(c.staleCount).toBe(0)
    expect(c.untranslatedCount).toBe(0)
    expect(c.reflowNeeded).toBe(false)
    expect([...c.byGroup.values()]).toEqual(['clean', 'clean'])
  })

  test('typo fix (wid carried, text changed) → 1 stale, reflowNeeded=false', () => {
    // `wordTiming.retimeWords` carries the wid through a one-for-one rewrite, so
    // only the recorded *text* can reveal this — Correction 1.
    const fixed = sourceWords().map((w) => (w.word === 'brown' ? { ...w, word: 'braun' } : w))
    const c = classifyTrack(polish, resource(fixed))
    expect(c.staleCount).toBe(1)
    expect(c.untranslatedCount).toBe(0)
    expect(c.reflowNeeded).toBe(false)
    expect(c.byGroup.get(polish.groups[0].id)).toBe('stale')
    expect(c.byGroup.get(polish.groups[1].id)).toBe('clean')
  })

  test('a punctuation/casing-only source change is NOT stale (normalizeToken)', () => {
    const punct = sourceWords().map((w) => (w.word === 'brown' ? { ...w, word: 'Brown,' } : w))
    const c = classifyTrack(polish, resource(punct))
    expect(c.staleCount).toBe(0)
  })

  test('wordsPerGroup change → 0 stale, reflowNeeded=true', () => {
    const c = classifyTrack(polish, resource(sourceWords(), 2))
    expect(c.staleCount).toBe(0)
    expect(c.untranslatedCount).toBe(0)
    expect(c.reflowNeeded).toBe(true)
    expect([...c.byGroup.values()]).toEqual(['clean', 'clean'])
  })

  test('word inserted mid-transcript → 1 stale (the predecessor’s group), reflowNeeded=true', () => {
    const words = sourceWords()
    const inserted = [
      ...words.slice(0, 2),
      word('red', 1.0, 1.2, 'sNEW'),
      ...words.slice(2),
    ]
    const c = classifyTrack(polish, resource(inserted))
    expect(c.staleCount).toBe(1)
    expect(c.reflowNeeded).toBe(true)
    // "quick" (the predecessor) lives in the first group, so the insertion is
    // attributed there — reconcileGroups Rule 3's attribution rule.
    expect(c.byGroup.get(polish.groups[0].id)).toBe('stale')
    expect(c.byGroup.get(polish.groups[1].id)).toBe('clean')
  })

  test('/api/realign (wids and text preserved) → 0 stale, reflowNeeded=false', () => {
    const nudged = sourceWords().map((w) => ({ ...w, start: w.start + 0.03, end: w.end + 0.03 }))
    const c = classifyTrack(polish, resource(nudged))
    expect(c.staleCount).toBe(0)
    expect(c.reflowNeeded).toBe(false)
  })

  test('set_track_text on a stale group re-records its source → clean', () => {
    const fixed = resource(sourceWords().map((w) => (w.word === 'brown' ? { ...w, word: 'braun' } : w)))
    expect(classifyTrack(polish, fixed).staleCount).toBe(1)

    const index = buildSourceIndex(fixed)
    const rebaked = {
      ...polish,
      groups: [bakeTranslation(polish.groups[0], 'nowy tekst', index), polish.groups[1]],
    }
    const c = classifyTrack(rebaked, fixed)
    expect(c.staleCount).toBe(0)
    expect(c.byGroup.get(rebaked.groups[0].id)).toBe('clean')
  })

  test('manual merge of two Polish groups (sourceWords concatenated) → still clean', () => {
    const [a, b] = polish.groups
    const merged: Segment = {
      id: `${a.id}+${b.id}`,
      start: a.start,
      end: b.end,
      text: `${a.text} ${b.text}`,
      words: [...a.words, ...b.words],
      sourceWords: [...(a.sourceWords ?? []), ...(b.sourceWords ?? [])],
    }
    const c = classifyTrack({ ...polish, groups: [merged] }, source)
    expect(c.staleCount).toBe(0)
    expect(c.reflowNeeded).toBe(false)
    expect(c.byGroup.get(merged.id)).toBe('clean')
  })
})

// ── The remaining §D rules ───────────────────────────────────────

describe('classifyTrack — states and edge rules', () => {
  const source = makeSourceTrack()

  test('an empty group is untranslated, and that beats staleness', () => {
    const fresh = createTrackFromSource(source, { id: 't1', lang: 'pl' })
    // Source word deleted → the group's record is broken *and* it has no text.
    const shortened = makeSourceTrack(sourceWords().slice(1))
    const c = classifyTrack(fresh, shortened)
    expect(c.untranslatedCount).toBe(2)
    expect(c.staleCount).toBe(0)
    expect([...c.byGroup.values()]).toEqual(['untranslated', 'untranslated'])
  })

  test('a deleted source word makes the owning group stale', () => {
    const polish = makePolish(source)
    const c = classifyTrack(polish, makeSourceTrack(sourceWords().slice(0, 5)))
    expect(c.byGroup.get(polish.groups[1].id)).toBe('stale')
    expect(c.byGroup.get(polish.groups[0].id)).toBe('clean')
    expect(c.staleCount).toBe(1)
  })

  test('identity is all-or-nothing: one missing wid reports every group stale', () => {
    const polish = makePolish(source)
    const noIds = sourceWords().map((w, i) => (i === 3 ? { ...w, wid: undefined } : w))
    const c = classifyTrack(polish, resource(noIds))
    expect(c.staleCount).toBe(2)
    expect(c.untranslatedCount).toBe(0)
    expect(c.reflowNeeded).toBe(true)
    expect([...c.byGroup.values()]).toEqual(['stale', 'stale'])
  })

  test('a group with no recorded source is clean — there is nothing to compare', () => {
    const orphan: Segment = { id: 'x', start: 0, end: 1, text: 'obcy', words: [] }
    const c = classifyTrack({ ...makePolish(source), groups: [orphan] }, source)
    expect(c.byGroup.get('x')).toBe('clean')
  })

  test('a head insertion is attributed to the first group', () => {
    const polish = makePolish(source)
    const words = [word('och', 0, 0.2, 'sHEAD'), ...sourceWords()]
    const c = classifyTrack(polish, resource(words))
    expect(c.byGroup.get(polish.groups[0].id)).toBe('stale')
    expect(c.byGroup.get(polish.groups[1].id)).toBe('clean')
  })

  test('reflowNeeded is false when the track has no recorded snapshot', () => {
    const polish = makePolish(source)
    const { sourceSnapshot: _dropped, ...noSnapshot } = polish
    const c = classifyTrack(noSnapshot as CaptionTrack, resource(sourceWords(), 2))
    expect(c.reflowNeeded).toBe(false)
  })

  test('a source text edit alone never sets reflowNeeded', () => {
    const polish = makePolish(source)
    const fixed = sourceWords().map((w) => (w.word === 'fox' ? { ...w, word: 'lis' } : w))
    expect(classifyTrack(polish, resource(fixed)).reflowNeeded).toBe(false)
  })
})

// ── buildSourceIndex ─────────────────────────────────────────────

describe('buildSourceIndex', () => {
  const source = makeSourceTrack()

  test('records group position and document order for every source word', () => {
    const index = buildSourceIndex(source)
    expect(index.complete).toBe(true)
    expect(index.order).toEqual(['s1w0', 's1w1', 's1w2', 's1w3', 's1w4', 's1w5'])
    expect(index.byId.get('s1w0')).toMatchObject({ groupIdx: 0, isFirstInGroup: true, isLastInGroup: false })
    expect(index.byId.get('s1w2')).toMatchObject({ groupIdx: 0, isFirstInGroup: false, isLastInGroup: true })
    expect(index.byId.get('s1w3')).toMatchObject({ groupIdx: 1, isFirstInGroup: true })
  })

  test('is marked incomplete when any source word lacks a wid', () => {
    const words = sourceWords().map((w, i) => (i === 2 ? { ...w, wid: undefined } : w))
    expect(buildSourceIndex(resource(words)).complete).toBe(false)
  })

  test('an empty source is complete but empty', () => {
    const empty = makeSourceTrack([], 3, { segments: [], groups: [] })
    const index = buildSourceIndex(empty)
    expect(index.complete).toBe(true)
    expect(index.order).toEqual([])
  })
})

// ── sourceTextFor ────────────────────────────────────────────────

describe('sourceTextFor', () => {
  const source = makeSourceTrack()

  test('renders the current text of the recorded words in source order', () => {
    const polish = makePolish(source)
    expect(sourceTextFor(polish.groups[0], buildSourceIndex(source))).toBe('the quick brown')
    expect(sourceTextFor(polish.groups[1], buildSourceIndex(source))).toBe('fox jumps over')
  })

  test('reflects a corrected source word', () => {
    const polish = makePolish(source)
    const fixed = resource(sourceWords().map((w) => (w.word === 'brown' ? { ...w, word: 'braun' } : w)))
    expect(sourceTextFor(polish.groups[0], buildSourceIndex(fixed))).toBe('the quick braun')
  })

  test('includes an attributed insertion, in source order', () => {
    const polish = makePolish(source)
    const words = sourceWords()
    const inserted = [...words.slice(0, 2), word('red', 1.0, 1.2, 'sNEW'), ...words.slice(2)]
    const index = buildSourceIndex(resource(inserted))
    const recorded = new Set(polish.groups.flatMap((g) => (g.sourceWords ?? []).map((s) => s.wid)))
    expect(sourceTextFor(polish.groups[0], index, { allRecorded: recorded })).toBe(
      'the quick red brown'
    )
  })

  test('drops words the source no longer has', () => {
    const polish = makePolish(source)
    const shortened = makeSourceTrack(sourceWords().filter((w) => w.word !== 'quick'))
    expect(sourceTextFor(polish.groups[0], buildSourceIndex(shortened))).toBe('the brown')
  })
})

// ── guard: no accidental coupling to grouping order ──────────────

describe('classifyTrack — reordering the source groups', () => {
  test('a manual source group reorder sets reflowNeeded but no staleness', () => {
    const source = makeSourceTrack()
    const polish = makePolish(source)
    const reordered: CaptionTrack = {
      ...source,
      groups: [source.groups[1], source.groups[0]],
    }
    const c = classifyTrack(polish, reordered)
    expect(c.reflowNeeded).toBe(true)
    expect(c.staleCount).toBe(0)
  })
})

// ── sanity: the fixture really is what the table describes ───────

test('the fixture source chunks into two groups of three words', () => {
  const groups = buildStudioGroups([sourceSegment()], 3)
  expect(groups.map((g) => g.text)).toEqual(['the quick brown', 'fox jumps over'])
})
