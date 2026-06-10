import { describe, expect, test } from 'vitest'
import {
  vanillaToStudio,
  studioToVanilla,
  applyPreset,
  BUILTIN_PRESETS,
  type VanillaPreset,
} from './presets'
import { STUDIO_DEFAULTS, type StudioSettings } from '../components/studio/StudioPanel'

describe('studioToVanilla → vanillaToStudio round-trip', () => {
  test('preserves all style fields the vanilla schema can represent', () => {
    const settings: StudioSettings = {
      ...STUDIO_DEFAULTS,
      fontName: 'Inter',
      fontPath: '/fonts/Inter-Bold.ttf',
      fontSize: 96,
      fontWeight: 700,
      textColor: '#112233',
      outlineColor: '#445566',
      outlineWidth: 3,
      bgColor: '#778899',
      activeColor: '#AABBCC',
      bgOpacity: 42,
      bgRadius: 7,
      bgWidthExtra: 5,
      bgHeightExtra: -4,
      textOffsetX: 2,
      textOffsetY: -3,
      textAlignH: 'left',
      textAlignV: 'top',
      wordsPerGroup: 5,
      lines: 2,
      posX: 25,
      posY: 75,
      animationType: 'pop',
      animDuration: 20,
      wordStyle: 'bounce',
      format: 'mp4',
      renderMode: 'baked',
      bitrate: '15M',
      safeZone: 'tiktok',
    }

    const restored = applyPreset(STUDIO_DEFAULTS, studioToVanilla(settings))

    expect(restored.fontName).toBe('Inter')
    expect(restored.fontPath).toBe('/fonts/Inter-Bold.ttf')
    expect(restored.fontSize).toBe(96)
    expect(restored.fontWeight).toBe(700)
    expect(restored.textColor).toBe('#112233')
    expect(restored.outlineColor).toBe('#445566')
    expect(restored.outlineWidth).toBe(3)
    expect(restored.bgColor).toBe('#778899')
    expect(restored.activeColor).toBe('#AABBCC')
    expect(restored.bgOpacity).toBe(42)
    expect(restored.bgRadius).toBe(7)
    expect(restored.bgWidthExtra).toBe(5)
    expect(restored.bgHeightExtra).toBe(-4)
    expect(restored.textOffsetX).toBe(2)
    expect(restored.textOffsetY).toBe(-3)
    expect(restored.textAlignH).toBe('left')
    expect(restored.textAlignV).toBe('top')
    expect(restored.wordsPerGroup).toBe(5)
    expect(restored.lines).toBe(2)
    expect(restored.posX).toBe(25)
    expect(restored.posY).toBe(75)
    expect(restored.animationType).toBe('pop')
    expect(restored.animDuration).toBe(20)
    expect(restored.wordStyle).toBe('bounce')
    expect(restored.format).toBe('mp4')
    expect(restored.renderMode).toBe('baked')
    expect(restored.bitrate).toBe('15M')
    expect(restored.safeZone).toBe('tiktok')
  })

  test('invalid safeZone values are dropped rather than passed through', () => {
    expect(vanillaToStudio({ safeZone: 'myspace' }).safeZone).toBeUndefined()
    expect(vanillaToStudio({ safeZone: 'reels' }).safeZone).toBe('reels')
  })

  test('bold flag maps fontWeight 700 ↔ true, sub-700 ↔ false', () => {
    expect(studioToVanilla({ ...STUDIO_DEFAULTS, fontWeight: 700 }).bold).toBe(true)
    expect(studioToVanilla({ ...STUDIO_DEFAULTS, fontWeight: 400 }).bold).toBe(false)
    expect(vanillaToStudio({ bold: true }).fontWeight).toBe(700)
    expect(vanillaToStudio({ bold: false }).fontWeight).toBe(400)
  })
})

describe('vanillaToStudio', () => {
  test('empty preset produces an empty patch (all fields fall back to current)', () => {
    expect(vanillaToStudio({})).toEqual({})
  })

  test('numeric strings are parsed; garbage falls back to defaults', () => {
    expect(vanillaToStudio({ fontSize: '72' }).fontSize).toBe(72)
    expect(vanillaToStudio({ fontSize: 'not-a-number' }).fontSize).toBe(STUDIO_DEFAULTS.fontSize)
    expect(vanillaToStudio({ bgOpacity: 'NaN' }).bgOpacity).toBe(STUDIO_DEFAULTS.bgOpacity)
  })

  test('unknown enum-ish values are dropped rather than passed through', () => {
    const patch = vanillaToStudio({
      textAlignH: 'diagonal',
      textAlignV: 'sideways',
      format: 'avi',
      renderMode: 'holographic',
      resolution: 'huge',
    } as VanillaPreset)
    expect(patch.textAlignH).toBeUndefined()
    expect(patch.textAlignV).toBeUndefined()
    expect(patch.format).toBeUndefined()
    expect(patch.renderMode).toBeUndefined()
    expect(patch.resolution).toBeUndefined()
  })

  test('parses "WxH" resolution strings and unpins source resolution', () => {
    const patch = vanillaToStudio({ resolution: '1080x1920' })
    expect(patch.resolution).toEqual([1080, 1920])
    expect(patch.resolutionIsSource).toBe(false)
  })
})

describe('applyPreset', () => {
  test('keeps current render settings when the preset does not specify them', () => {
    const current: StudioSettings = {
      ...STUDIO_DEFAULTS,
      resolution: [1080, 1920],
      resolutionIsSource: true,
      fps: 60,
    }
    // Built-in style presets carry no resolution/fps — they must not clobber.
    const next = applyPreset(current, BUILTIN_PRESETS[0].settings)
    expect(next.resolution).toEqual([1080, 1920])
    expect(next.resolutionIsSource).toBe(true)
    expect(next.fps).toBe(60)
  })

  test('every built-in preset applies onto defaults without breaking the shape', () => {
    for (const preset of BUILTIN_PRESETS) {
      const next = applyPreset(STUDIO_DEFAULTS, preset.settings)
      expect(typeof next.fontSize).toBe('number')
      expect(Number.isFinite(next.fontSize)).toBe(true)
      expect(typeof next.textColor).toBe('string')
      expect(next.wordsPerGroup).toBeGreaterThanOrEqual(1)
      // Untouched-by-preset fields keep their defaults.
      expect(next.shadowEnabled).toBe(STUDIO_DEFAULTS.shadowEnabled)
      expect(next.maxWidth).toBe(STUDIO_DEFAULTS.maxWidth)
    }
  })
})
