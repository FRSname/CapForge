/**
 * The small readers every publish boundary guard is built from — each takes an
 * untyped JSON value and returns a defined one, never throwing.
 *
 * Shared by `lib/publishTypes.ts` and `lib/publishMediaTypes.ts` so the two
 * guards read a string, a number or a list exactly the same way.
 *
 * Pure module: no React, no `window`, no I/O.
 */

/** A plain object, or null for anything else (arrays included). */
export function obj(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

/** A finite number, or `fallback`. */
export function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

export function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function bool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/** The string entries of a list; anything that is not a list is empty. */
export function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

/** The object rows of a list, each read by `read`; non-object rows are dropped. */
export function rows<T>(value: unknown, read: (row: Record<string, unknown>) => T): T[] {
  if (!Array.isArray(value)) return []
  return value
    .map((row) => obj(row))
    .filter((row): row is Record<string, unknown> => row !== null)
    .map(read)
}
