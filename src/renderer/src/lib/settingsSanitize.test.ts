import { describe, it, expect } from 'vitest'
import { STUDIO_DEFAULTS } from '../components/studio/StudioPanel'
import { buildRenderBody } from './render'
import {
  NUMERIC_SETTING_SPECS,
  isNumericSetting,
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
  })

  it('leaves every default value unchanged', () => {
    // A default the sanitizer would rewrite means the table's bounds and the
    // app's own starting style disagree.
    expect(sanitizeSettings(STUDIO_DEFAULTS)).toEqual(STUDIO_DEFAULTS)
  })
})
