import { describe, expect, test } from 'vitest'
import {
  buildWidToSegment,
  sameSentenceSegments,
  sentenceIndexOf,
  sentenceRuns,
  sentenceSegmentsFor,
  trackPrefixOf,
} from './trackSentences'
import { chunkTranslatedGroups } from './trackChunking'
import { createTrackFromSource } from './tracks'
import { bakeTranslation } from './trackTiming'
import { buildSourceIndex } from './trackStaleness'
import { reconcileGroups } from './groups'
import { retimeWords, tokenize } from './wordTiming'
import { makeSourceTrack, makeTranslatedTrack, sourceSegment, sourceWords, word } from './trackFixtures.testutil'
import { buildStudioGroups } from './groups'
import { STUDIO_DEFAULTS } from '../components/studio/StudioPanel'
import { SOURCE_TRACK_ID, type CaptionTrack } from './tracks'
import type { Segment, Word } from '../types/app'

// ── Fixtures ─────────────────────────────────────────────────────
// A translated group is words + the record of the source words it was written
// from; a sentence is the source *segment* the first of those words lives in.

const w = (text: string, start: number, end: number): Word => ({
  word: text,
  start,
  end,
  wid: `t-${text}`,
  timingDerived: true,
})

const SIX = ['one', 'two', 'three', 'four', 'five', 'six'].map((t, i) =>
  w(t, i * 0.5, i * 0.5 + 0.5)
)

function unit(id: string, words: Word[], wids: string[], patch: Partial<Segment> = {}): Segment {
  return {
    id,
    start: words[0]?.start ?? 0,
    end: words[words.length - 1]?.end ?? 0,
    text: words.map((x) => x.word).join(' '),
    words,
    sourceWords: wids.map((wid) => ({ wid, text: wid })),
    ...patch,
  }
}

/** Source words `s0`…`s5`, sentence 0 holding `s0`–`s2` and sentence 1 the rest. */
const TWO_SENTENCES = new Map<string, number>([
  ['s0', 0],
  ['s1', 0],
  ['s2', 0],
  ['s3', 1],
  ['s4', 1],
  ['s5', 1],
])

/** …and the same six words as ONE sentence — the fragmented-translation case. */
const ONE_SENTENCE = new Map<string, number>(
  ['s0', 's1', 's2', 's3', 's4', 's5'].map((wid) => [wid, 0])
)

// ── buildWidToSegment ────────────────────────────────────────────

describe('buildWidToSegment', () => {
  test('maps every word id to the index of the segment holding it', () => {
    const map = buildWidToSegment([
      sourceSegment(sourceWords().slice(0, 3), 's1'),
      sourceSegment(sourceWords().slice(3), 's2'),
    ])
    expect(map.get('s1w0')).toBe(0)
    expect(map.get('s1w2')).toBe(0)
    expect(map.get('s1w3')).toBe(1)
    expect(map.get('nope')).toBeUndefined()
  })

  test('skips words with no id rather than mapping them to undefined', () => {
    const map = buildWidToSegment([sourceSegment([word('anon', 0, 0.5)])])
    expect(map.size).toBe(0)
  })
})

// ── sentenceIndexOf ──────────────────────────────────────────────

describe('sentenceIndexOf', () => {
  test('is the sentence of the group’s FIRST recorded source word', () => {
    expect(sentenceIndexOf(unit('a', SIX.slice(0, 2), ['s2', 's3']), TWO_SENTENCES)).toBe(0)
  })

  test('is undefined for a group with no source record', () => {
    const plain: Segment = { id: 'a', start: 0, end: 1, text: 'x', words: [SIX[0]] }
    expect(sentenceIndexOf(plain, TWO_SENTENCES)).toBeUndefined()
  })

  test('is undefined when the first recorded word is gone from the source', () => {
    expect(sentenceIndexOf(unit('a', SIX.slice(0, 2), ['gone', 's1']), TWO_SENTENCES)).toBeUndefined()
  })
})

// ── sentenceRuns ─────────────────────────────────────────────────

describe('sentenceRuns', () => {
  test('consecutive groups of one sentence form one run', () => {
    const groups = [
      unit('t1:0', SIX.slice(0, 2), ['s0', 's1']),
      unit('t1:1', SIX.slice(2, 4), ['s2']),
      unit('t1:2', SIX.slice(4), ['s3', 's4', 's5']),
    ]
    expect(sentenceRuns(groups, TWO_SENTENCES)).toEqual([
      { index: 0, start: 0, length: 2 },
      { index: 1, start: 2, length: 1 },
    ])
  })

  test('an unresolvable group is a run of its own and never absorbs a neighbour', () => {
    const groups = [
      unit('t1:0', SIX.slice(0, 2), ['s0']),
      unit('t1:1', SIX.slice(2, 4), ['gone']),
      unit('t1:2', SIX.slice(4), ['s2']),
    ]
    expect(sentenceRuns(groups, TWO_SENTENCES)).toEqual([
      { index: 0, start: 0, length: 1 },
      { index: undefined, start: 1, length: 1 },
      { index: 0, start: 2, length: 1 },
    ])
  })
})

