import { describe, it, expect } from 'vitest'
import { STUDIO_DEFAULTS, type StudioSettings } from '../components/studio/StudioPanel'
import { buildRenderBody } from './render'
import {
  NUMERIC_SETTING_SPECS,
  coerceNonNumericSettingValue,
  isNumericSetting,
  isSanitizedNonNumericSetting,
  sanitizeNonNumericSettingValue,
  sanitizeSettingValue,
  sanitizeSettings,
} from './settingsSanitize'

describe('sanitizeSettingValue', () => {
  it('reads a percentage written into a 0-1 fraction field as a percentage', () => {
    // The reported bug: an agent copies bgOpacity's 0-100 scale onto
    // shadowOpacity, which is already a fraction.
    expect(sanitizeSettingValue('shadowOpacity', 90)).toBe(0.9)
    expect(sanitizeSettingValue('highlightOpacity', 85)).toBe(0.85)
  })

  it('leaves an in-range fraction alone', () => {
    expect(sanitizeSettingValue('shadowOpacity', 0.8)).toBe(0.8)
    expect(sanitizeSettingValue('shadowOpacity', 1)).toBe(1)
    expect(sanitizeSettingValue('shadowOpacity', 0)).toBe(0)
  })

  it('clamps past the percentage reading, not into it', () => {
    expect(sanitizeSettingValue('shadowOpacity', 400)).toBe(1)
    expect(sanitizeSettingValue('shadowOpacity', -3)).toBe(0)
  })

  it('does not rescale percentage fields — those stay 0-100', () => {
    expect(sanitizeSettingValue('bgOpacity', 90)).toBe(90)
    expect(sanitizeSettingValue('posY', 82)).toBe(82)
    expect(sanitizeSettingValue('maxWidth', 90)).toBe(90)
  })

  it('leaves seconds-valued settings unscaled — they are not fractions', () => {
    // The regression the `fraction` heuristic would cause: a legitimate 2s
    // hold sits in (1, 100], so a `fraction: true` spec would read it as a
    // percentage and write 0.02 — a hold the user cannot see.
    expect(sanitizeSettingValue('lastGroupHold', 2)).toBe(2)
    expect(sanitizeSettingValue('gapCloseThreshold', 2)).toBe(2)
    expect(sanitizeSettingValue('lastGroupHold', 1.5)).toBe(1.5)
    expect(sanitizeSettingValue('gapCloseThreshold', 0.25)).toBe(0.25)
    expect(sanitizeSettingValue('lastGroupHold', 0)).toBe(0)
    expect(sanitizeSettingValue('gapCloseThreshold', 0)).toBe(0)
  })

  it('clamps the seconds settings to the backend Field bounds', () => {
    expect(sanitizeSettingValue('gapCloseThreshold', 42)).toBe(5)
    expect(sanitizeSettingValue('lastGroupHold', 999)).toBe(30)
    expect(sanitizeSettingValue('gapCloseThreshold', -1)).toBe(0)
    expect(sanitizeSettingValue('lastGroupHold', -1)).toBe(0)
  })

  it('rounds fields the backend types as int', () => {
    expect(sanitizeSettingValue('fontSize', 72.4)).toBe(72)
    expect(sanitizeSettingValue('lines', 2.6)).toBe(3)
  })

  it('clamps to the schema bounds', () => {
    expect(sanitizeSettingValue('lines', 99)).toBe(10)
    expect(sanitizeSettingValue('fps', 500)).toBe(120)
    expect(sanitizeSettingValue('fontSize', 0)).toBe(1)
    expect(sanitizeSettingValue('lineHeight', 0.1)).toBe(0.5)
    expect(sanitizeSettingValue('scaleFactor', 0.2)).toBe(0.5)
  })

  it('parses a numeric string', () => {
    expect(sanitizeSettingValue('fontSize', '84')).toBe(84)
  })

  it('returns undefined for values that are not numbers at all', () => {
    expect(sanitizeSettingValue('fontSize', 'huge')).toBeUndefined()
    expect(sanitizeSettingValue('fontSize', null)).toBeUndefined()
    expect(sanitizeSettingValue('fontSize', undefined)).toBeUndefined()
    expect(sanitizeSettingValue('fontSize', NaN)).toBeUndefined()
  })

  it('returns undefined for keys it does not bound', () => {
    // Offsets and extras are deliberately unbounded — the backend accepts any
    // finite number, including negatives.
    expect(sanitizeSettingValue('shadowOffsetX', -20)).toBeUndefined()
    expect(sanitizeSettingValue('textColor', '#FFFFFF')).toBeUndefined()
  })
})

