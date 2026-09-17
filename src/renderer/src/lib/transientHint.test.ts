import { describe, expect, it } from 'vitest'

import { HINT_VISIBLE_MS, firstReveal } from './transientHint'

describe('firstReveal', () => {
  it('reveals an unseen id once', () => {
    const seen = new Set<string>()
    expect(firstReveal(seen, 'video-zoom')).toBe(true)
  })

  it('refuses the same id afterwards', () => {
    const seen = new Set<string>()
    firstReveal(seen, 'video-zoom')
    expect(firstReveal(seen, 'video-zoom')).toBe(false)
    expect(firstReveal(seen, 'video-zoom')).toBe(false)
  })

  it('keeps ids independent', () => {
    const seen = new Set<string>()
    expect(firstReveal(seen, 'video-zoom')).toBe(true)
    expect(firstReveal(seen, 'timeline-zoom')).toBe(true)
    expect(firstReveal(seen, 'video-zoom')).toBe(false)
    expect(firstReveal(seen, 'timeline-zoom')).toBe(false)
  })

  it('records the id it revealed', () => {
    const seen = new Set<string>()
    firstReveal(seen, 'video-zoom')
    expect([...seen]).toEqual(['video-zoom'])
  })

  it('shows a hint long enough to read', () => {
    expect(HINT_VISIBLE_MS).toBe(2500)
  })
})
