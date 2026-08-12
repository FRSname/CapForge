/**
 * Range/value guard for StudioSettings coming from OUTSIDE the UI controls.
 *
 * The sliders in StudioPanel can only produce in-range values. Three other
 * writers can't: the MCP agent (`set_settings`), a saved/imported preset, and a
 * restored project file. A value they get wrong reaches the backend through
 * buildRenderBody() and is rejected by Pydantic — surfacing as a 422 on
 * /api/render-video or a 409 on /api/render-frame, with the render simply not
 * happening. Sanitizing at the boundary means the mirror can never hold a
 * config the backend will refuse.
 *
 * The unit trap this exists for: StudioSettings is NOT uniformly 0–100.
 * `bgOpacity`, `maxWidth`, `posX`, `posY` and `animDuration` are percentages
 * that buildRenderBody() divides by 100 (`pct()`), but `shadowOpacity`,
 * `highlightOpacity` and `bounceStrength` are already 0–1 fractions that pass
 * through untouched. An agent that reads `bgOpacity: 90` and writes
 * `shadowOpacity: 90` by analogy is making the obvious mistake — so a `fraction`
 * field given a value in (1, 100] is read as a percentage and scaled, rather
 * than clamped to 1.0 (which would silently render at full opacity).
 *
 * A second, narrower path repairs the non-numeric settings whose value space is
 * closed (`readingMode`'s enum, `rsvpFocusColor`'s hex, `rsvpReticle`'s bool) —
 * see ENUM_SETTING_VALUES below for why that list is deliberately short.
 */

import type { StudioSettings } from '../components/studio/StudioPanel'
import { RSVP_DEFAULT_FOCUS_COLOR } from './renderConstants'

interface NumericSpec {
  min?: number
  max?: number
  /** Backend types this as `int`; Pydantic rejects a fractional float. */
  int?: boolean
  /** 0–1 fraction — a value in (1, 100] is a percentage the caller forgot to scale. */
  fraction?: boolean
}

/**
 * Bounds mirror the `Field(...)` constraints on `VideoRenderConfig`
 * (backend/models/schemas.py), expressed in StudioSettings units — so the
 * percentage fields are 0–100 here and 0–1 there. Fields the backend leaves
 * unbounded (offsets, extras, tracking) are absent: any finite number is legal
 * and clamping them would be inventing a limit the renderer doesn't have.
 */
export const NUMERIC_SETTING_SPECS: Partial<Record<keyof StudioSettings, NumericSpec>> = {
  fontSize: { min: 1, int: true },
  outlineWidth: { min: 0, int: true },
  posX: { min: 0, max: 100 },
  posY: { min: 0, max: 100 },
  marginH: { min: 0, int: true },
  marginV: { min: 0, int: true },
  maxWidth: { min: 0, max: 100 },
  wordsPerGroup: { min: 1, int: true },
  // Seconds, NOT fractions — marking these `fraction` would re-read a legitimate
  // 2s hold as 0.02s. Bounds are wider than the sliders on purpose: they mirror
  // the Pydantic Field(...) limits, which is what the sanitizer exists to
  // guarantee, not the UI's recommended range.
  gapCloseThreshold: { min: 0, max: 5 },
  lastGroupHold: { min: 0, max: 30 },
  lines: { min: 1, max: 10, int: true },
  bgOpacity: { min: 0, max: 100 },
  bgRadius: { min: 0, int: true },
  lineHeight: { min: 0.5, max: 5 },
  animDuration: { min: 0 },
  highlightRadius: { min: 0, int: true },
  highlightPadX: { min: 0, int: true },
  highlightPadY: { min: 0, int: true },
  highlightOpacity: { min: 0, max: 1, fraction: true },
  underlineThickness: { min: 1, int: true },
  underlineWidth: { min: 0, int: true },
  bounceStrength: { min: 0 },
  scaleFactor: { min: 0.5 },
  shadowOpacity: { min: 0, max: 1, fraction: true },
  shadowBlur: { min: 0, int: true },
  fps: { min: 1, max: 120, int: true },
  // ── RSVP reading mode ──────────────────────────────────────────────────
  // Percentages of the caption band — pct()'d in render.ts, so the backend
  // Field bounds are the /100 versions (rsvp_pivot_x le=1.0, rsvp_edge_fade
  // le=0.5).
  rsvpPivotX: { min: 0, max: 100 },
  rsvpEdgeFade: { min: 0, max: 50 },
  // A real 0–1 fraction, so `rsvpContextOpacity: 90` is the shadowOpacity
  // mistake again and is read as 0.9.
  rsvpContextOpacity: { min: 0, max: 1, fraction: true },
  // SECONDS, not a fraction — marking it `fraction` would re-read a legitimate
  // 1.5s slide as 0.015s (the heuristic fires above 1, so 1 itself is safe).
  // Same contract as gapCloseThreshold/lastGroupHold above.
  rsvpSlideDuration: { min: 0, max: 1 },
}

/**
 * Non-numeric settings whose value space is closed, so a bad write can be
 * repaired instead of propagated.
 *
 * Deliberately narrow: only the fields added with RSVP are enrolled. Enrolling
 * the pre-existing enum/colour settings (textAlignH, wordStyle, textColor, …)
 * would change what an agent's `set_settings` is allowed to write and belongs in
 * its own change — today those pass through verbatim, exactly as before.
 */
const ENUM_SETTING_VALUES: Partial<Record<keyof StudioSettings, readonly string[]>> = {
  // An unknown mode would reach the backend and be rejected by the
  // Literal['wrap','rsvp'] on VideoRenderConfig.reading_mode (422 at render),
  // so an unrecognised string falls back to the safe layout rather than through.
  readingMode: ['wrap', 'rsvp'],
}

