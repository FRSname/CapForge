import { describe, expect, test } from 'vitest'
import {
  vanillaToStudio,
  studioToVanilla,
  applyPreset,
  BUILTIN_PRESETS,
  getSystemFontExportWarning,
  type VanillaPreset,
} from './presets'
import { STUDIO_DEFAULTS, type StudioSettings } from '../components/studio/StudioPanel'

describe('getSystemFontExportWarning', () => {
  test('warns when an installed font can only travel by family name', () => {
    expect(getSystemFontExportWarning({ font: 'Arial' })).toContain('Arial')
  })

  test('does not warn for bundled or custom font files', () => {
    expect(
      getSystemFontExportWarning({ font: 'Caviar Dreams', customFontPath: '/Fonts/Caviar.ttf' })
    ).toBeNull()
    expect(getSystemFontExportWarning({})).toBeNull()
  })
})

// Every StudioSettings key the vanilla preset schema round-trips. Render/export
// settings (resolution/fps/format/renderMode/bitrate/resolutionIsSource) and
// fontWeight (legacy `bold` is read but never written) are deliberately absent.
const ROUND_TRIP_KEYS: (keyof StudioSettings)[] = [
  'fontName',
  'fontPath',
  'fontSize',
  'tracking',
  'lineHeight',
  'textColor',
  'outlineColor',
  'outlineWidth',
  'bgColor',
  'activeColor',
  'bgOpacity',
  'bgRadius',
  'bgWidthExtra',
  'bgHeightExtra',
  'textOffsetX',
  'textOffsetY',
  'textAlignH',
  'textAlignV',
  'lines',
  'posX',
  'posY',
  'marginH',
  'marginV',
  'maxWidth',
  'captionStyle',
  'animationType',
  'animDuration',
  'wordStyle',
  'highlightRadius',
  'highlightPadX',
  'highlightPadY',
  'highlightOpacity',
  'highlightAnim',
  'highlightOffsetX',
  'highlightOffsetY',
  'highlightTextColor',
  'underlineThickness',
  'underlineColor',
  'underlineOffsetY',
  'underlineWidth',
  'bounceStrength',
  'scaleFactor',
  'shadowEnabled',
  'shadowColor',
  'shadowOpacity',
  'shadowBlur',
  'shadowOffsetX',
  'shadowOffsetY',
  'safeZone',
  // Reading mode (RSVP) — an RSVP look is a visual style, so a preset carries it.
  'readingMode',
  'rsvpPivotX',
  'rsvpFocusColor',
  'rsvpContextOpacity',
  'rsvpSlideDuration',
  'rsvpEdgeFade',
  'rsvpReticle',
]

const RENDER_KEYS = [
  'resolution',
  'resolutionIsSource',
  'fps',
  'format',
  'renderMode',
  'bitrate',
  // Grouping is a per-project setting, not a style. Applying it from a preset
  // forced a group rebuild that discarded manually edited group end times.
  'wordsPerGroup',
] as const

