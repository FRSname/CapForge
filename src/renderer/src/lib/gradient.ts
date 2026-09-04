/**
 * Gradient colour core — the pure scalar half shared by all three renderers.
 *
 * A caption colour setting (`textColor`, `bgColor`) is a string that is *either*
 * a plain `#RRGGBB` hex — the value space it has always had, and the untouched
 * fast path — *or* a restricted linear-gradient string:
 *
 * ```
 * linear-gradient(135deg, #FF0080 0%, #7928CA 100%)
 * ```
 *
 * ## This file has two twins
 *
 * The same grammar and the same formulas exist in:
 *   - `backend/exporters/gradient.py` (Pillow renderer, the source of truth)
 *   - `GRADIENT_RUNTIME_JS` in `backend/exporters/hyperframes_gradient_runtime.py`
 *     (HTML/GSAP layer)
 *
 * Change one and you must change all three. All three are pinned by the same
 * literal fixture, `backend/tests/fixtures/gradient_cases.json`, which the TS,
 * Python and embedded-JS suites all read — never hand-write an expected value
 * here.
 *
 * ## Invariants
 *
 * - **Purely scalar.** No canvas, no DOM, no fonts. Turning a spec into a
 *   `CanvasGradient` is the caller's job (`useSubtitleOverlay`).
 * - **Parsing is a trust boundary.** A `.cfpreset`, a restored `.cfproj` and an
 *   MCP `set_style` all reach {@link parseGradient}, and the HTML layer
 *   interpolates the result into CSS — so the grammar is a closed subset and
 *   anything outside it is rejected rather than repaired.
 * - **The gradient line is the CSS one.** `0deg` points to the top, the angle
 *   increases clockwise, and the line is long enough that the first and last
 *   stops land on opposite corners (length `|W·sin a| + |H·cos a|`). Invisible
 *   at 0/90/180/270° and wrong at every other angle — hence the fixture.
 */

/** Only `linear-gradient` is accepted; a second kind would be a new branch. */
export const GRADIENT_PREFIX = 'linear-gradient('

/** Bounds the parse work an untrusted preset can ask for. */
export const MAX_GRADIENT_LENGTH = 512

export const MIN_STOPS = 2
export const MAX_STOPS = 8

/** One colour stop: `offset` is a 0–1 fraction, `color` a canonical `#RRGGBB`. */
export interface GradientStop {
  offset: number
  color: string
}

/** A parsed gradient. `angle` is normalised into `[0, 360)` degrees. */
export interface GradientSpec {
  angle: number
  stops: GradientStop[]
}

