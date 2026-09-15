/**
 * The pure half of App's source-timing link, moved out of `App.tsx` into
 * `useSourceTimingLink`. The hook is only an effect around `relinkTracks`; the
 * node test environment cannot run effects, so the decision is pinned here.
 */

import { describe, expect, test } from 'vitest'
import type { CaptionTrack } from '../lib/tracks'
import { makeSourceTrack, makeTranslatedTrack, sentenceMapOf } from '../lib/trackFixtures.testutil'
import { relinkTracks } from './useSourceTimingLink'

const source = makeSourceTrack()

function polishOver(src: CaptionTrack): CaptionTrack {
  return makeTranslatedTrack(src, ['jeden dwa trzy', 'cztery piec szesc'])
}

describe('relinkTracks', () => {
  test('a single-track project moves nothing and hands the list back untouched', () => {
    const tracks = [source]
    const result = relinkTracks(tracks, source, sentenceMapOf(source))
    expect(result.moved).toEqual([])
    expect(result.tracks).toBe(tracks)
  })

  test('a translated track that is already linked is not reported as moved', () => {
    const tracks = [source, polishOver(source)]
    const result = relinkTracks(tracks, source, sentenceMapOf(source))
    expect(result.moved).toEqual([])
    expect(result.tracks).toBe(tracks)
  })

  test('a source drag moves the linked translated track and names it', () => {
    const polish = polishOver(source)
    const dragged: CaptionTrack = {
      ...source,
      groups: [{ ...source.groups[0], end: source.groups[0].end + 0.2 }, source.groups[1]],
    }

    const result = relinkTracks([dragged, polish], dragged, sentenceMapOf(dragged))

    expect(result.moved).toEqual([polish.id])
    expect(result.tracks[0]).toBe(dragged)
    expect(result.tracks[1].groups[0].end).toBeCloseTo(polish.groups[0].end + 0.2, 9)
    // The input list is never mutated.
    expect(polish.groups[0].end).toBe(source.groups[0].end)
  })
})
