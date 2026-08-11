import { describe, it, expect } from 'vitest'
import { clampCommittedValue } from './StudioRow'

/**
 * The manual-entry clamp of StudioRow.
 *
 * Tested through the extracted pure helper rather than the component: the
 * frontend test environment is `node`, not jsdom (components render via
 * react-dom/server to static HTML), so there is no blur/Enter to simulate.
 *
 * The third argument is `commitMax` — the highest value the *setting* may hold,
 * mirroring a `Field(..., le=…)` on `VideoRenderConfig`. It is not the slider's
 * `max`, which never limits a typed value.
 */
describe('clampCommittedValue', () => {
  it('clamps below-min values up to min', () => {
    expect(clampCommittedValue(-5, 0)).toBe(0)
    expect(clampCommittedValue(-5, 0, 100)).toBe(0)
  })

  it('lets any value through when no commitMax is declared (the default)', () => {
    // The deliberate escape hatch every pre-existing row relies on: posX/posY
    // past the frame, an oversized maxWidth, a >100% bgOpacity typo the user
    // meant. Omitting the prop is what keeps those unchanged.
    expect(clampCommittedValue(150, 0)).toBe(150)
    expect(clampCommittedValue(150, 0, undefined)).toBe(150)
  })

  it('clamps a value above commitMax down to it', () => {
    // Edge fade: row unit %, backend rsvp_edge_fade le=0.5 → commitMax 50.
    // Typing "60" reads as a sane 60% fade and would 422 the render.
    expect(clampCommittedValue(60, 0, 50)).toBe(50)
    // Focus column / Context: le=1.0 in fraction terms, so 100 in row units.
    expect(clampCommittedValue(150, 0, 100)).toBe(100)
  })

  it('bounds Slide by its schema limit, not its slider max', () => {
    // The whole point of commitMax being a number rather than "clamp to max":
    // the Slide slider stops at 0.3s, but rsvp_slide_duration is le=1.0, so a
    // typed 0.5 is a legitimate override the backend accepts...
    expect(clampCommittedValue(0.5, 0, 1)).toBe(0.5)
    expect(clampCommittedValue(0.9, 0, 1)).toBe(0.9)
    // ...while 2 is outside the bound and must not be stored.
    expect(clampCommittedValue(2, 0, 1)).toBe(1)
  })

  it('leaves an in-range value untouched either way', () => {
    expect(clampCommittedValue(35, 0)).toBe(35)
    expect(clampCommittedValue(35, 0, 100)).toBe(35)
    expect(clampCommittedValue(0.06, 0, 1)).toBe(0.06)
  })

  it('returns null for a non-finite draft so the edit is dropped', () => {
    for (const raw of [NaN, Infinity, -Infinity]) {
      expect(clampCommittedValue(raw, 0)).toBeNull()
      expect(clampCommittedValue(raw, 0, 100)).toBeNull()
    }
  })

  it('still applies min when commitMax is absent or not a number', () => {
    expect(clampCommittedValue(-2, 1)).toBe(1)
    expect(clampCommittedValue(999, 1, undefined)).toBe(999)
    expect(clampCommittedValue(999, 1, NaN)).toBe(999)
    expect(clampCommittedValue(-2, 1, NaN)).toBe(1)
  })
})
