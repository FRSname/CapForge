/**
 * Filesystem helpers for the v3 library (docs/plans/library-home-screen.md).
 *
 * The backend owns the library's *contents* but never deletes user files — it
 * detaches a record by moving its folder aside and hands the path back, and
 * Electron is what puts that folder in the Trash. `assertTrashable` is the
 * guard on that hand-off: a compromised or simply buggy renderer must not be
 * able to talk `shell.trashItem` into eating an arbitrary folder.
 *
 * Deliberately imports no Electron, so it runs under plain
 * `node --test electron/library-fs.test.js`.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

/** CapForge's data home under the user's home directory, when unconfigured. */
const DEFAULT_HOME_DIRNAME = '.capforge'

/** The library lives in this subfolder of the data home. */
const LIBRARY_DIRNAME = 'library'

/** Single refusal message — deliberately says nothing about the real paths. */
const TRASH_REFUSED_MESSAGE = 'Refusing to trash a path outside the library'

/** Windows and macOS compare paths case-insensitively; Linux does not. */
const CASE_INSENSITIVE_FS = process.platform === 'win32' || process.platform === 'darwin'

/**
 * Expand a leading `~` to the user's home directory. Only the leading segment
 * is expanded (`~/x` and `~`), never a `~` in the middle of a path.
 *
 * @param {string} input
 * @returns {string}
 */
function expandTilde(input) {
  if (input === '~') return os.homedir()
  if (input.startsWith(`~${path.sep}`) || input.startsWith('~/')) {
    return path.join(os.homedir(), input.slice(2))
  }
  return input
}

/**
 * CapForge's data home: `$CAPFORGE_HOME` when set, else `~/.capforge`.
 * The one resolver — `skills-store.js` calls this rather than repeating it.
 *
 * @returns {string} absolute path (not guaranteed to exist)
 */
function capforgeHome() {
  const configured = process.env.CAPFORGE_HOME
  if (typeof configured === 'string' && configured.trim() !== '') {
    return path.resolve(expandTilde(configured.trim()))
  }
  return path.join(os.homedir(), DEFAULT_HOME_DIRNAME)
}

/**
 * The library root the backend writes records into.
 *
 * @returns {string} absolute path (not guaranteed to exist)
 */
function libraryRoot() {
  return path.join(capforgeHome(), LIBRARY_DIRNAME)
}

/**
 * Resolve `target` through symlinks. A path that does not exist yet still
 * resolves: the nearest existing ancestor is realpath'd and the missing tail
 * re-appended, so a record folder the backend already moved away cannot slip
 * past the guard just by being gone.
 *
 * @param {string} target
 * @returns {string} absolute, symlink-free path
 */
function realResolve(target) {
  const absolute = path.resolve(target)
  let current = absolute
  const tail = []
  for (;;) {
    try {
      return path.join(fs.realpathSync(current), ...tail)
    } catch {
      const parent = path.dirname(current)
      if (parent === current) return absolute // hit the filesystem root
      tail.unshift(path.basename(current))
      current = parent
    }
  }
}

/**
 * True when `child` sits strictly inside `parent` — not equal to it, and not a
 * sibling that merely shares its prefix (`library` vs `libraryX`).
 *
 * @param {string} child - already resolved
 * @param {string} parent - already resolved
 * @returns {boolean}
 */
function isStrictlyInside(child, parent) {
  const a = CASE_INSENSITIVE_FS ? child.toLowerCase() : child
  const b = CASE_INSENSITIVE_FS ? parent.toLowerCase() : parent
  if (a === b) return false
  return a.startsWith(b.endsWith(path.sep) ? b : b + path.sep)
}

/**
 * Guard for `library:trash-folder`: resolve `folderPath` through symlinks and
 * require it to sit strictly inside the library root. Refuses the root itself,
 * `..` traversals, sibling-prefix directories and symlinks pointing out.
 *
 * @param {unknown} folderPath - renderer-supplied path
 * @returns {string} the resolved, symlink-free path to hand `shell.trashItem`
 * @throws {Error} `TRASH_REFUSED_MESSAGE` when the path is not in the library
 */
function assertTrashable(folderPath) {
  if (typeof folderPath !== 'string' || folderPath.trim() === '') {
    throw new Error(TRASH_REFUSED_MESSAGE)
  }
  const resolved = realResolve(folderPath)
  const root = realResolve(libraryRoot())
  if (!isStrictlyInside(resolved, root)) {
    throw new Error(TRASH_REFUSED_MESSAGE)
  }
  return resolved
}

module.exports = {
  DEFAULT_HOME_DIRNAME,
  LIBRARY_DIRNAME,
  TRASH_REFUSED_MESSAGE,
  capforgeHome,
  libraryRoot,
  assertTrashable,
}
