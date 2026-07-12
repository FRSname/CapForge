import { describe, expect, test } from 'vitest'
import { buildRenderBody, dirname } from './render'
import { STUDIO_DEFAULTS } from '../components/studio/StudioPanel'
import type { Segment } from '../types/app'

/**
 * Golden object for buildRenderBody(STUDIO_DEFAULTS, …).
 *
 * This is the camelCase → snake_case bridge contract with the Python backend
 * (VideoRenderConfig in backend/models/schemas.py). If a field is added,
 * renamed, or its unit conversion changes, this test MUST fail — update it
 * together with the backend model, never casually.
 */
const GOLDEN_DEFAULT_CONFIG = {
  font_family: '',
  custom_font_path: null,
  font_size: 150,
  bold: false,
  tracking: 0,
  word_spacing: 0,

  stroke_width: 0,
  stroke_color: '#000000',

  text_color: '#FFFFFF',
  active_word_color: '#F5C842',

  bg_color: '#D4952A',
  bg_opacity: 0,
  bg_padding_h: 8,
  bg_padding_v: 8,
  bg_corner_radius: 16,
  bg_width_extra: 0,
  bg_height_extra: 0,

  text_offset_x: 0,
  text_offset_y: 0,
  text_align_h: 'center',
  text_align_v: 'middle',

  words_per_group: 3,
  caption_style: 'classic',
  lines: 1,
  max_width: 0.9,
  line_height: 1.2,

  position_x: 0.5,
  position_y: 0.82,

  resolution_w: 1920,
  resolution_h: 1080,
  fps: 30,

  output_format: 'webm',
  render_mode: 'overlay',
  video_bitrate: '8M',

  animation: 'fade',
  animation_duration: 0.12,
  word_transition: 'highlight',
  crossfade_duration: 0.06,

  highlight_radius: 16,
  highlight_padding_x: 17,
  highlight_padding_y: 17,
  highlight_opacity: 0.85,
  highlight_animation: 'jump',
  highlight_text_color: '#FFFFFF',
  underline_thickness: 4,
  underline_color: '',
  underline_offset_y: 2,
  underline_width: 0,
  bounce_strength: 0.18,
  scale_factor: 1.25,

  shadow_enabled: false,
  shadow_color: '#000000',
  shadow_opacity: 0.8,
  shadow_blur: 8,
  shadow_offset_x: 3,
  shadow_offset_y: 3,
}

const group = (text: string, start: number, end: number): Segment => ({
  id: `${text}:${start}`,
  start,
  end,
  text,
  words: text.split(' ').map((w, i) => ({ word: w, start: start + i, end: start + i + 1 })),
})

describe('buildRenderBody — golden config', () => {
  test('STUDIO_DEFAULTS maps to the exact snake_case backend config', () => {
    const body = buildRenderBody(STUDIO_DEFAULTS, [], false)
    // toEqual on the full object: a missing, extra, or renamed key fails loudly.
    expect(body.config).toEqual(GOLDEN_DEFAULT_CONFIG)
  })

  test('emits no extra top-level keys without output dir or edited groups', () => {
    const body = buildRenderBody(STUDIO_DEFAULTS, [], false)
    expect(Object.keys(body)).toEqual(['config'])
  })
})

describe('buildRenderBody — unit conversions', () => {
  test('percent-based settings are converted to fractions', () => {
    const body = buildRenderBody(
      { ...STUDIO_DEFAULTS, bgOpacity: 85, maxWidth: 70, posX: 25, posY: 90, animDuration: 50 },
      [],
      false
    )
    expect(body.config.bg_opacity).toBe(0.85)
    expect(body.config.max_width).toBe(0.7)
    expect(body.config.position_x).toBe(0.25)
    expect(body.config.position_y).toBe(0.9)
    expect(body.config.animation_duration).toBe(0.5)
  })

  test('empty fontPath becomes null, non-empty passes through', () => {
    expect(buildRenderBody(STUDIO_DEFAULTS, [], false).config.custom_font_path).toBeNull()
    const withFont = buildRenderBody({ ...STUDIO_DEFAULTS, fontPath: '/f/Inter.ttf' }, [], false)
    expect(withFont.config.custom_font_path).toBe('/f/Inter.ttf')
  })
})

