import { describe, expect, test } from 'vitest'
import { WAVEFORM_OPTIONS } from './waveformOptions'

describe('WAVEFORM_OPTIONS', () => {
  test('press-and-hold on the waveform scrubs without a debounce', () => {
    // A plain `true` would seek 200 ms behind the pointer.
    expect(WAVEFORM_OPTIONS.dragToSeek).toEqual({ debounceTime: 0 })
  })
})
