/**
 * Numeric-range guard for StudioSettings coming from OUTSIDE the UI controls.
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
 */

import type { StudioSettings } from '../components/studio/StudioPanel'

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
 * Sanitize every numeric field of a whole settings object, returning a NEW one.
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
  return next
}
