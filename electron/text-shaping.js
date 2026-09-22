/**
 * Where the text-shaping library goes so Pillow can find it.
 *
 * Pillow's wheels compile libraqm in (HarfBuzz shaping — the OpenType features
 * a font needs for its contextual alternates and ligatures, issue #73) but load
 * FriBiDi at runtime through a bare-name `dlopen("libfribidi.dylib")` /
 * `LoadLibrary("fribidi-0")`. Where those look is decided by the OS, not by us:
 *
 * - macOS: the managed Python is a hardened, Developer-ID-signed binary, so
 *   dyld strips every DYLD_* variable from its environment and refuses to
 *   search the working directory. The one place it does resolve a bare name is
 *   the interpreter's own rpath, `@executable_path/../lib` — `<pythonDir>/lib/`.
 * - Windows: the directory of `python.exe` is first in the DLL search order,
 *   so `<pythonDir>/fribidi-0.dll` (meson's MSVC output name; Pillow also
 *   accepts `fribidi.dll` and `libfribidi-0.dll`).
 *
 * The library ships in `resources/bin-<platform>/` beside ffmpeg (built by
 * `.github/workflows/build-fribidi.yml`, signed with the rest of the bundle on
 * macOS) and is copied beside the interpreter before every backend spawn:
 * idempotent, ~170 KB, and it repairs an already-installed runtime without a
 * `RUNTIME_VERSION` bump (which would reinstall torch). A missing library means
 * no shaping, never a failed launch — the backend logs the engine it got.
 *
 * Pure decision + one copy, no Electron: `text-shaping.test.js` runs it under
 * `node --test` against a temp dir.
 */

const SHAPING_LIBS = {
  darwin: { names: ['libfribidi.dylib'], destDir: ['lib'] },
  win32: { names: ['fribidi-0.dll', 'fribidi.dll', 'libfribidi-0.dll'], destDir: [] },
}

/**
 * The copy the platform needs, or `null` when there is nothing to copy
 * (unsupported platform, or no library bundled in `binDir`).
 */
function resolveShapingLibCopy({ platformName, binDir, pythonDir, fs, path }) {
  const spec = SHAPING_LIBS[platformName]
  if (!spec) return null
  for (const name of spec.names) {
    const src = path.join(binDir, name)
    if (fs.existsSync(src)) {
      return { src, dest: path.join(pythonDir, ...spec.destDir, name) }
    }
  }
  return null
}

/**
 * Put the bundled library beside the managed interpreter. Returns what
 * happened — `'copied'`, `'present'` (byte-identical copy already there),
 * `'missing'` (nothing bundled for this platform) or `'error'` — and never
 * throws: the backend must start either way.
 */
function ensureShapingLib({ platformName, binDir, pythonDir, fs, path, log = console }) {
  try {
    const plan = resolveShapingLibCopy({ platformName, binDir, pythonDir, fs, path })
    if (!plan) return 'missing'
    const wanted = fs.readFileSync(plan.src)
    if (fs.existsSync(plan.dest) && wanted.equals(fs.readFileSync(plan.dest))) return 'present'
    fs.mkdirSync(path.dirname(plan.dest), { recursive: true })
    fs.copyFileSync(plan.src, plan.dest)
    log.log(`[CapForge] Text-shaping library installed: ${plan.dest}`)
    return 'copied'
  } catch (err) {
    log.warn(
      `[CapForge] Could not install the text-shaping library (${err.message}) — ` +
        'fonts render without OpenType features.',
    )
    return 'error'
  }
}

module.exports = { SHAPING_LIBS, resolveShapingLibCopy, ensureShapingLib }
