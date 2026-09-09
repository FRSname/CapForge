import { describe, expect, test } from 'vitest'
import {
  SOURCE_TRACK_ID,
  createTrackFromSource,
  displayGroupsFor,
  newTrackId,
  reflowTrack,
  syncSegmentsIntoTrack,
  trackToMirrorEntry,
  type CaptionTrack,
} from './tracks'
import { classifyTrack, buildSourceIndex } from './trackStaleness'
import { bakeTranslation } from './trackTiming'
import { buildStudioGroups } from './groups'
import { chunkTranslatedGroups } from './trackChunking'
import { STUDIO_DEFAULTS } from '../components/studio/StudioPanel'
import {
  makeSourceTrack,
  makeTranslatedTrack,
  makeTwoSentenceSource,
  sentenceMapOf,
  sourceSegment,
  sourceWords,
  word,
} from './trackFixtures.testutil'
import type { Segment } from '../types/app'

const source = makeSourceTrack()

/** The default fixture is ONE source sentence cut into two captions. */
const sentences = sentenceMapOf(source)

function makePolish(src: CaptionTrack = source, texts = ['jeden dwa trzy', 'cztery piec szesc']) {
  return makeTranslatedTrack(src, texts)
}

// ── newTrackId ───────────────────────────────────────────────────

describe('newTrackId', () => {
  test('mints unique opaque ids that never collide with the source id', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newTrackId()))
    expect(ids.size).toBe(200)
    for (const id of ids) {
      expect(id.startsWith('t')).toBe(true)
      expect(id).not.toBe(SOURCE_TRACK_ID)
    }
  })
})

// ── createTrackFromSource ────────────────────────────────────────

describe('createTrackFromSource', () => {
  test('makes one blank group per source group, with the source timing', () => {
    const track = createTrackFromSource(source, { id: 't1', lang: 'pl' })
    expect(track.groups).toHaveLength(source.groups.length)
    track.groups.forEach((g, i) => {
      expect(g.id).toBe(`t1:${i}`)
      expect(g.text).toBe('')
      expect(g.words).toEqual([])
      expect(g.start).toBe(source.groups[i].start)
      expect(g.end).toBe(source.groups[i].end)
    })
  })

  test('records the source words behind each group as {wid, text} pairs', () => {
    const track = createTrackFromSource(source, { id: 't1', lang: 'pl' })
    expect(track.groups[0].sourceWords).toEqual([
      { wid: 's1w0', text: 'the' },
      { wid: 's1w1', text: 'quick' },
      { wid: 's1w2', text: 'brown' },
    ])
  })

  test('carries speaker, positionOverride and endEdited off the source group', () => {
    const decorated: CaptionTrack = {
      ...source,
      groups: [
        {
          ...source.groups[0],
          speaker: 'SPEAKER_01',
          positionOverride: { position_y: 0.2 },
          endEdited: true,
        },
        source.groups[1],
      ],
    }
    const g = createTrackFromSource(decorated, { id: 't1', lang: 'pl' }).groups[0]
    expect(g.speaker).toBe('SPEAKER_01')
    expect(g.positionOverride).toEqual({ position_y: 0.2 })
    expect(g.endEdited).toBe(true)
  })

  test('labels the track from the language and stamps the code', () => {
    const track = createTrackFromSource(source, { id: 't1', lang: 'pl' })
    expect(track.label).toBe('Polish')
    expect(track.lang).toBe('pl')
    expect(track.isSource).toBe(false)
    expect(track.groupsEdited).toBe(true)
    expect(track.segmentsEdited).toBe(false)
  })

  test('an explicit label wins over the language table', () => {
    expect(createTrackFromSource(source, { id: 't1', lang: 'pl', label: 'PL — draft' }).label).toBe(
      'PL — draft'
    )
  })

  test('segments are the source’s SENTENCES, not one row per caption', () => {
    // The fixture is one sentence of six words, chunked into two captions: the
    // Text view must show the sentence, or the agent translates fragments.
    const track = createTrackFromSource(source, { id: 't1', lang: 'pl' })
    expect(track.groups).toHaveLength(2)
    expect(track.segments).toHaveLength(1)
    expect(track.segments[0].id).toBe('t1:s0')
    expect(track.segments[0].text).toBe('')
    expect(track.segments[0].start).toBe(source.groups[0].start)
    expect(track.segments[0].end).toBe(source.groups[1].end)
  })

  test('two source sentences make two text units', () => {
    const track = createTrackFromSource(makeTwoSentenceSource(), { id: 't1', lang: 'pl' })
    expect(track.segments.map((s) => s.id)).toEqual(['t1:s0', 't1:s1'])
  })

  test('copies the source style, sanitized', () => {
    const dirty: CaptionTrack = {
      ...source,
      // The `shadowOpacity: 90` mistake — a percentage in a 0–1 field.
      settings: { ...STUDIO_DEFAULTS, shadowOpacity: 90 },
    }
    const track = createTrackFromSource(dirty, { id: 't1', lang: 'pl' })
    expect(track.settings.shadowOpacity).toBe(0.9)
  })

  test('an explicit settings override replaces the source style', () => {
    const track = createTrackFromSource(source, {
      id: 't1',
      lang: 'pl',
      settings: { ...STUDIO_DEFAULTS, fontSize: 200 },
    })
    expect(track.settings.fontSize).toBe(200)
    expect(track.appliedPreset).toBeNull()
  })

  test('records the source grouping snapshot', () => {
    const track = createTrackFromSource(source, { id: 't1', lang: 'pl' })
    expect(track.sourceSnapshot).toEqual({
      groupWids: [
        ['s1w0', 's1w1', 's1w2'],
        ['s1w3', 's1w4', 's1w5'],
      ],
    })
  })

  test('throws when any source word lacks a wid — identity is all-or-nothing', () => {
    const anonymous = makeSourceTrack(
      sourceWords().map((w, i) => (i === 4 ? { ...w, wid: undefined } : w))
    )
    expect(() => createTrackFromSource(anonymous, { id: 't1', lang: 'pl' })).toThrow(/word id/i)
  })

  test('does not mutate the source track', () => {
    const before = JSON.stringify(source)
    createTrackFromSource(source, { id: 't1', lang: 'pl' })
    expect(JSON.stringify(source)).toBe(before)
  })
})