describe('sanitizeSettingValue — RSVP dials', () => {
  it('reads a percentage written into rsvpContextOpacity as a percentage', () => {
    // Same mistake as shadowOpacity: the field is a 0-1 fraction, so an agent
    // (or an old preset) writing 90 means 90%.
    expect(sanitizeSettingValue('rsvpContextOpacity', 90)).toBe(0.9)
    expect(sanitizeSettingValue('rsvpContextOpacity', 0.75)).toBe(0.75)
    expect(sanitizeSettingValue('rsvpContextOpacity', 400)).toBe(1)
    expect(sanitizeSettingValue('rsvpContextOpacity', -1)).toBe(0)
  })

  it('leaves rsvpSlideDuration unscaled — it is seconds, not a fraction', () => {
    // The regression a `fraction: true` spec would cause: the heuristic fires
    // above 1, so a 1.5s slide would be re-read as 0.015s (1 itself is safe).
    expect(sanitizeSettingValue('rsvpSlideDuration', 1)).toBe(1)
    expect(sanitizeSettingValue('rsvpSlideDuration', 0.06)).toBe(0.06)
    expect(sanitizeSettingValue('rsvpSlideDuration', 0)).toBe(0)
    // ...and out-of-range values are clamped to the backend Field bound (le=1),
    // never rescaled — 1.5 becomes 1, not 0.015.
    expect(sanitizeSettingValue('rsvpSlideDuration', 1.5)).toBe(1)
    expect(sanitizeSettingValue('rsvpSlideDuration', 4)).toBe(1)
  })

  it('keeps the band percentages on the 0-100 scale', () => {
    expect(sanitizeSettingValue('rsvpPivotX', 35)).toBe(35)
    expect(sanitizeSettingValue('rsvpPivotX', 140)).toBe(100)
    expect(sanitizeSettingValue('rsvpEdgeFade', 12)).toBe(12)
    // rsvp_edge_fade is Field(..., le=0.5) once pct()'d, so 50 is the UI max.
    expect(sanitizeSettingValue('rsvpEdgeFade', 90)).toBe(50)
  })
})

describe('sanitizeNonNumericSettingValue', () => {
  it('falls back to wrap for an unknown readingMode', () => {
    // An unknown mode would be rejected by the backend Literal at render time.
    expect(sanitizeNonNumericSettingValue('readingMode', 'turbo')).toBe('wrap')
    expect(sanitizeNonNumericSettingValue('readingMode', 42)).toBe('wrap')
    expect(sanitizeNonNumericSettingValue('readingMode', null)).toBe('wrap')
  })

  it('accepts both readingMode values, case/whitespace tolerantly', () => {
    expect(sanitizeNonNumericSettingValue('readingMode', 'rsvp')).toBe('rsvp')
    expect(sanitizeNonNumericSettingValue('readingMode', ' RSVP ')).toBe('rsvp')
    expect(sanitizeNonNumericSettingValue('readingMode', 'wrap')).toBe('wrap')
  })

  it('falls back to the default focus color for a malformed hex', () => {
    expect(sanitizeNonNumericSettingValue('rsvpFocusColor', 'orange')).toBe('#E4851F')
    expect(sanitizeNonNumericSettingValue('rsvpFocusColor', '#12345')).toBe('#E4851F')
    expect(sanitizeNonNumericSettingValue('rsvpFocusColor', '')).toBe('#E4851F')
    expect(sanitizeNonNumericSettingValue('rsvpFocusColor', '#0af')).toBe('#0af')
    expect(sanitizeNonNumericSettingValue('rsvpFocusColor', '#123456')).toBe('#123456')
  })

  it('coerces rsvpReticle to a real boolean', () => {
    expect(sanitizeNonNumericSettingValue('rsvpReticle', false)).toBe(false)
    expect(sanitizeNonNumericSettingValue('rsvpReticle', 'false')).toBe(false)
    expect(sanitizeNonNumericSettingValue('rsvpReticle', 'true')).toBe(true)
    expect(sanitizeNonNumericSettingValue('rsvpReticle', 'maybe')).toBe(true)
  })

  it('returns undefined for keys it does not repair', () => {
    // The pre-existing colour/enum settings deliberately still pass through.
    expect(sanitizeNonNumericSettingValue('textColor', 'nonsense')).toBeUndefined()
    expect(sanitizeNonNumericSettingValue('textAlignH', 'sideways')).toBeUndefined()
  })
})