/** Settings that must hold a `#rrggbb` / `#rgb` hex colour. */
const COLOR_SETTINGS: ReadonlySet<keyof StudioSettings> = new Set(['rsvpFocusColor'])

/** Settings coerced to a real boolean (a preset stores 'true'/1 just as happily). */
const BOOLEAN_SETTINGS: ReadonlySet<keyof StudioSettings> = new Set(['rsvpReticle'])

/** Fallbacks for the non-numeric settings above — an unusable value returns here. */
const NON_NUMERIC_FALLBACKS: Partial<Record<keyof StudioSettings, string | boolean>> = {
  readingMode: 'wrap',
  rsvpFocusColor: RSVP_DEFAULT_FOCUS_COLOR,
  rsvpReticle: true,
}

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

/** Every key the non-numeric path handles — derived, so no list can drift. */
const NON_NUMERIC_SETTING_KEYS: readonly (keyof StudioSettings)[] = [
  ...(Object.keys(ENUM_SETTING_VALUES) as (keyof StudioSettings)[]),
  ...COLOR_SETTINGS,
  ...BOOLEAN_SETTINGS,
]

/**
 * Strict read of one non-numeric setting: the coerced value, or `undefined` when
 * the input isn't a legal value for that field (or the key isn't enrolled).
 *
 * This is the reading a LIVE PATCH wants — `applySettingsCommand`'s
 * `set_settings`, where the current value is known-good and still on screen. An
 * agent typo (`readingMode: 'turbo'`) must leave the user where they are, exactly
 * as the numeric path drops an unusable number; substituting the default there
 * would silently drag someone out of RSVP and report success.
 */
export function coerceNonNumericSettingValue(
  key: keyof StudioSettings,
  value: unknown
): string | boolean | undefined {
  const allowed = ENUM_SETTING_VALUES[key]
  if (allowed) {
    const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
    return allowed.includes(raw) ? raw : undefined
  }
  if (COLOR_SETTINGS.has(key)) {
    const raw = typeof value === 'string' ? value.trim() : ''
    return HEX_COLOR_RE.test(raw) ? raw : undefined
  }
  if (BOOLEAN_SETTINGS.has(key)) {
    if (typeof value === 'boolean') return value
    if (value === 'true' || value === 1) return true
    if (value === 'false' || value === 0) return false
    return undefined
  }
  return undefined
}

/**
 * Coerce one non-numeric setting (enum / hex colour / boolean) into a value the
 * backend accepts, falling back to the field's default when it can't.
 *
 * Unlike `coerceNonNumericSettingValue` (and the numeric path) this NEVER returns
 * undefined for an enrolled key — it is for REPAIRING STORED DATA: a garbage enum
 * or colour that is already sitting in a saved project or preset has no
 * "keep the current value" reading, and letting it through means every later
 * render fails schema validation.
 */
export function sanitizeNonNumericSettingValue(
  key: keyof StudioSettings,
  value: unknown
): string | boolean | undefined {
  const clean = coerceNonNumericSettingValue(key, value)
  if (clean !== undefined) return clean
  return NON_NUMERIC_FALLBACKS[key]
}

/** True when `key` is a non-numeric setting this module knows how to repair. */
export function isSanitizedNonNumericSetting(key: string): key is keyof StudioSettings {
  return NON_NUMERIC_SETTING_KEYS.includes(key as keyof StudioSettings)
}

/**
 * Coerce one numeric setting into the range the backend accepts.
 *
 * Returns `undefined` when the value isn't usable as a number at all — the
 * caller drops the key so the current (valid) value survives. Silently
 * substituting a default here would be worse: it looks like the write landed.
 */
export function sanitizeSettingValue(
  key: keyof StudioSettings,
  value: unknown
): number | undefined {
  const spec = NUMERIC_SETTING_SPECS[key]
  if (!spec) return undefined

  const raw = typeof value === 'number' ? value : parseFloat(String(value))
  if (!Number.isFinite(raw)) return undefined

  // Percentage written into a 0–1 field (the `shadowOpacity: 90` mistake).
  let n = spec.fraction && raw > 1 && raw <= 100 ? raw / 100 : raw

  if (spec.min != null) n = Math.max(spec.min, n)
  if (spec.max != null) n = Math.min(spec.max, n)
  if (spec.int) n = Math.round(n)
  return n
}

/** True when `key` is a numeric setting this module knows how to bound. */
export function isNumericSetting(key: string): key is keyof StudioSettings {
  return key in NUMERIC_SETTING_SPECS
}

/**
 * Sanitize every bounded field of a whole settings object, returning a NEW one.
 * Used on data assembled from a preset or a restored project file, where the
 * bad value may already be sitting in storage from an earlier session.
 */
export function sanitizeSettings(settings: StudioSettings): StudioSettings {
  const next = { ...settings }
  for (const key of Object.keys(NUMERIC_SETTING_SPECS) as (keyof StudioSettings)[]) {
    const clean = sanitizeSettingValue(key, settings[key])
    if (clean != null && clean !== settings[key]) {
      ;(next as unknown as Record<string, unknown>)[key] = clean
    }
  }
  for (const key of NON_NUMERIC_SETTING_KEYS) {
    const clean = sanitizeNonNumericSettingValue(key, settings[key])
    if (clean != null && clean !== settings[key]) {
      ;(next as unknown as Record<string, unknown>)[key] = clean
    }
  }
  return next
}