// ── displayGroupsFor ─────────────────────────────────────────────

describe('displayGroupsFor', () => {
  test('closes short gaps and holds the last group using the track’s own settings', () => {
    const gappy = makeSourceTrack(sourceWords(), 3, {
      settings: { ...STUDIO_DEFAULTS, gapCloseThreshold: 0.5, lastGroupHold: 1 },
    })
    const spaced: CaptionTrack = {
      ...gappy,
      groups: [{ ...gappy.groups[0], end: 1.3 }, gappy.groups[1]],
    }
    const display = displayGroupsFor(spaced)
    expect(display[0].end).toBe(1.5) // gap of 0.2 s closed
    expect(display[1].end).toBe(4) // 3.0 + 1 s hold
    // Raw groups untouched — the pass is a derived view, never baked.
    expect(spaced.groups[0].end).toBe(1.3)
  })
})

// ── syncSegmentsIntoTrack ────────────────────────────────────────

describe('syncSegmentsIntoTrack', () => {
  test('rebuilds a source track’s groups from the segments', () => {
    const edited = [
      sourceSegment(
        sourceWords().map((w) => (w.word === 'fox' ? { ...w, word: 'lis' } : w))
      ),
    ]
    const next = syncSegmentsIntoTrack(source, edited, 3, false)
    expect(next.groups.map((g) => g.text)).toEqual(['the quick brown', 'lis jumps over'])
    expect(next.segments).toBe(edited)
  })

  test('carries position overrides across the rebuild by group id', () => {
    const withOverride: CaptionTrack = {
      ...source,
      groups: [{ ...source.groups[0], positionOverride: { position_y: 0.2 } }, source.groups[1]],
    }
    const next = syncSegmentsIntoTrack(withOverride, withOverride.segments, 3, false)
    expect(next.groups[0].positionOverride).toEqual({ position_y: 0.2 })
  })

  test('reconciles by word identity when the user edited the groups', () => {
    const merged: CaptionTrack = {
      ...source,
      groupsEdited: true,
      groups: [
        {
          ...source.groups[0],
          id: 'merged',
          end: source.groups[1].end,
          text: 'the quick brown fox jumps over',
          words: [...source.groups[0].words, ...source.groups[1].words],
        },
      ],
    }
    const edited = [
      sourceSegment(sourceWords().map((w) => (w.word === 'fox' ? { ...w, word: 'lis' } : w))),
    ]
    const next = syncSegmentsIntoTrack(merged, edited, 3, false)
    expect(next.groups).toHaveLength(1)
    expect(next.groups[0].text).toBe('the quick brown lis jumps over')
  })

  test('a words-per-group change re-chunks the source and clears the edited flag', () => {
    const merged: CaptionTrack = { ...source, groupsEdited: true }
    const next = syncSegmentsIntoTrack(merged, merged.segments, 2, true)
    expect(next.groups).toHaveLength(3)
    expect(next.groupsEdited).toBe(false)
  })

  test('a translated track NEVER takes the rebuild branch — its grouping is inherited', () => {
    const polish = makePolish()
    // groupsEdited false + wpgChanged false is the rebuild branch for a source
    // track; on a translated track it must still reconcile by identity.
    const next = syncSegmentsIntoTrack(
      { ...polish, groupsEdited: false },
      polish.segments,
      2,
      false
    )
    expect(next.groups).toHaveLength(polish.groups.length)
    expect(next.groups.map((g) => g.text)).toEqual(polish.groups.map((g) => g.text))
  })

  test('a words-per-group change re-chunks a translated track by SENTENCE', () => {
    // Two captions of three words, both written from the same source sentence:
    // the fragments are coalesced first, so N=2 cuts the sentence evenly rather
    // than cutting each fragment into 2 + 1.
    const polish = makePolish()

    const next = syncSegmentsIntoTrack(polish, polish.segments, 2, true, sentences)

    expect(next.groups.map((g) => g.text)).toEqual([
      'jeden dwa',
      'trzy cztery',
      'piec szesc',
    ])
    // Every chunk knows the whole sentence behind it.
    const sentenceWids = [
      ...(polish.groups[0].sourceWords ?? []),
      ...(polish.groups[1].sourceWords ?? []),
    ]
    for (const g of next.groups) expect(g.sourceWords).toEqual(sentenceWids)
    // Authored grouping — `custom_groups` must keep being sent.
    expect(next.groupsEdited).toBe(true)
    // …and the Text view still shows the one sentence.
    expect(next.segments).toHaveLength(1)
    expect(next.segments[0].text).toBe('jeden dwa trzy cztery piec szesc')
  })

  test('a words-per-group change never merges two sentences', () => {
    const twoSentences = makeTwoSentenceSource()
    const polish = makePolish(twoSentences)

    const next = syncSegmentsIntoTrack(
      polish,
      polish.segments,
      6,
      true,
      sentenceMapOf(twoSentences)
    )

    expect(next.groups.map((g) => g.text)).toEqual(['jeden dwa trzy', 'cztery piec szesc'])
  })

  test('a widened words-per-group folds the chunks back into one caption', () => {
    const polish = makePolish()
    const chunked = syncSegmentsIntoTrack(polish, polish.segments, 2, true, sentences)

    const back = syncSegmentsIntoTrack(chunked, chunked.segments, 6, true, sentences)

    // One sentence, one caption — the id is the sentence's.
    expect(back.groups.map((g) => g.text)).toEqual(['jeden dwa trzy cztery piec szesc'])
    expect(back.groups.map((g) => g.id)).toEqual(['t1:s0'])
  })

  test('an untranslated placeholder survives a text-view edit on its sentence', () => {
    // One sentence, two captions, the second still blank. Editing the sentence
    // must not drop the placeholder — it is a word-less group with a record
    // (`reconcileGroups` Rule 4's exception).
    const polish = makePolish(source, ['jeden dwa trzy', ''])
    expect(polish.segments).toHaveLength(1)

    const retimed = bakeTranslation(
      polish.segments[0],
      'jeden dwa cztery',
      buildSourceIndex(source)
    )
    const next = syncSegmentsIntoTrack(
      polish,
      [retimed],
      STUDIO_DEFAULTS.wordsPerGroup,
      false,
      sentences
    )

    expect(next.groups).toHaveLength(2)
    expect(next.groups[0].text).toBe('jeden dwa cztery')
    expect(next.groups[1].words).toEqual([])
    expect(next.groups[1].sourceWords).toEqual(polish.groups[1].sourceWords)
  })

  test('mints word ids for freshly introduced words', () => {
    const raw = [sourceSegment([word('nowe', 0, 0.4)])]
    const next = syncSegmentsIntoTrack(source, raw, 3, false)
    expect(next.segments[0].words[0].wid).toBeTruthy()
  })

  test('an unchanged sync reproduces the same groups', () => {
    const next = syncSegmentsIntoTrack(source, source.segments, 3, false)
    expect(next.segments).toBe(source.segments)
    expect(next.groups).toEqual(source.groups)
    expect(next.groupsEdited).toBe(source.groupsEdited)
  })
})

