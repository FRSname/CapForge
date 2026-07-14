/**
 * Pure, import-safe path-existence validation for renderer-supplied paths
 * used by Electron IPC handlers (`shell:showInFolder`, `studio:open`).
 *
 * The bar here is existence + resolution, NOT containment — these handlers
 * legitimately operate on arbitrary user-chosen paths (export output dirs,
 * generated project folders), so we deliberately do not allowlist a parent
 * directory. See docs/plans/bug-audit-fixes-2026-07.md Phase 3.
 *
 * `fs`/`path` are injected so this module has zero Electron dependency and
 * can be unit-tested with `node --test electron/path-validate.test.js` —
 * mirrors the pattern in `preset-io.js`.
 */

/**
 * Validate that `input` is a non-empty string that resolves to an existing
 * path (file or directory — `shell.showItemInFolder` is happy to reveal
 * either). The bar is existence + resolution, not a file-type check.
 *
 * @param {unknown} input - renderer-supplied path
 * @param {{ fs: typeof import('fs'), path: typeof import('path') }} deps
 * @returns {{ ok: true, resolved: string } | { ok: false, error: string }}
 */
function resolveExistingFile(input, { fs, path }) {
  if (typeof input !== 'string' || input.trim() === '') {
    return { ok: false, error: 'No file path provided.' }
  }
  const resolved = path.resolve(input)
  if (!fs.existsSync(resolved)) {
    return { ok: false, error: 'File not found.' }
  }
  return { ok: true, resolved }
}

/**
 * Validate that `input` is a non-empty string that resolves to an existing
 * directory.
 *
 * @param {unknown} input - renderer-supplied path
 * @param {{ fs: typeof import('fs'), path: typeof import('path') }} deps
 * @returns {{ ok: true, resolved: string } | { ok: false, error: string }}
 */
function resolveExistingDir(input, { fs, path }) {
  if (typeof input !== 'string' || input.trim() === '') {
    return { ok: false, error: 'No project folder to open.' }
  }
  const resolved = path.resolve(input)
  if (!fs.existsSync(resolved)) {
    return { ok: false, error: 'Project folder not found.' }
  }
  let stat
  try {
    stat = fs.statSync(resolved)
  } catch {
    return { ok: false, error: 'Project folder not found.' }
  }
  if (!stat.isDirectory()) {
    return { ok: false, error: 'Path is not a folder.' }
  }
  return { ok: true, resolved }
}

/**
 * Naive prefix-based containment check — `candidate.startsWith(dir)`. This is
 * the existing style used by the `fonts:read` / `fonts:delete` IPC handlers
 * in `main.js` to keep font operations scoped to the app's own fonts dirs.
 *
 * NOTE: unlike the backend's `_is_servable_path` (realpath-resolved, see
 * CLAUDE.md "Local media token"), this is a plain string prefix check — it
 * does not realpath-resolve symlinks and can false-positive on a sibling
 * directory that merely shares a prefix (e.g. dir `/a/fonts` "contains"
 * `/a/fonts-evil/x`). Extracted verbatim for testability, not hardened —
 * that would be a behavior change out of scope here.
 *
 * @param {unknown} candidate
 * @param {string} dir
 * @returns {boolean}
 */
function isUnderDir(candidate, dir) {
  return typeof candidate === 'string' && candidate.startsWith(dir)
}

module.exports = {
  resolveExistingFile,
  resolveExistingDir,
  isUnderDir,
}
