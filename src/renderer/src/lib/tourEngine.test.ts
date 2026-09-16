/**
 * Stepping a tour, and the two pieces of memory around it: which tours have
 * been seen, and whether the editor tour is due.
 *
 * All pure, so `useTour` can stay a thin shell over the DOM.
 */

import { describe, expect, test } from 'vitest'
import {
  firstIndex,
  firstVideoTourDue,
  nextIndex,
  parseToursSeen,
  previousIndex,
  stepSeen,
} from './tourEngine'
import type { Tour } from './tourSteps'

const TOUR: Tour = {
  id: 'getting-around',
  title: 'Getting around',
  screen: 'library',
  steps: [
    { id: 'welcome', title: 'Welcome', paragraphs: ['One.'] },
    { id: 'here', title: 'Here', paragraphs: ['Two.'], target: 'here' },
    { id: 'maybe', title: 'Maybe', paragraphs: ['Three.'], target: 'maybe', optional: true },
    { id: 'finish', title: 'Finish', paragraphs: ['Four.'] },
  ],
}

/** Everything is on screen. */
const ALL = () => true
/** The optional step's target is missing. */
const NO_MAYBE = (target?: string) => target !== 'maybe'

describe('nextIndex', () => {
  test('walks the steps in order while every target is present', () => {
    expect(nextIndex(TOUR, 0, ALL)).toBe(1)
    expect(nextIndex(TOUR, 1, ALL)).toBe(2)
    expect(nextIndex(TOUR, 2, ALL)).toBe(3)
  })

  test('skips an optional step whose target is not on screen', () => {
    expect(nextIndex(TOUR, 1, NO_MAYBE)).toBe(3)
  })

  test('null past the last step: the tour is over', () => {
    expect(nextIndex(TOUR, 3, ALL)).toBeNull()
  })

  test('a required step is shown even with its target missing', () => {
    const present = (target?: string) => target !== 'here'
    expect(nextIndex(TOUR, 0, present)).toBe(1)
  })
})

describe('previousIndex', () => {
  test('walks back', () => {
    expect(previousIndex(TOUR, 3, ALL)).toBe(2)
    expect(previousIndex(TOUR, 1, ALL)).toBe(0)
  })

  test('skips the same absent optional step on the way back', () => {
    expect(previousIndex(TOUR, 3, NO_MAYBE)).toBe(1)
  })

  test('null on the first step: there is nothing behind it', () => {
    expect(previousIndex(TOUR, 0, ALL)).toBeNull()
  })
})

describe('firstIndex', () => {
  test('is the first showable step', () => {
    expect(firstIndex(TOUR, ALL)).toBe(0)
  })

  test('skips a leading optional step that is not there', () => {
    const optionalFirst: Tour = {
      ...TOUR,
      steps: [TOUR.steps[2], TOUR.steps[0]],
    }
    expect(firstIndex(optionalFirst, NO_MAYBE)).toBe(1)
  })

  test('null when a tour has nothing to show', () => {
    const empty: Tour = { ...TOUR, steps: [TOUR.steps[2]] }
    expect(firstIndex(empty, NO_MAYBE)).toBeNull()
  })
})

describe('stepSeen', () => {
  test('appends a tour id', () => {
    expect(stepSeen([], 'getting-around')).toEqual(['getting-around'])
    expect(stepSeen(['getting-around'], 'first-video')).toEqual(['getting-around', 'first-video'])
  })

  test('never duplicates, and never mutates what it was given', () => {
    const seen = ['first-video'] as const
    expect(stepSeen(seen, 'first-video')).toEqual(['first-video'])
    expect(seen).toEqual(['first-video'])
  })
})

describe('parseToursSeen', () => {
  test('keeps the ids it knows and drops everything else', () => {
    expect(parseToursSeen(['first-video', 'nonsense', 7, null])).toEqual(['first-video'])
  })

  test('anything that is not a list reads as nothing seen', () => {
    expect(parseToursSeen(null)).toEqual([])
    expect(parseToursSeen('first-video')).toEqual([])
    expect(parseToursSeen(undefined)).toEqual([])
  })

  test('a repeated id is kept once', () => {
    expect(parseToursSeen(['first-video', 'first-video'])).toEqual(['first-video'])
  })
})

describe('firstVideoTourDue', () => {
  test('due the first time the results screen is shown', () => {
    expect(firstVideoTourDue('results', [])).toBe(true)
  })

  test('not due anywhere else', () => {
    expect(firstVideoTourDue('library', [])).toBe(false)
    expect(firstVideoTourDue('progress', [])).toBe(false)
  })

  test('not due once it has been seen', () => {
    expect(firstVideoTourDue('results', ['first-video'])).toBe(false)
  })

  test('not due while the seen list is still being read', () => {
    expect(firstVideoTourDue('results', null)).toBe(false)
  })
})