// ── reflowTrack ──────────────────────────────────────────────────

describe('reflowTrack', () => {
  const TWELVE = ['a1', 'b2', 'c3', 'd4', 'e5', 'f6', 'g7', 'h8', 'i9', 'j10', 'k11', 'l12']

  test('a wordsPerGroup 4→6 regroup blanks every group and keeps the old text as context', () => {
    const wide = makeSourceTrack(sourceWords(TWELVE), 4)
    const polish = {
      ...createTrackFromSource(wide, { id: 't1', lang: 'pl' }),
    }
    const idx = buildSourceIndex(wide)
    const texts = ['ONE', 'TWO', 'THREE']
    const filled: CaptionTrack = {
      ...polish,
      groups: polish.groups.map((g, i) => bakeTranslation(g, texts[i], idx)),
    }
    expect(filled.groups).toHaveLength(3)

    const regrouped = makeSourceTrack(sourceWords(TWELVE), 6)
    const next = reflowTrack(filled, regrouped)

    expect(next.groups).toHaveLength(2)
    for (const g of next.groups) {
      expect(g.text).toBe('')
      expect(g.words).toEqual([])
    }
    // New group 0 spans a1…f6, overlapping old ONE (a1–d4) and TWO (e5–h8).
    expect(next.groups[0].previousText).toBe('ONE / TWO')
    // New group 1 spans g7…l12, overlapping TWO and THREE.
    expect(next.groups[1].previousText).toBe('TWO / THREE')

    const oldIds = new Set(filled.groups.map((g) => g.id))
    for (const g of next.groups) expect(oldIds.has(g.id)).toBe(false)
    expect(new Set(next.groups.map((g) => g.id)).size).toBe(next.groups.length)
  })

  test('a group whose source wids are unchanged carries its translation verbatim', () => {
    const polish = makePolish()
    const extended = makeSourceTrack([
      ...sourceWords(),
      word('again', 3.0, 3.5, 's1w6'),
      word('later', 3.5, 4.0, 's1w7'),
      word('still', 4.0, 4.5, 's1w8'),
    ])
    const next = reflowTrack(polish, extended)

    expect(next.groups).toHaveLength(3)
    expect(next.groups[0].text).toBe(polish.groups[0].text)
    expect(next.groups[0].words).toEqual(polish.groups[0].words)
    expect(next.groups[0].previousText).toBeUndefined()
    expect(next.groups[1].text).toBe(polish.groups[1].text)
    expect(next.groups[1].previousText).toBeUndefined()
    // The genuinely new span is blank, with nothing to carry over.
    expect(next.groups[2].text).toBe('')
    expect(next.groups[2].previousText).toBeUndefined()
  })

  test('a caption chunked by words-per-group is carried over once, whole', () => {
    // Arrange — two source sentences, each caption cut into 2 + 1 words.
    const twoSentences = makeTwoSentenceSource()
    const polish = makePolish(twoSentences)
    const chunked: CaptionTrack = {
      ...polish,
      groups: chunkTranslatedGroups(polish.groups, 2, sentenceMapOf(twoSentences)),
    }
    expect(chunked.groups).toHaveLength(4)

    // Act — the source has not moved, so every caption should carry verbatim.
    const next = reflowTrack(chunked, twoSentences)

    // Assert — one carried group per source group, with the full translation.
    expect(next.groups).toHaveLength(2)
    expect(next.groups.map((g) => g.text)).toEqual(['jeden dwa trzy', 'cztery piec szesc'])
    for (const g of next.groups) expect(g.previousText).toBeUndefined()
  })

  test('a sentence-wide translation is carried across a source RE-GROUP, whole', () => {
    // Arrange — one 12-word sentence, source chunked 4/4/4, translated, then
    // re-chunked by `wordsPerGroup` so the whole sentence is one record.
    const wide = makeSourceTrack(sourceWords(TWELVE), 4)
    const polish = makeTranslatedTrack(wide, ['jeden dwa', 'trzy cztery', 'piec szesc'])
    const merged: CaptionTrack = {
      ...polish,
      groups: chunkTranslatedGroups(polish.groups, 3, sentenceMapOf(wide)),
    }
    expect(merged.groups).toHaveLength(2)
    expect(merged.groups[0].sourceWords).toHaveLength(12)

    // Act — the user regroups the source 4 → 6 words.
    const regrouped = makeSourceTrack(sourceWords(TWELVE), 6)
    const next = reflowTrack(merged, regrouped)

    // Assert — the translation spans a *run* of two new source groups, so it is
    // carried as the one caption it is, not blanked and not truncated.
    expect(next.groups).toHaveLength(1)
    expect(next.groups[0].text).toBe('jeden dwa trzy cztery piec szesc')
    expect(next.groups[0].start).toBe(regrouped.groups[0].start)
    expect(next.groups[0].end).toBe(regrouped.groups[1].end)
    expect(next.groups[0].previousText).toBeUndefined()
    expect(classifyTrack(next, regrouped).reflowNeeded).toBe(false)
  })

  test('a sentence whose source gained a word comes back blank, with context', () => {
    const wide = makeSourceTrack(sourceWords(TWELVE), 4)
    const polish = makeTranslatedTrack(wide, ['jeden dwa', 'trzy cztery', 'piec szesc'])
    const merged: CaptionTrack = {
      ...polish,
      groups: chunkTranslatedGroups(polish.groups, 3, sentenceMapOf(wide)),
    }

    // A word inserted INSIDE the sentence, with an id of its own — the old
    // record can no longer be any run of the new source groups.
    const grownWords = [...sourceWords(TWELVE)]
    grownWords.splice(6, 0, word('extra', 2.9, 3.0, 'sX'))
    const grown = makeSourceTrack(grownWords, 4)

    const next = reflowTrack(merged, grown)

    expect(next.groups.every((g) => g.text === '')).toBe(true)
    expect(next.groups[0].previousText).toContain('jeden dwa trzy')
  })

  test('carries timingLinked and endEdited on a carried group', () => {
    const polish = makePolish()
    const pinned: CaptionTrack = {
      ...polish,
      groups: [{ ...polish.groups[0], timingLinked: false, endEdited: true }, polish.groups[1]],
    }
    const next = reflowTrack(pinned, source)
    expect(next.groups[0].timingLinked).toBe(false)
    expect(next.groups[0].endEdited).toBe(true)
  })

  test('re-records the source snapshot so reflowNeeded clears', () => {
    const polish = makePolish()
    const regrouped = makeSourceTrack(sourceWords(), 2)
    expect(classifyTrack(polish, regrouped).reflowNeeded).toBe(true)
    const next = reflowTrack(polish, regrouped)
    expect(classifyTrack(next, regrouped).reflowNeeded).toBe(false)
  })

  test('ids from a second reflow never collide with the first', () => {
    const once = reflowTrack(makePolish(), makeSourceTrack(sourceWords(), 2))
    const twice = reflowTrack(once, makeSourceTrack(sourceWords(), 2))
    const first = new Set(once.groups.map((g) => g.id))
    for (const g of twice.groups) expect(first.has(g.id)).toBe(false)
  })

  test('the reflowed skeleton takes the source timing and re-records sourceWords', () => {
    const regrouped = makeSourceTrack(sourceWords(), 2)
    const next = reflowTrack(makePolish(), regrouped)
    next.groups.forEach((g, i) => {
      expect(g.start).toBe(regrouped.groups[i].start)
      expect(g.end).toBe(regrouped.groups[i].end)
      expect(g.sourceWords?.map((s) => s.wid)).toEqual(regrouped.groups[i].words.map((w) => w.wid))
    })
  })

  test('refuses a source it cannot identify', () => {
    const anonymous = makeSourceTrack(
      sourceWords().map((w, i) => (i === 1 ? { ...w, wid: undefined } : w))
    )
    expect(() => reflowTrack(makePolish(), anonymous)).toThrow(/word id/i)
  })

  test('does not mutate the track it reflows', () => {
    const polish = makePolish()
    const before = JSON.stringify(polish)
    reflowTrack(polish, makeSourceTrack(sourceWords(), 2))
    expect(JSON.stringify(polish)).toBe(before)
  })
})

