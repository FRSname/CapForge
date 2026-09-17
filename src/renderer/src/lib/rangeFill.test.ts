import { describe, expect, test } from 'vitest'
import { rangeFill } from './rangeFill'

describe('rangeFill', () => {
  test('maps the value onto the track as a percentage', () => {
    expect(rangeFill(50, 0, 100)).toBe('50%')
    expect(rangeFill(0.25, 0, 1)).toBe('25%')
    expect(rangeFill(230, 140, 360)).toBe('40.9%')
  })

  test('fills nothing at min and everything at max', () => {
    expect(rangeFill(140, 140, 360)).toBe('0%')
    expect(rangeFill(360, 140, 360)).toBe('100%')
  })

  test('clamps a value outside the range to the nearest end', () => {
    expect(rangeFill(-5, 0, 100)).toBe('0%')
    expect(rangeFill(500, 0, 100)).toBe('100%')
  })

  test('fills nothing for a degenerate or non-finite range', () => {
    expect(rangeFill(5, 10, 10)).toBe('0%')
    expect(rangeFill(5, 10, 0)).toBe('0%')
    expect(rangeFill(Number.NaN, 0, 100)).toBe('0%')
  })
})