// ── trackPrefixOf ────────────────────────────────────────────────

describe('trackPrefixOf', () => {
  test('strips the chunk and sentence suffixes, keeps the reflow generation', () => {
    expect(trackPrefixOf('t1:4')).toBe('t1')
    expect(trackPrefixOf('t1:s2')).toBe('t1')
    expect(trackPrefixOf('t1:s2:1')).toBe('t1')
    expect(trackPrefixOf('t1:r3:4')).toBe('t1:r3')
    expect(trackPrefixOf('t1:r3:s2:0')).toBe('t1:r3')
  })
})

// ── sentenceSegmentsFor ──────────────────────────────────────────

describe('sentenceSegmentsFor', () => {
  test('folds the caption fragments of one sentence into a single text unit', () => {
    const groups = [
      unit('t1:0', SIX.slice(0, 3), ['s0', 's1', 's2']),
      unit('t1:1', SIX.slice(3), ['s3', 's4', 's5']),
    ]

    const segments = sentenceSegmentsFor(groups, ONE_SENTENCE, 't1')

    expect(segments).toHaveLength(1)
    expect(segments[0].id).toBe('t1:s0')
    expect(segments[0].text).toBe('one two three four five six')
    expect(segments[0].words).toEqual(SIX)
    expect(segments[0].start).toBe(0)
    expect(segments[0].end).toBe(3)
  })

  test('two sentences stay two units, in order', () => {
    const groups = [
      unit('t1:0', SIX.slice(0, 3), ['s0', 's1', 's2']),
      unit('t1:1', SIX.slice(3), ['s3', 's4', 's5']),
    ]
    const segments = sentenceSegmentsFor(groups, TWO_SENTENCES, 't1')
    expect(segments.map((s) => s.id)).toEqual(['t1:s0', 't1:s1'])
    expect(segments.map((s) => s.text)).toEqual(['one two three', 'four five six'])
  })

  test('a word-less placeholder still gets a row, with the sentence’s span', () => {
    const blank: Segment = {
      id: 't1:0',
      start: 0,
      end: 1.5,
      text: '',
      words: [],
      sourceWords: [{ wid: 's0', text: 's0' }],
    }
    const groups = [blank, unit('t1:1', SIX.slice(0, 2), ['s1'])]

    const segments = sentenceSegmentsFor(groups, ONE_SENTENCE, 't1')

    expect(segments).toHaveLength(1)
    expect(segments[0].start).toBe(0)
    expect(segments[0].text).toBe('one two')
  })

  test('a fully untranslated sentence is an empty row, not a missing one', () => {
    const blank: Segment = {
      id: 't1:0',
      start: 0,
      end: 1.5,
      text: '',
      words: [],
      sourceWords: [{ wid: 's0', text: 's0' }],
    }
    const segments = sentenceSegmentsFor([blank], ONE_SENTENCE, 't1')
    expect(segments).toHaveLength(1)
    expect(segments[0]).toMatchObject({ id: 't1:s0', text: '', words: [], start: 0, end: 1.5 })
  })

  test('an unresolvable group keeps its own id and is never merged', () => {
    const groups = [
      unit('t1:0', SIX.slice(0, 2), ['s0']),
      unit('t1:1', SIX.slice(2, 4), ['gone']),
      unit('t1:2', SIX.slice(4), ['s2']),
    ]
    const segments = sentenceSegmentsFor(groups, TWO_SENTENCES, 't1')
    expect(segments.map((s) => s.id)).toEqual(['t1:s0', 't1:1', 't1:s0'])
  })

  test('falls back to the first group’s id prefix when no track id is given', () => {
    const groups = [unit('t1:r2:0', SIX.slice(0, 3), ['s0'])]
    expect(sentenceSegmentsFor(groups, ONE_SENTENCE)[0].id).toBe('t1:r2:s0')
  })

  test('carries the speaker of the sentence’s first group', () => {
    const groups = [unit('t1:0', SIX.slice(0, 3), ['s0'], { speaker: 'SPEAKER_01' })]
    expect(sentenceSegmentsFor(groups, ONE_SENTENCE, 't1')[0].speaker).toBe('SPEAKER_01')
  })

  test('does not mutate its input', () => {
    const groups = [unit('t1:0', SIX.slice(0, 3), ['s0']), unit('t1:1', SIX.slice(3), ['s3'])]
    const before = JSON.stringify(groups)
    sentenceSegmentsFor(groups, ONE_SENTENCE, 't1')
    expect(JSON.stringify(groups)).toBe(before)
  })
})