// ── trackToMirrorEntry ───────────────────────────────────────────

describe('trackToMirrorEntry', () => {
  test('the source entry carries no per-group translation state and no suffix', () => {
    const entry = trackToMirrorEntry(source, source, classifyTrack(source, source))
    expect(entry.id).toBe(SOURCE_TRACK_ID)
    expect(entry.isSource).toBe(true)
    expect(entry.groupCount).toBe(2)
    // The suffix rides the *request* body, never VideoRenderConfig — a track is
    // not a style (Phase 0 anti-patterns).
    expect(entry.render.config.output_name_suffix).toBeUndefined()
    expect(entry.render.output_name_suffix).toBeUndefined()
    expect(entry.groups[0]).toEqual({
      id: source.groups[0].id,
      start: source.groups[0].start,
      end: source.groups[0].end,
      text: source.groups[0].text,
    })
  })

  test('a translated entry carries state, sourceText, previousText and a filename suffix', () => {
    const polish = makePolish()
    const entry = trackToMirrorEntry(polish, source, classifyTrack(polish, source))
    expect(entry.lang).toBe('pl')
    expect(entry.staleCount).toBe(0)
    expect(entry.untranslatedCount).toBe(0)
    expect(entry.reflowNeeded).toBe(false)
    expect(entry.groups[0]).toMatchObject({
      state: 'clean',
      sourceText: 'the quick brown',
      previousText: null,
    })
    expect(entry.render.output_name_suffix).toBe('.pl')
  })

  test('never mirrors words inside the compact group list', () => {
    const entry = trackToMirrorEntry(makePolish(), source, classifyTrack(makePolish(), source))
    for (const g of entry.groups) expect('words' in g).toBe(false)
  })

  test('the render body is the same one the UI renders with (gaps closed)', () => {
    const polish = makePolish()
    const entry = trackToMirrorEntry(polish, source, classifyTrack(polish, source))
    expect(entry.render.custom_groups).toHaveLength(2)
    expect(entry.render.custom_groups![0].end).toBe(displayGroupsFor(polish)[0].end)
  })

  test('an untranslated group is counted and reported', () => {
    const half = makePolish(source, ['jeden dwa trzy', ''])
    const entry = trackToMirrorEntry(half, source, classifyTrack(half, source))
    expect(entry.untranslatedCount).toBe(1)
    expect(entry.groups[1].state).toBe('untranslated')
    // Correction 4: no renderer ever sees a word-less group.
    expect(entry.render.custom_groups).toHaveLength(1)
  })
})

// ── sanity ───────────────────────────────────────────────────────

test('the fixture source chunks the way the tables assume', () => {
  const groups: Segment[] = buildStudioGroups([sourceSegment()], 3)
  expect(groups.map((g) => g.words.length)).toEqual([3, 3])
})
