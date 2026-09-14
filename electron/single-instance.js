/**
 * Single-instance argv parsing.
 *
 * CapForge holds a single-instance lock (`app.requestSingleInstanceLock()`), so
 * a second launch — double-clicking a video with CapForge as the handler, or
 * `open -a CapForge clip.mp4` — quits itself and hands its argv to the running
 * instance's `second-instance` event. This module turns that argv into the
 * media path the user meant, if any.
 *
 * Pure: no electron, no filesystem. Existence is the renderer's problem (it
 * already reports a missing file), and keeping it pure is what lets this run
 * under `node --test electron/single-instance.test.js`.
 */

/**
 * Media extensions CapForge accepts, mirroring the renderer's DropZone list.
 * Lowercase and dotless.
 */
const MEDIA_EXTENSIONS = ['mp3', 'wav', 'm4a', 'flac', 'aac', 'ogg', 'mp4', 'mkv', 'webm', 'mov']

/** argv[0] is the executable (packaged) or the electron binary (dev). */
const FIRST_CANDIDATE_INDEX = 1

/**
 * True when `value` ends in one of `MEDIA_EXTENSIONS`, case-insensitively.
 * The dot is required, so `videomp4` does not match.
 *
 * @param {string} value
 * @returns {boolean}
 */
function looksLikeMediaPath(value) {
  const lower = value.toLowerCase()
  return MEDIA_EXTENSIONS.some((ext) => lower.endsWith(`.${ext}`))
}

/**
 * The first media path in a process argv, or `null` when there is none.
 *
 * Skips argv[0] (the executable), anything starting with `-` (a flag — even
 * `--trace=warnings.mp4`) and anything that is not a media path (the dev
 * script argument `.`, a `.capforge` project, …).
 *
 * @param {unknown} argv - `process.argv` or the `second-instance` argv
 * @returns {string | null}
 */
function firstMediaArg(argv) {
  if (!Array.isArray(argv)) return null
  for (let i = FIRST_CANDIDATE_INDEX; i < argv.length; i += 1) {
    const arg = argv[i]
    if (typeof arg !== 'string') continue
    const trimmed = arg.trim()
    if (trimmed === '' || trimmed.startsWith('-')) continue
    if (looksLikeMediaPath(trimmed)) return arg
  }
  return null
}

module.exports = {
  MEDIA_EXTENSIONS,
  firstMediaArg,
}
