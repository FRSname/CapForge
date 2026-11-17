import { describe, expect, test } from 'vitest'
import {
  BITRATE_OPTIONS,
  DEFAULT_QUICK_RENDER_BITRATE,
  parseQuickRenderBitrate,
} from './quickRender'

describe('parseQuickRenderBitrate', () => {
  test('every offered bitrate is kept', () => {
    for (const { value } of BITRATE_OPTIONS) {
      expect(parseQuickRenderBitrate(value)).toBe(value)
    }
  })

  test('anything else falls back to the default', () => {
    for (const value of [undefined, null, '', '12M', 40, '40m', { value: '8M' }]) {
      expect(parseQuickRenderBitrate(value)).toBe(DEFAULT_QUICK_RENDER_BITRATE)
    }
  })

  test('the default is one of the options and is still 40 Mbps', () => {
    // Changing this changes every user's quick render — do it on purpose.
    expect(DEFAULT_QUICK_RENDER_BITRATE).toBe('40M')
    expect(BITRATE_OPTIONS.map((o) => o.value)).toContain(DEFAULT_QUICK_RENDER_BITRATE)
  })

  test('the values are what the backend takes as video_bitrate', () => {
    for (const { value } of BITRATE_OPTIONS) expect(value).toMatch(/^\d+M$/)
  })
})
