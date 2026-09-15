/**
 * `lib/publishThumbnail.ts` — the Thumbnail card's edits, and the one rule the
 * write path depends on: **`candidates` always comes from the latest record**,
 * never from the draft, because only the frames routes may change that list
 * and a `PATCH` carrying a different one is refused (`candidates_managed`).
 */

import { describe, expect, test } from 'vitest'
import type { Thumbnail, ThumbnailIdea } from './publishMediaTypes'
import {
  addIdea,
  authoredThumbnail,
  composeThumbnailPatch,
  coverSavedMessage,
  frameFailureMessage,
  removeIdea,
  setCover,
  toggleRecommended,
  updateIdea,
  withManagedCandidates,
} from './publishThumbnail'

const A = `${'a'.repeat(32)}.jpg`
const B = `${'b'.repeat(32)}.jpg`
const C = `${'c'.repeat(32)}.jpg`

function idea(label: string, recommended = false): ThumbnailIdea {
  return { label, type: 'face', headline: label, recommended }
}

function thumb(over: Partial<Thumbnail> = {}): Thumbnail {
  return { ideas: [], candidates: [A, B], cover: null, ...over }
}

describe('setCover', () => {
  test('sets and clears the cover without touching the input', () => {
    const before = thumb()
    const after = setCover(before, B)
    expect(after.cover).toBe(B)
    expect(before.cover).toBeNull()
    expect(setCover(after, null).cover).toBeNull()
  })
})

describe('ideas', () => {
  test('toggleRecommended leaves exactly one idea recommended', () => {
    const t = thumb({ ideas: [idea('x', true), idea('y'), idea('z')] })
    const next = toggleRecommended(t, 2)
    expect(next.ideas.map((i) => i.recommended)).toEqual([false, false, true])
    // Clicking the recommended one again keeps it — a radio, not a checkbox.
    expect(toggleRecommended(next, 2).ideas.map((i) => i.recommended)).toEqual([false, false, true])
    expect(t.ideas[0].recommended).toBe(true)
  })

  test('the first idea added is the recommended one; later ones are not', () => {
    const one = addIdea(thumb())
    expect(one.ideas).toHaveLength(1)
    expect(one.ideas[0].recommended).toBe(true)
    const two = addIdea(one)
    expect(two.ideas.map((i) => i.recommended)).toEqual([true, false])
  })

  test('removing the recommended idea hands the mark to the first remaining one', () => {
    const t = thumb({ ideas: [idea('x'), idea('y', true), idea('z')] })
    expect(removeIdea(t, 1).ideas.map((i) => [i.label, i.recommended])).toEqual([
      ['x', true],
      ['z', false],
    ])
    expect(removeIdea(t, 0).ideas.map((i) => i.recommended)).toEqual([true, false])
    expect(removeIdea(thumb({ ideas: [idea('x', true)] }), 0).ideas).toEqual([])
  })

  test('updateIdea edits one row and never its recommended mark', () => {
    const t = thumb({ ideas: [idea('x', true), idea('y')] })
    const next = updateIdea(t, 1, { headline: 'New', type: 'diagram' })
    expect(next.ideas[1]).toEqual({
      label: 'y',
      type: 'diagram',
      headline: 'New',
      recommended: false,
    })
    expect(next.ideas[0]).toBe(t.ideas[0])
  })
})

describe('composeThumbnailPatch', () => {
  test('takes candidates from the latest record even when the draft holds an older list', () => {
    // Edited when the record had [A, B]; a frame C was grabbed before the send.
    const draft = thumb({ candidates: [A, B], cover: B, ideas: [idea('x', true)] })
    const latest = { thumbnail: thumb({ candidates: [A, B, C] }) }

    const patch = composeThumbnailPatch(draft, latest)

    expect(patch.candidates).toEqual([A, B, C])
    expect(patch.candidates).not.toBe(draft.candidates)
    expect(patch.cover).toBe(B)
    expect(patch.ideas).toBe(draft.ideas)
  })

  test('a frame deleted since the edit never rides back in', () => {
    const draft = thumb({ candidates: [A, B, C], cover: A })
    const patch = composeThumbnailPatch(draft, { thumbnail: thumb({ candidates: [A] }) })
    expect(patch.candidates).toEqual([A])
  })

  test('a cover whose frame is gone is sent as no cover, not refused as a stale name', () => {
    const draft = thumb({ candidates: [A, B], cover: B })
    const patch = composeThumbnailPatch(draft, { thumbnail: thumb({ candidates: [A] }) })
    expect(patch.cover).toBeNull()
  })

  test('does not mutate the draft or the record', () => {
    const draft = thumb({ candidates: [A], cover: B })
    const latest = { thumbnail: thumb({ candidates: [A, B] }) }
    composeThumbnailPatch(draft, latest)
    expect(draft).toEqual(thumb({ candidates: [A], cover: B }))
    expect(latest.thumbnail.candidates).toEqual([A, B])
  })
})

describe('withManagedCandidates', () => {
  const latest = { thumbnail: thumb({ candidates: [A, B, C] }) }

  test('rewrites only the thumbnail entry of a patch, leaving the rest by identity', () => {
    const chapters = [{ start_s: 0, title: 'Intro' }]
    const patch = { chapters, thumbnail: thumb({ candidates: [A] }) }
    const wire = withManagedCandidates(patch, latest)

    expect(wire.chapters).toBe(chapters)
    expect((wire.thumbnail as Thumbnail).candidates).toEqual([A, B, C])
    // The drafts object it was built from is untouched, so settling by identity still works.
    expect(patch.thumbnail.candidates).toEqual([A])
  })

  test('a patch without a thumbnail passes through as the same object', () => {
    const patch = { title: 'T' }
    expect(withManagedCandidates(patch, latest)).toBe(patch)
  })

  test('a Revert patch (a raw history prev) is normalised, then composed', () => {
    const wire = withManagedCandidates({ thumbnail: { cover: A, candidates: [A] } }, latest)
    expect(wire.thumbnail).toEqual({ ideas: [], candidates: [A, B, C], cover: A })
  })
})

describe('messages', () => {
  test('a failed grab names the timestamp and the backend’s reason', () => {
    expect(frameFailureMessage({ time_s: 3725.4, reason: 'past the end' })).toBe(
      'Could not grab the frame at 1:02:05: past the end'
    )
    expect(frameFailureMessage({ time_s: 12, reason: '' })).toBe(
      'Could not grab the frame at 00:12'
    )
  })

  test('a saved cover says where it went', () => {
    expect(coverSavedMessage('/Users/u/Desktop/t.jpg')).toBe(
      'Saved the cover to /Users/u/Desktop/t.jpg'
    )
  })
})

describe('authoredThumbnail', () => {
  test('is what a user can write: everything but candidates', () => {
    expect(authoredThumbnail(thumb({ cover: A, ideas: [idea('x')] }))).toEqual({
      cover: A,
      ideas: [idea('x')],
    })
  })
})
