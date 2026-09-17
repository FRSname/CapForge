/**
 * The filled fraction of a range input, as the CSS percentage the styled
 * slider track paints up to (`--fill` in globals.css). Pure so the six range
 * inputs share one rounding and one clamp: a value outside `[min, max]` fills
 * to the nearest end, and a degenerate range (`max <= min`) fills nothing.
 */
export function rangeFill(value: number, min: number, max: number): string {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return '0%'
  }
  const fraction = Math.min(1, Math.max(0, (value - min) / (max - min)))
  return `${Math.round(fraction * 1000) / 10}%`
}
