/**
 * Dotted-version comparison for the renderer.
 *
 * A twin of `electron/update-check.js`'s `compareVersions` — the same
 * normalisation (drop everything from the first `-`, split on `.`, an
 * unparseable or missing part is 0) narrowed to the sign, plus a tolerated
 * leading `v` because release tags carry one. `version.test.ts` pins the two
 * against each other.
 */

/** Numeric parts of `v2.6.0-rc1` → `[2, 6, 0]`. */
function parts(version: string): number[] {
  return String(version)
    .trim()
    .replace(/^v/i, '')
    .split('-')[0]
    .split('.')
    .map((part) => parseInt(part, 10) || 0)
}

/** -1 when `a` is older than `b`, 1 when newer, 0 when they are the same release. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parts(a)
  const pb = parts(b)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const da = pa[i] || 0
    const db = pb[i] || 0
    if (da !== db) return da > db ? 1 : -1
  }
  return 0
}