describe('studioToVanilla → vanillaToStudio round-trip', () => {
  test('preserves every style field and drops every render field', () => {
    // Non-default value for every round-tripped key, plus non-default render
    // settings that must NOT survive the trip.
    const custom: StudioSettings = {
      ...STUDIO_DEFAULTS,
      fontName: 'Inter',
      fontPath: '/fonts/Inter-Bold.ttf',
      fontSize: 96,
      tracking: 2.5,
      lineHeight: 1.35,
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
      marginH: 12,
      marginV: 6,
      maxWidth: 70,
      captionStyle: 'neon',
      animationType: 'pop',
      animDuration: 20,
      wordStyle: 'bounce',
      highlightRadius: 9,
      highlightPadX: 11,
      highlightPadY: 13,
      highlightOpacity: 0.6,
      highlightAnim: 'slide',
      highlightOffsetX: 15,
      highlightOffsetY: -8,
      highlightTextColor: '#0F0F0F',
      underlineThickness: 6,
      underlineColor: '#FF00FF',
      underlineOffsetY: 4,
      underlineWidth: 120,
      bounceStrength: 0.3,
      scaleFactor: 1.8,
      shadowEnabled: true,
      shadowColor: '#222222',
      shadowOpacity: 0.5,
      shadowBlur: 12,
      shadowOffsetX: -2,
      shadowOffsetY: 5,
      safeZone: 'tiktok',
      readingMode: 'rsvp',
      rsvpPivotX: 42,
      rsvpFocusColor: '#00FF00',
      // 0-1 fraction and plain seconds respectively — a preset that rescaled
      // either would fail this round-trip.
      rsvpContextOpacity: 0.4,
      rsvpSlideDuration: 0.12,
      rsvpEdgeFade: 20,
      rsvpReticle: false,
      // Render settings — the round-trip must NOT carry these.
      resolution: [808, 1440],
      resolutionIsSource: true,
      fps: 25,
      format: 'mp4',
      renderMode: 'baked',
      bitrate: '15M',
    }

    const restored = applyPreset(STUDIO_DEFAULTS, studioToVanilla(custom))

    for (const key of ROUND_TRIP_KEYS) {
      expect(restored[key], `style key "${key}" should round-trip`).toEqual(custom[key])
    }
    for (const key of RENDER_KEYS) {
      expect(restored[key], `render key "${key}" must stay at defaults`).toEqual(
        STUDIO_DEFAULTS[key]
      )
    }
  })

  test('applying a preset never changes wordsPerGroup', () => {
    // Grouping stays a per-project setting: a preset that re-chunked groups
    // forced a rebuild that threw away manually edited group end times.
    const current: StudioSettings = { ...STUDIO_DEFAULTS, wordsPerGroup: 7 }

    const applied = applyPreset(current, { wpg: '2', textColor: '#ABCDEF' })

    expect(applied.wordsPerGroup).toBe(7)
    // …while style keys from the same preset still apply.
    expect(applied.textColor).toBe('#ABCDEF')
  })

  test('legacy presets carrying wpg still parse without throwing', () => {
    expect(vanillaToStudio({ wpg: '4' }).wordsPerGroup).toBeUndefined()
    expect(() => applyPreset(STUDIO_DEFAULTS, { wpg: 'nonsense' })).not.toThrow()
  })

  test('serialized presets no longer write a wpg key', () => {
    expect(studioToVanilla({ ...STUDIO_DEFAULTS, wordsPerGroup: 5 }).wpg).toBeUndefined()
  })

  test('builtin presets carry no grouping value', () => {
    for (const preset of BUILTIN_PRESETS) {
      expect(preset.settings.wpg, `builtin "${preset.name}" must not set wpg`).toBeUndefined()
    }
  })

  test('invalid safeZone values are dropped rather than passed through', () => {
    expect(vanillaToStudio({ safeZone: 'myspace' }).safeZone).toBeUndefined()
    expect(vanillaToStudio({ safeZone: 'reels' }).safeZone).toBe('reels')
  })

  test('legacy bold flag is still read (→ fontWeight) but never written', () => {
    expect(vanillaToStudio({ bold: true }).fontWeight).toBe(700)
    expect(vanillaToStudio({ bold: false }).fontWeight).toBe(400)
    expect(studioToVanilla({ ...STUDIO_DEFAULTS, fontWeight: 700 }).bold).toBeUndefined()
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
    expect(vanillaToStudio({ shadowBlur: '12' }).shadowBlur).toBe(12)
  })

  test('unknown enum-ish values are dropped rather than passed through', () => {
    const patch = vanillaToStudio({
      textAlignH: 'diagonal',
      textAlignV: 'sideways',
      highlightAnim: 'teleport',
    } as VanillaPreset)
    expect(patch.textAlignH).toBeUndefined()
    expect(patch.textAlignV).toBeUndefined()
    expect(patch.highlightAnim).toBeUndefined()
    expect(vanillaToStudio({ highlightAnim: 'slide' }).highlightAnim).toBe('slide')
  })

  test('an unknown readingMode is dropped, the two real ones are read', () => {
    // A bad value must not reach VideoRenderConfig.reading_mode's Literal.
    expect(vanillaToStudio({ readingMode: 'turbo' } as VanillaPreset).readingMode).toBeUndefined()
    expect(vanillaToStudio({ readingMode: 'rsvp' }).readingMode).toBe('rsvp')
    expect(vanillaToStudio({ readingMode: 'wrap' }).readingMode).toBe('wrap')
  })

  test('the RSVP dials keep their units through a preset', () => {
    // rsvpContextOpacity is a 0-1 fraction and rsvpSlideDuration plain seconds;
    // neither may be rescaled on the way in.
    expect(vanillaToStudio({ rsvpContextOpacity: '0.4' }).rsvpContextOpacity).toBe(0.4)
    expect(vanillaToStudio({ rsvpSlideDuration: '0.12' }).rsvpSlideDuration).toBe(0.12)
    expect(vanillaToStudio({ rsvpPivotX: '42' }).rsvpPivotX).toBe(42)
    expect(vanillaToStudio({ rsvpEdgeFade: '20' }).rsvpEdgeFade).toBe(20)
    expect(vanillaToStudio({ rsvpReticle: false }).rsvpReticle).toBe(false)
  })

  test('render/export keys are never applied, even when valid ("WxH" included)', () => {
    const patch = vanillaToStudio({
      resolution: '1080x1920',
      fps: '25',
      format: 'webm',
      renderMode: 'baked',
      bitrate: '4M',
    })
    for (const key of RENDER_KEYS) {
      expect(patch[key], `render key "${key}" must not be applied`).toBeUndefined()
    }
  })
})