// ── sameSentenceSegments ─────────────────────────────────────────

describe('sameSentenceSegments', () => {
  const groups = [unit('t1:0', SIX.slice(0, 3), ['s0']), unit('t1:1', SIX.slice(3), ['s3'])]

  test('two derivations of the same groups compare equal (fresh arrays and all)', () => {
    const a = sentenceSegmentsFor(groups, ONE_SENTENCE, 't1')
    const b = sentenceSegmentsFor(groups, ONE_SENTENCE, 't1')
    expect(a).not.toBe(b)
    expect(sameSentenceSegments(a, b)).toBe(true)
  })

  test('a changed word text is a change', () => {
    const a = sentenceSegmentsFor(groups, ONE_SENTENCE, 't1')
    const edited = [{ ...groups[0], words: [{ ...SIX[0], word: 'ONE' }, ...SIX.slice(1, 3)] }, groups[1]]
    const b = sentenceSegmentsFor(edited, ONE_SENTENCE, 't1')
    expect(sameSentenceSegments(a, b)).toBe(false)
  })

  test('a different number of rows is a change', () => {
    expect(
      sameSentenceSegments(
        sentenceSegmentsFor(groups, ONE_SENTENCE, 't1'),
        sentenceSegmentsFor(groups, TWO_SENTENCES, 't1')
      )
    ).toBe(false)
  })
})

// ── The text-view edit loop (plan §B: sentence → retime → reconcile) ──

describe('editing a sentence flows back into its chunks', () => {
  test('a one-word correction leaves the chunking and every other word alone', () => {
    // Arrange — one source sentence of six words, translated, then chunked into
    // two captions of three by `wordsPerGroup`.
    const source = makeSourceTrack()
    const oneSentence = buildWidToSegment(source.segments)
    const index = buildSourceIndex(source)
    const skeleton = createTrackFromSource(source, { id: 't1', lang: 'pl' })
    const baked = skeleton.groups.map((g, i) =>
      bakeTranslation(g, ['jeden dwa trzy', 'cztery piec szesc'][i], index)
    )
    const chunks = chunkTranslatedGroups(baked, 3, oneSentence)
    expect(chunks).toHaveLength(2)

    const segments = sentenceSegmentsFor(chunks, oneSentence, 't1')
    expect(segments).toHaveLength(1)
    expect(segments[0].text).toBe('jeden dwa trzy cztery piec szesc')

    // Act — the user fixes the fourth word in the Text view. That is exactly
    // SubtitleEditor's path: retimeWords over the sentence's own span.
    const edited: Segment = {
      ...segments[0],
      text: 'jeden dwa trzy CZTERY piec szesc',
      words: retimeWords(segments[0].words, tokenize('jeden dwa trzy CZTERY piec szesc'), {
        start: segments[0].start,
        end: segments[0].end,
      }),
    }
    const next = reconcileGroups(chunks, [edited], 3)

    // Assert — same two captions, one word different, everything else verbatim.
    expect(next).toHaveLength(2)
    expect(next.map((g) => g.text)).toEqual(['jeden dwa trzy', 'CZTERY piec szesc'])
    expect(next[0].words).toEqual(chunks[0].words)
    expect(next[1].words[1]).toEqual(chunks[1].words[1])
    expect(next[1].words[2]).toEqual(chunks[1].words[2])
    expect(next[1].words[0].wid).toBe(chunks[1].words[0].wid)
    expect(next[1].words[0].start).toBe(chunks[1].words[0].start)
    expect(next[1].words[0].end).toBe(chunks[1].words[0].end)

    // …and re-deriving the Text view from the new chunks is stable.
    expect(sentenceSegmentsFor(next, oneSentence, 't1')[0].text).toBe(
      'jeden dwa trzy CZTERY piec szesc'
    )
  })
})

// ── The QA shape: 12 sentences, 41 caption fragments ─────────────
//
// What live testing found: the source's Text view listed 12 sentences and the
// translated track's listed 41 — one row per source *group* — so the agent
// translated caption-sized fragments and `wordsPerGroup` could only ever cut
// inside one. This is that project, end to end.