describe('coerceNonNumericSettingValue', () => {
  it('returns undefined instead of a default for an invalid value', () => {
    // The live-patch reading: applySettingsCommand skips the key so the user's
    // current value survives, rather than being reset by an agent's typo.
    expect(coerceNonNumericSettingValue('readingMode', 'turbo')).toBeUndefined()
    expect(coerceNonNumericSettingValue('readingMode', null)).toBeUndefined()
    expect(coerceNonNumericSettingValue('rsvpFocusColor', 'orange')).toBeUndefined()
    expect(coerceNonNumericSettingValue('rsvpReticle', 'maybe')).toBeUndefined()
  })

  it('coerces a valid value exactly as the repairing sanitizer does', () => {
    expect(coerceNonNumericSettingValue('readingMode', ' RSVP ')).toBe('rsvp')
    expect(coerceNonNumericSettingValue('rsvpFocusColor', '#0af')).toBe('#0af')
    expect(coerceNonNumericSettingValue('rsvpReticle', 'false')).toBe(false)
    expect(coerceNonNumericSettingValue('rsvpReticle', true)).toBe(true)
  })

  it('returns undefined for keys it does not know', () => {
    expect(coerceNonNumericSettingValue('textColor', '#123456')).toBeUndefined()
  })
})

describe('isSanitizedNonNumericSetting', () => {
  it('names exactly the RSVP non-numeric fields', () => {
    expect(isSanitizedNonNumericSetting('readingMode')).toBe(true)
    expect(isSanitizedNonNumericSetting('rsvpFocusColor')).toBe(true)
    expect(isSanitizedNonNumericSetting('rsvpReticle')).toBe(true)
    expect(isSanitizedNonNumericSetting('textColor')).toBe(false)
    expect(isSanitizedNonNumericSetting('rsvpPivotX')).toBe(false)
    expect(isSanitizedNonNumericSetting('nonsense')).toBe(false)
  })
})

describe('isNumericSetting', () => {
  it('agrees with the spec table', () => {
    expect(isNumericSetting('shadowOpacity')).toBe(true)
    expect(isNumericSetting('textColor')).toBe(false)
    expect(isNumericSetting('nonsense')).toBe(false)
  })
})