describe('applyPreset', () => {
  test('legacy preset with render settings changes none of them (the 9:16-on-16:9 bug)', () => {
    const current: StudioSettings = {
      ...STUDIO_DEFAULTS,
      resolution: [1920, 1080],
      resolutionIsSource: true,
      fps: 60,
      format: 'mp4',
      renderMode: 'overlay',
      bitrate: '15M',
    }
    const legacyPreset: VanillaPreset = {
      resolution: '1080x1920',
      fps: '25',
      format: 'webm',
      renderMode: 'baked',
      bitrate: '4M',
      textColor: '#123456',
    }

    const next = applyPreset(current, legacyPreset)

    expect(next.resolution).toEqual([1920, 1080])
    expect(next.resolutionIsSource).toBe(true)
    expect(next.fps).toBe(60)
    expect(next.format).toBe('mp4')
    expect(next.renderMode).toBe('overlay')
    expect(next.bitrate).toBe('15M')
    // ...while style keys from the same preset still apply.
    expect(next.textColor).toBe('#123456')
  })

  test('sparse apply: a preset without the newer style keys leaves them untouched', () => {
    const current: StudioSettings = {
      ...STUDIO_DEFAULTS,
      shadowEnabled: true,
      shadowBlur: 20,
      highlightAnim: 'slide',
      lineHeight: 1.5,
      maxWidth: 60,
    }
    // Old vanilla-era preset shape: only classic keys present.
    const next = applyPreset(current, { fontSize: '80', textColor: '#FFFFFF' })
    expect(next.fontSize).toBe(80)
    expect(next.shadowEnabled).toBe(true)
    expect(next.shadowBlur).toBe(20)
    expect(next.highlightAnim).toBe('slide')
    expect(next.lineHeight).toBe(1.5)
    expect(next.maxWidth).toBe(60)
  })

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

  test('repairs an out-of-range value already saved in the preset', () => {
    // A preset saved while the style held shadowOpacity: 90 (see the
    // set_settings unit trap) would otherwise reproduce the bad value on every
    // apply — which is why "change a control to re-mirror" never fixed it.
    const next = applyPreset(STUDIO_DEFAULTS, { shadowOpacity: '90', textColor: '#123456' })

    expect(next.shadowOpacity).toBe(0.9)
    expect(next.textColor).toBe('#123456')
  })

  test('does not rescale a preset field that is legitimately 0-100', () => {
    const next = applyPreset(STUDIO_DEFAULTS, { bgOpacity: '90', posY: '88' })

    expect(next.bgOpacity).toBe(90)
    expect(next.posY).toBe(88)
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

describe('vanillaToStudio — unknown-key tolerance and remaining field mappings', () => {
  test('unrecognized top-level keys are silently ignored (no throw, no patch)', () => {
    const patch = vanillaToStudio({ someFutureField: 'x', anotherOne: 42 } as VanillaPreset)
    expect(patch).toEqual({})
  })

  test('unrecognized keys alongside valid ones only apply the valid ones', () => {
    const patch = vanillaToStudio({
      textColor: '#FFFFFF',
      unknownField: 'ignored',
    } as VanillaPreset)
    expect(patch.textColor).toBe('#FFFFFF')
    expect((patch as unknown as Record<string, unknown>).unknownField).toBeUndefined()
  })

  test('customFontPath maps to fontPath', () => {
    expect(vanillaToStudio({ customFontPath: '/fonts/Custom.ttf' }).fontPath).toBe(
      '/fonts/Custom.ttf'
    )
  })

  test('shadowEnabled is coerced to a real boolean', () => {
    expect(vanillaToStudio({ shadowEnabled: true }).shadowEnabled).toBe(true)
    expect(vanillaToStudio({ shadowEnabled: false }).shadowEnabled).toBe(false)
  })
})

describe('studioToVanilla — fallback behavior', () => {
  test('falls back to "Arial" when fontName is empty', () => {
    expect(studioToVanilla({ ...STUDIO_DEFAULTS, fontName: '' }).font).toBe('Arial')
  })

  test('preserves a non-empty fontName', () => {
    expect(studioToVanilla({ ...STUDIO_DEFAULTS, fontName: 'Inter' }).font).toBe('Inter')
  })

  test('omits customFontPath (leaves it undefined) when fontPath is empty', () => {
    expect(studioToVanilla({ ...STUDIO_DEFAULTS, fontPath: '' }).customFontPath).toBeUndefined()
  })

  test('writes customFontPath when fontPath is set', () => {
    expect(studioToVanilla({ ...STUDIO_DEFAULTS, fontPath: '/fonts/A.ttf' }).customFontPath).toBe(
      '/fonts/A.ttf'
    )
  })

  test('numeric fields are serialized as strings', () => {
    const vanilla = studioToVanilla({ ...STUDIO_DEFAULTS, fontSize: 72, tracking: 1.5 })
    expect(vanilla.fontSize).toBe('72')
    expect(typeof vanilla.fontSize).toBe('string')
    expect(vanilla.tracking).toBe('1.5')
  })
})

describe('BUILTIN_PRESETS hygiene', () => {
  test('every built-in key is actually consumed by vanillaToStudio (no dead keys)', () => {
    for (const preset of BUILTIN_PRESETS) {
      for (const [key, value] of Object.entries(preset.settings)) {
        const patch = vanillaToStudio({ [key]: value } as VanillaPreset)
        expect(
          Object.keys(patch).length,
          `${preset.name}: key "${key}" maps to nothing`
        ).toBeGreaterThan(0)
      }
    }
  })

  test('no built-in preset produces render/export fields', () => {
    for (const preset of BUILTIN_PRESETS) {
      const patch = vanillaToStudio(preset.settings)
      for (const key of RENDER_KEYS) {
        expect(patch[key], `${preset.name}: render key "${key}" leaked`).toBeUndefined()
      }
    }
  })
})