/** `(left, top, width, height)` in the renderer's pixel space (y grows down). */
export type GradientBox = readonly [number, number, number, number]

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
const ANGLE_RE = /^([+-]?(?:\d+\.?\d*|\.\d+))deg$/
const STOP_RE = /^(#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}))\s+([+-]?(?:\d+\.?\d*|\.\d+))%$/

/** `'#abc'` / `'#AaBbCc'` → canonical `'#AABBCC'`. Assumes a matched hex. */
export function normalizeHex(value: string): string {
  let h = value.trim().replace(/^#/, '')
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  return '#' + h.toUpperCase()
}

/**
 * The safe flat-colour reading of `value`, or `fallback`.
 *
 * Deliberately scoped to the fields whose value space this change *widened*
 * (`textColor`, `bgColor`): a malformed gradient string from a preset would
 * otherwise be handed to the backend's `_hex_to_rgba` and abort the render.
 */
export function flatHex(value: unknown, fallback: string): string {
  if (typeof value === 'string' && HEX_RE.test(value.trim())) return normalizeHex(value)
  return fallback
}

/**
 * A single `#RRGGBB` reading of `value`, whatever it holds.
 *
 * For the consumers that *cannot* take a gradient — the highlight pill's text
 * colour falling back to `bgColor`, a per-word background box inheriting the
 * global one — a gradient reads as its **first stop**, which keeps the
 * inherited colour recognisably related to the gradient instead of snapping to
 * an unrelated default. Anything unusable falls back, via {@link flatHex}.
 */
export function flatColor(value: unknown, fallback: string): string {
  const spec = parseGradient(value)
  if (spec !== null) return spec.stops[0].color
  return flatHex(value, fallback)
}

/**
 * Parse a restricted linear-gradient string, or `null`.
 *
 * `null` covers both "plain hex, keep the flat path" and "malformed gradient,
 * rejected" — the caller cannot tell them apart and does not need to, because
 * {@link flatHex} gives the malformed case a safe reading.
 */
export function parseGradient(value: unknown): GradientSpec | null {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (raw.length > MAX_GRADIENT_LENGTH) return null
  if (!raw.toLowerCase().startsWith(GRADIENT_PREFIX) || !raw.endsWith(')')) return null

  const inner = raw.slice(GRADIENT_PREFIX.length, -1)
  // No nested parens: closes off `url(...)`, a second gradient, and any `)`
  // that would let trailing declarations ride along into the CSS.
  if (inner.includes('(') || inner.includes(')')) return null

  const parts = inner.split(',').map((p) => p.trim())
  if (parts.length < 1 + MIN_STOPS || parts.length > 1 + MAX_STOPS) return null

  const angleMatch = ANGLE_RE.exec(parts[0])
  if (!angleMatch) return null
  // JS `%` keeps the sign of the dividend where Python's does not, so a
  // negative angle needs the extra turn to land in [0, 360) like the twin.
  const angle = ((Number(angleMatch[1]) % 360) + 360) % 360

  const stops: GradientStop[] = []
  let previous = -1
  for (const part of parts.slice(1)) {
    const stopMatch = STOP_RE.exec(part)
    if (!stopMatch) return null
    const percent = Number(stopMatch[2])
    if (!(percent >= 0 && percent <= 100)) return null
    const offset = percent / 100
    // Non-decreasing: an out-of-order stop is a typo, and the three renderers'
    // native gradient APIs disagree about how to fix one.
    if (offset < previous) return null
    previous = offset
    stops.push({ offset, color: normalizeHex(stopMatch[1]) })
  }

  return { angle, stops }
}

/**
 * CSS gradient line for `spec` over `box` → `[x0, y0, x1, y1]`, the points where
 * the `0%` and `100%` stops sit. Feed straight to `ctx.createLinearGradient`.
 */
export function gradientLine(
  spec: GradientSpec,
  box: GradientBox
): [number, number, number, number] {
  const [left, top, width, height] = box
  const radians = (spec.angle * Math.PI) / 180
  const sinA = Math.sin(radians)
  const cosA = Math.cos(radians)
  // "Magic corner": long enough that 0% and 100% land on opposite corners.
  const length = Math.abs(width * sinA) + Math.abs(height * cosA)
  const centerX = left + width / 2
  const centerY = top + height / 2
  const halfX = (sinA * length) / 2
  const halfY = (cosA * length) / 2
  // y is negated because 0deg points to the *top* and y grows downward.
  return [centerX - halfX, centerY + halfY, centerX + halfX, centerY - halfY]
}

/** Shortest fixed-point form, ≤4 decimals — identical in all three copies. */
function formatNumber(value: number): string {
  const text = value.toFixed(4).replace(/\.?0+$/, '')
  return text === '' || text === '-' ? '0' : text
}

/**
 * Re-emit `spec` as a canonical CSS string.
 *
 * Built from the *parsed* spec, never from the caller's raw string — that is
 * what makes the grammar's closure an actual injection guard.
 */
export function gradientToCss(spec: GradientSpec): string {
  const stops = spec.stops
    .map((stop) => `${stop.color} ${formatNumber(stop.offset * 100)}%`)
    .join(', ')
  return `linear-gradient(${formatNumber(spec.angle)}deg, ${stops})`
}