/** Twelve sentences: five of twelve words, seven of nine. */
const SENTENCE_LENGTHS = [12, 12, 12, 12, 12, 9, 9, 9, 9, 9, 9, 9]

function bigSource(): CaptionTrack {
  let t = 0
  let n = 0
  const segments = SENTENCE_LENGTHS.map((count, si) => {
    const words: Word[] = []
    for (let i = 0; i < count; i++) {
      words.push(word(`w${n}`, t, t + 0.4, `sw${n}`))
      t += 0.4
      n += 1
    }
    // A beat between sentences, so nothing depends on them touching.
    t += 0.2
    return sourceSegment(words, `s${si}`)
  })
  return {
    id: SOURCE_TRACK_ID,
    label: 'Original',
    lang: 'en',
    isSource: true,
    segments,
    groups: buildStudioGroups(segments, 3),
    groupsEdited: false,
    segmentsEdited: false,
    settings: { ...STUDIO_DEFAULTS, wordsPerGroup: 3 },
    appliedPreset: null,
  }
}

describe('a 12-sentence project translated fragment by fragment', () => {
  const source = bigSource()
  const widToSegment = buildWidToSegment(source.segments)
  // Three words per fragment, the way an agent answers a 3-word source group.
  const texts = source.groups.map((_, i) => `a${i} b${i} c${i}`)
  const track = makeTranslatedTrack(source, texts)

  const sentenceOf = (g: Segment): number | undefined => sentenceIndexOf(g, widToSegment)

  test('the source is 12 sentences chunked into 41 captions', () => {
    expect(source.segments).toHaveLength(12)
    expect(source.groups).toHaveLength(41)
  })

  test('the translated Text view is 12 rows, not 41', () => {
    expect(track.groups).toHaveLength(41)
    expect(track.segments).toHaveLength(12)
    expect(track.segments.map((s) => s.id)).toEqual(
      SENTENCE_LENGTHS.map((_, i) => `t1:s${i}`)
    )
    // Each row is the whole sentence's translation, in order.
    expect(track.segments[0].text).toBe('a0 b0 c0 a1 b1 c1 a2 b2 c2 a3 b3 c3')
  })

  test('Words/Grp = 6 builds real six-word captions, never across a sentence', () => {
    const captions = chunkTranslatedGroups(track.groups, 6, widToSegment)

    for (const caption of captions) {
      expect(caption.words.length).toBeLessThanOrEqual(6)
      // Every source word the caption records is in ONE sentence.
      const sentences = new Set(
        (caption.sourceWords ?? []).map((r) => widToSegment.get(r.wid))
      )
      expect(sentences.size).toBe(1)
      expect(sentences.has(sentenceOf(caption))).toBe(true)
    }
    // …and the six-word caption the fragment-level chunker could never build.
    expect(captions.some((c) => c.words.length === 6)).toBe(true)
    // 12-word sentences → 6 + 6; 9-word sentences → 6 + 3.
    expect(captions).toHaveLength(24)
  })

  test('derive → reconcile → derive reaches a fixed point in one round', () => {
    // The two ResultsScreen effects in pure form: the Text view is derived from
    // the groups, and the groups are reconciled from the Text view. If the
    // second derivation were not content-equal to the first they would trigger
    // each other forever, which is what `sameSentenceSegments` prevents.
    const first = sentenceSegmentsFor(track.groups, widToSegment, 't1')
    const reconciled = reconcileGroups(track.groups, first, 3)
    const second = sentenceSegmentsFor(reconciled, widToSegment, 't1')

    expect(reconciled).toHaveLength(track.groups.length)
    expect(sameSentenceSegments(first, second)).toBe(true)
  })

  test('the fixed point holds after a Words/Grp re-chunk too', () => {
    const captions = chunkTranslatedGroups(track.groups, 6, widToSegment)
    const first = sentenceSegmentsFor(captions, widToSegment, 't1')
    const reconciled = reconcileGroups(captions, first, 6)
    const second = sentenceSegmentsFor(reconciled, widToSegment, 't1')

    expect(first).toHaveLength(12)
    expect(reconciled).toHaveLength(captions.length)
    expect(sameSentenceSegments(first, second)).toBe(true)
  })

  test('Words/Grp wide enough is one caption per sentence — exactly 12', () => {
    const captions = chunkTranslatedGroups(track.groups, 100, widToSegment)
    expect(captions).toHaveLength(12)
    expect(captions.map((c) => c.id)).toEqual(SENTENCE_LENGTHS.map((_, i) => `t1:s${i}`))
    expect(captions[0].words).toHaveLength(12)
  })
})