describe('sanitizeSettings', () => {
  it('repairs the whole object without touching valid fields', () => {
    const dirty = { ...STUDIO_DEFAULTS, shadowOpacity: 90, textColor: '#123456' }

    const clean = sanitizeSettings(dirty)

    expect(clean.shadowOpacity).toBe(0.9)
    expect(clean.textColor).toBe('#123456')
    expect(clean.bgOpacity).toBe(STUDIO_DEFAULTS.bgOpacity)
  })

  it('returns a new object and never mutates the input', () => {
    const dirty = { ...STUDIO_DEFAULTS, shadowOpacity: 90 }

    const clean = sanitizeSettings(dirty)

    expect(clean).not.toBe(dirty)
    expect(dirty.shadowOpacity).toBe(90)
  })

  it('repairs the non-numeric RSVP fields too', () => {
    const dirty = {
      ...STUDIO_DEFAULTS,
      readingMode: 'turbo' as unknown as StudioSettings['readingMode'],
      rsvpFocusColor: 'orange',
      rsvpContextOpacity: 90,
    }

    const clean = sanitizeSettings(dirty)

    expect(clean.readingMode).toBe('wrap')
    expect(clean.rsvpFocusColor).toBe('#E4851F')
    expect(clean.rsvpContextOpacity).toBe(0.9)
  })

  it('round-trips a saved project through the restore shape', () => {
    // Mirrors App.tsx's restoreFromProjectFile:
    //   sanitizeSettings({ ...STUDIO_DEFAULTS, ...file.studioSettings })
    // Project save/load is a whole-object copy, so the RSVP fields ride along
    // without an allowlist — but a pre-RSVP project must still land on the
    // defaults rather than undefined/NaN.
    const legacyProject = { ...STUDIO_DEFAULTS } as Record<string, unknown>
    for (const key of [
      'readingMode',
      'rsvpPivotX',
      'rsvpFocusColor',
      'rsvpContextOpacity',
      'rsvpSlideDuration',
      'rsvpEdgeFade',
      'rsvpReticle',
    ]) {
      delete legacyProject[key]
    }

    const restoredLegacy = sanitizeSettings({
      ...STUDIO_DEFAULTS,
      ...(legacyProject as unknown as StudioSettings),
    })
    expect(restoredLegacy.readingMode).toBe('wrap')
    expect(restoredLegacy.rsvpPivotX).toBe(STUDIO_DEFAULTS.rsvpPivotX)
    expect(restoredLegacy.rsvpFocusColor).toBe(STUDIO_DEFAULTS.rsvpFocusColor)
    expect(restoredLegacy.rsvpReticle).toBe(true)

    const saved: StudioSettings = {
      ...STUDIO_DEFAULTS,
      readingMode: 'rsvp',
      rsvpPivotX: 42,
      rsvpFocusColor: '#00FF00',
      rsvpContextOpacity: 0.4,
      rsvpSlideDuration: 0.12,
      rsvpEdgeFade: 20,
      rsvpReticle: false,
    }
    expect(sanitizeSettings({ ...STUDIO_DEFAULTS, ...saved })).toEqual(saved)
  })

  it('produces a render config the backend schema accepts', () => {
    // End-to-end shape of the bug: settings -> buildRenderBody -> the field
    // that Pydantic rejected with "Input should be less than or equal to 1".
    const body = buildRenderBody(
      sanitizeSettings({ ...STUDIO_DEFAULTS, shadowOpacity: 90, highlightOpacity: 85 }),
      [],
      false
    )

    expect(body.config.shadow_opacity).toBe(0.9)
    expect(body.config.highlight_opacity).toBe(0.85)
  })
})

describe('spec table', () => {
  it('only names keys that exist on StudioSettings', () => {
    for (const key of Object.keys(NUMERIC_SETTING_SPECS)) {
      expect(STUDIO_DEFAULTS).toHaveProperty(key)
    }
  })

  it('never marks a seconds-valued setting as a fraction', () => {
    expect(NUMERIC_SETTING_SPECS.gapCloseThreshold?.fraction).toBeUndefined()
    expect(NUMERIC_SETTING_SPECS.lastGroupHold?.fraction).toBeUndefined()
    expect(NUMERIC_SETTING_SPECS.rsvpSlideDuration?.fraction).toBeUndefined()
  })

  it('marks exactly the three genuine 0-1 fraction fields', () => {
    const fractionKeys = Object.entries(NUMERIC_SETTING_SPECS)
      .filter(([, spec]) => spec?.fraction)
      .map(([key]) => key)
      .sort()

    expect(fractionKeys).toEqual(['highlightOpacity', 'rsvpContextOpacity', 'shadowOpacity'])
  })

  it('leaves every default value unchanged', () => {
    // A default the sanitizer would rewrite means the table's bounds and the
    // app's own starting style disagree.
    expect(sanitizeSettings(STUDIO_DEFAULTS)).toEqual(STUDIO_DEFAULTS)
  })
})
