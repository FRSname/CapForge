/**
 * Keeps a broken macOS font record from killing every WhisperX import.
 *
 * WhisperX pulls in pyannote, which imports `matplotlib.pyplot`, which builds
 * Matplotlib's font cache at import time. On macOS that asks
 * `system_profiler -xml SPFontsDataType` for the installed fonts and reads the
 * answer with `d["_items"]` — and on macOS 27 the answer can come back without
 * that key (or with an entry that has no `path`). The `KeyError` is raised
 * while the module is still importing, so nothing that imports WhisperX can
 * run: first-run setup dies in `whisperx.load_model` (issue #77), and so would
 * transcription. Upstream: matplotlib/matplotlib#32328, fixed for 3.11.3,
 * which was not released when this was written.
 *
 * The crash is at import time, so it cannot be caught or monkeypatched from our
 * own Python; the one-line function is rewritten in the managed runtime's copy
 * instead. Like `text-shaping.js`, this runs during first-run setup *and*
 * before every backend spawn: idempotent, a no-op once Matplotlib ships its
 * own fix (the unsafe line is gone), and it repairs an already-installed
 * runtime without a `RUNTIME_VERSION` bump (which would reinstall torch).
 * Only the managed runtime is ours to touch — never a dev venv.
 *
 * Pure decision + one atomic write, no Electron: `matplotlib-fonts.test.js`
 * runs it under `node --test` against a temp dir.
 */

/** The line as Matplotlib ≤ 3.11.2 ships it, indentation included. */
const UNSAFE_LINE = '    return [Path(entry["path"]) for entry in d["_items"]]'

/** Same result on a healthy record; an empty list instead of a KeyError otherwise. */
const SAFE_LINE =
  '    return [Path(entry["path"]) for entry in d.get("_items", []) if "path" in entry]'

/** `_get_macos_fonts` is only ever called on macOS. */
const AFFECTED_PLATFORM = 'darwin'

const PYTHON_LIB_DIR = /^python3\.\d+$/
const FONT_MANAGER_REL = ['site-packages', 'matplotlib', 'font_manager.py']
const TEMP_SUFFIX = '.capforge-tmp'

/**
 * Rewrite the unsafe line in a `font_manager.py` source. Returns the (possibly
 * unchanged) source and what was found: `'patched'`, `'present'` (already
 * rewritten) or `'not-needed'` (a Matplotlib that no longer has the line).
 *
 * @param {string} source
 * @returns {{ source: string, status: 'patched' | 'present' | 'not-needed' }}
 */
function patchFontManagerSource(source) {
  if (source.includes(SAFE_LINE)) return { source, status: 'present' }
  if (!source.includes(UNSAFE_LINE)) return { source, status: 'not-needed' }
  return { source: source.replace(UNSAFE_LINE, SAFE_LINE), status: 'patched' }
}

/**
 * Every `lib/python3.x/site-packages/matplotlib/font_manager.py` under the
 * managed interpreter. Empty when Matplotlib is not installed (yet).
 *
 * @returns {string[]}
 */
function findFontManagerFiles({ pythonDir, fs, path }) {
  const libDir = path.join(pythonDir, 'lib')
  if (!fs.existsSync(libDir)) return []
  return fs
    .readdirSync(libDir)
    .filter((name) => PYTHON_LIB_DIR.test(name))
    .map((name) => path.join(libDir, name, ...FONT_MANAGER_REL))
    .filter((file) => fs.existsSync(file))
}

/** Tmp + rename, so an interrupted write never leaves half a module behind. */
function writeFileAtomic(file, content, fs) {
  const tmp = file + TEMP_SUFFIX
  try {
    fs.writeFileSync(tmp, content)
    fs.renameSync(tmp, file)
  } catch (err) {
    fs.rmSync(tmp, { force: true })
    throw err
  }
}

/**
 * Make the managed runtime's Matplotlib tolerate an incomplete font record.
 * Returns what happened — `'patched'`, `'present'`, `'not-needed'`, `'missing'`
 * (no Matplotlib found), `'skipped'` (not macOS) or `'error'` — and never
 * throws: setup and the backend must carry on either way, and if the patch
 * could not be written the original error still surfaces with its traceback.
 *
 * @returns {'patched' | 'present' | 'not-needed' | 'missing' | 'skipped' | 'error'}
 */
function ensureMatplotlibFontGuard({ platformName, pythonDir, fs, path, log = console }) {
  if (platformName !== AFFECTED_PLATFORM) return 'skipped'
  try {
    const files = findFontManagerFiles({ pythonDir, fs, path })
    if (files.length === 0) return 'missing'
    const statuses = files.map((file) => {
      const { source, status } = patchFontManagerSource(fs.readFileSync(file, 'utf-8'))
      if (status === 'patched') {
        writeFileAtomic(file, source, fs)
        log.log(`[CapForge] Matplotlib font listing made tolerant of a broken font record: ${file}`)
      }
      return status
    })
    return ['patched', 'present'].find((s) => statuses.includes(s)) || 'not-needed'
  } catch (err) {
    log.warn(
      `[CapForge] Could not patch Matplotlib's font listing (${err.message}) — ` +
        'on macOS a broken system font record may stop WhisperX from loading.',
    )
    return 'error'
  }
}

module.exports = {
  UNSAFE_LINE,
  SAFE_LINE,
  patchFontManagerSource,
  findFontManagerFiles,
  ensureMatplotlibFontGuard,
}
