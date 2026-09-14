/**
 * `lib/youtubeRules.ts` — the display-only half of the publish rules.
 *
 * `formatTimestamp` is a **twin** of `backend/library/package.py`'s
 * `format_timestamp`, so it is pinned against the shared fixture
 * `backend/tests/fixtures/timestamp_cases.json` exactly the way the RSVP
 * scalars are. The fixture is written by the backend side of this deliverable;
 * until it lands the pinning test skips (loudly) and only the local cases run.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import type { Chapter, Moment } from './publishTypes'
import type { Segment, Word } from '../types/app'
import {
  CHAPTER_MIN_GAP_S,
  DESCRIPTION_MAX_BYTES,
  HOOK_CHARS,
  OPENING_CHAPTER_TITLE,
  TAGS_MAX_CHARS,
  TITLE_MAX_CHARS,
  chapterSuggestions,
  formatTimestamp,
  plainTranscript,
  snapToWordStart,
  youtubeIdFromUrl,
} from './youtubeRules'

const FIXTURE = join(process.cwd(), 'backend/tests/fixtures/timestamp_cases.json')

function word(start: number): Word {
  return { word: 'w', start, end: start + 0.2 }
}

function moment(start: number, text: string, over: Partial<Moment> = {}): Moment {
  return { text, start, end: start + 1, word_id: `w${start}`, ...over }
}

describe('formatTimestamp', () => {
  test('writes MM:SS under the hour and H:MM:SS above it', () => {
    expect(formatTimestamp(0)).toBe('00:00')
    expect(formatTimestamp(9)).toBe('00:09')
    expect(formatTimestamp(65)).toBe('01:05')
    expect(formatTimestamp(599)).toBe('09:59')
    expect(formatTimestamp(3600)).toBe('1:00:00')
    expect(formatTimestamp(3725)).toBe('1:02:05')
  })

  test('floors fractions and clamps what cannot be a timestamp', () => {
    // A chapter starting at 9.9s is still inside the 9th second.
    expect(formatTimestamp(9.9)).toBe('00:09')
    expect(formatTimestamp(-5)).toBe('00:00')
    expect(formatTimestamp(Number.NaN)).toBe('00:00')
  })

  const pinned = existsSync(FIXTURE) ? test : test.skip
  pinned('matches the shared fixture the Python twin is pinned against', () => {
    const cases = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Array<{
      seconds: number
      expected: string
    }>
    expect(cases.length).toBeGreaterThan(0)
    for (const c of cases) {
      expect(`${c.seconds} → ${formatTimestamp(c.seconds)}`).toBe(`${c.seconds} → ${c.expected}`)
    }
  })
})

describe('youtubeIdFromUrl', () => {
  test('reads the id out of every shape a user can paste', () => {
    expect(youtubeIdFromUrl('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(youtubeIdFromUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s')).toBe(
      'dQw4w9WgXcQ'
    )
    expect(youtubeIdFromUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(youtubeIdFromUrl('https://www.youtube.com/live/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(youtubeIdFromUrl('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(youtubeIdFromUrl('  https://youtu.be/abc_-123  ')).toBe('abc_-123')
  })

  test('returns null for anything that is not a YouTube link', () => {
    expect(youtubeIdFromUrl('')).toBeNull()
    expect(youtubeIdFromUrl('not a url')).toBeNull()
    expect(youtubeIdFromUrl('https://vimeo.com/12345')).toBeNull()
  })
})

describe('snapToWordStart', () => {
  const words = [word(0.4), word(2), word(5.5)]

  test('snaps back to the word the playhead is inside', () => {
    expect(snapToWordStart(2.4, words)).toBe(2)
    expect(snapToWordStart(5.5, words)).toBe(5.5)
  })

  test('leaves the playhead alone in the lead-in, so 00:00 stays reachable', () => {
    // Snapping *forward* to 0.4 would push the opening chapter off 00:00.
    expect(snapToWordStart(0, words)).toBe(0)
    expect(snapToWordStart(0, [])).toBe(0)
  })
})

describe('chapterSuggestions', () => {
  test('spreads candidates out by the minimum gap and labels them', () => {
    const suggestions = chapterSuggestions(
      [
        moment(30, 'Setting up the project from scratch today'),
        // 4s later — inside the minimum gap, so it is not a second chapter.
        moment(34, 'still the same topic'),
        moment(90, 'Now the render pipeline'),
      ],
      []
    )

    expect(suggestions.map((c) => c.start_s)).toEqual([0, 30, 90])
    // Labels are the first few words, capped.
    expect(suggestions[1].title).toBe('Setting up the project from scratch')
    expect(suggestions[0].title).toBe(OPENING_CHAPTER_TITLE)
  })

  test('never lands on top of a chapter the user already wrote', () => {
    const existing: Chapter[] = [{ start_s: 0, title: 'Welcome' }]
    const suggestions = chapterSuggestions(
      [moment(5, 'too close'), moment(120, 'far enough')],
      existing
    )

    // The opener is already covered, and the 5s moment is inside its gap.
    expect(suggestions).toEqual([{ start_s: 120, title: 'far enough' }])
  })

  test('drops moments with no words to label them with', () => {
    expect(chapterSuggestions([moment(200, '   ')], [{ start_s: 0, title: 'Intro' }])).toEqual([])
  })

  test('honours a caller-supplied gap', () => {
    // 50s apart: the opener claims 00:00 first, the 30s moment falls inside
    // its gap and only the 60s one is far enough out.
    const wide = chapterSuggestions([moment(30, 'a'), moment(60, 'b')], [], CHAPTER_MIN_GAP_S * 5)
    expect(wide.map((c) => c.start_s)).toEqual([0, 60])
  })

  test('a moment near the start never stands in for the opener', () => {
    // YouTube reads the first chapter at 00:00. A pause 4s in cannot open the
    // list, so the Intro row is added and the 4s moment is inside its gap —
    // the old behaviour suggested [4s] alone, which the validator then refused.
    expect(
      chapterSuggestions([moment(4, 'They usually struggle'), moment(14, 'I built my own')], [])
    ).toEqual([
      { start_s: 0, title: OPENING_CHAPTER_TITLE },
      { start_s: 14, title: 'I built my own' },
    ])
  })
})

describe('plainTranscript', () => {
  test('joins sentences with a blank line and drops the empty ones', () => {
    const segments = [
      { id: '1', start: 0, end: 1, text: ' Hello there. ', words: [] },
      { id: '2', start: 1, end: 2, text: '', words: [] },
      { id: '3', start: 2, end: 3, text: 'Second sentence.', words: [] },
    ] as Segment[]

    expect(plainTranscript(segments)).toBe('Hello there.\n\nSecond sentence.')
  })
})

describe('the display limits', () => {
  test('are the YouTube numbers the meters draw against', () => {
    expect(TITLE_MAX_CHARS).toBe(100)
    expect(DESCRIPTION_MAX_BYTES).toBe(5000)
    expect(TAGS_MAX_CHARS).toBe(500)
    expect(HOOK_CHARS).toBe(150)
    expect(CHAPTER_MIN_GAP_S).toBe(10)
  })
})