describe('buildRenderBody — overrides', () => {
  test('baked quick-render defaults the format to mp4', () => {
    const body = buildRenderBody(STUDIO_DEFAULTS, [], false, { renderMode: 'baked' })
    expect(body.config.render_mode).toBe('baked')
    expect(body.config.output_format).toBe('mp4')
  })

  test('explicit format override beats the baked-mp4 default', () => {
    const body = buildRenderBody(STUDIO_DEFAULTS, [], false, {
      renderMode: 'baked',
      format: 'mov',
    })
    expect(body.config.output_format).toBe('mov')
  })

  test('resolution/fps/bitrate overrides replace settings values', () => {
    const body = buildRenderBody(STUDIO_DEFAULTS, [], false, {
      resolution: [1080, 1920],
      fps: 60,
      bitrate: '40M',
    })
    expect(body.config.resolution_w).toBe(1080)
    expect(body.config.resolution_h).toBe(1920)
    expect(body.config.fps).toBe(60)
    expect(body.config.video_bitrate).toBe('40M')
  })
})

describe('buildRenderBody — custom groups', () => {
  const groups = [group('hello world', 0, 2), group('again', 5, 6)]

  test('omits custom_groups unless the user actually edited groups', () => {
    expect(buildRenderBody(STUDIO_DEFAULTS, groups, false).custom_groups).toBeUndefined()
    expect(buildRenderBody(STUDIO_DEFAULTS, [], true).custom_groups).toBeUndefined()
  })

  test('sends edited groups with timing and per-word overrides verbatim', () => {
    const styled: Segment[] = [
      {
        ...groups[0],
        words: groups[0].words.map((w, i) =>
          i === 0 ? { ...w, overrides: { text_color: '#FF0000' } } : w
        ),
      },
    ]
    const body = buildRenderBody(STUDIO_DEFAULTS, styled, true)
    expect(body.custom_groups).toHaveLength(1)
    expect(body.custom_groups![0]).toMatchObject({ text: 'hello world', start: 0, end: 2 })
    expect(body.custom_groups![0].words[0]).toMatchObject({
      word: 'hello',
      overrides: { text_color: '#FF0000' },
    })
  })

  test('sends groups when only a position override exists, even with groupsEdited=false', () => {
    const overridden: Segment[] = [
      { ...groups[0], positionOverride: { position_x: 0.5, position_y: 0.15 } },
      groups[1],
    ]
    const body = buildRenderBody(STUDIO_DEFAULTS, overridden, false)
    expect(body.custom_groups).toHaveLength(2)
    expect(body.custom_groups![0]).toMatchObject({ position_x: 0.5, position_y: 0.15 })
    // Sparse contract: untouched groups carry no position keys at all
    expect('position_x' in body.custom_groups![1]).toBe(false)
    expect('position_y' in body.custom_groups![1]).toBe(false)
  })

  test('partial override emits only the axis that was set', () => {
    const overridden: Segment[] = [{ ...groups[0], positionOverride: { position_y: 0.2 } }]
    const body = buildRenderBody(STUDIO_DEFAULTS, overridden, false)
    expect(body.custom_groups![0].position_y).toBe(0.2)
    expect('position_x' in body.custom_groups![0]).toBe(false)
  })

  test('edited groups without overrides never gain position keys', () => {
    const body = buildRenderBody(STUDIO_DEFAULTS, groups, true)
    for (const g of body.custom_groups!) {
      expect('position_x' in g).toBe(false)
      expect('position_y' in g).toBe(false)
    }
  })

  test('includes output_dir only when provided', () => {
    expect(buildRenderBody(STUDIO_DEFAULTS, [], false, {}, '/tmp/out').output_dir).toBe('/tmp/out')
    expect(buildRenderBody(STUDIO_DEFAULTS, [], false).output_dir).toBeUndefined()
  })
})

describe('dirname', () => {
  test('strips the last path segment for POSIX and Windows separators', () => {
    expect(dirname('/a/b/c.mp4')).toBe('/a/b')
    expect(dirname('C:\\videos\\clip.mp4')).toBe('C:\\videos')
  })

  test('returns the input when there is no separator, empty for empty', () => {
    expect(dirname('clip.mp4')).toBe('clip.mp4')
    expect(dirname('')).toBe('')
  })
})
