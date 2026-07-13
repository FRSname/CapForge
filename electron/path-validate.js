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

module.exports = {
  resolveExistingFile,
  resolveExistingDir,
}
