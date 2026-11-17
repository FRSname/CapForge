/**
 * Pure-logic tests for matplotlib-fonts. Run with the built-in node runner:
 *   node --test electron/matplotlib-fonts.test.js
 * No electron required: a temp dir stands in for the managed Python runtime.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  UNSAFE_LINE,
  SAFE_LINE,
  patchFontManagerSource,
  findFontManagerFiles,
  ensureMatplotlibFontGuard,
} = require('./matplotlib-fonts')

const quiet = { log() {}, warn() {} }

/** The function as Matplotlib 3.11.0–3.11.2 ships it. */
const UPSTREAM = [
  'def _get_macos_fonts():',
  '    """Cache and list the font paths known to ``system_profiler SPFontsDataType``."""',
  '    try:',
  '        d, = plistlib.loads(',
  '            subprocess.check_output(["system_profiler", "-xml", "SPFontsDataType"]))',
  '    except (OSError, subprocess.CalledProcessError, plistlib.InvalidFileException):',
  '        return []',
  '    return [Path(entry["path"]) for entry in d["_items"]]',
  '',
  '',
  'def findSystemFonts(fontpaths=None, fontext="ttf"):',
  '    pass',
  '',
].join('\n')

function scratch(pythonVersions = ['python3.11']) {
  const pythonDir = fs.mkdtempSync(path.join(os.tmpdir(), 'capforge-mpl-'))
  const files = pythonVersions.map((version) => {
    const dir = path.join(pythonDir, 'lib', version, 'site-packages', 'matplotlib')
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'font_manager.py')
    fs.writeFileSync(file, UPSTREAM)
    return file
  })
  return { pythonDir, files }
}

test('the unsafe line is replaced by one that tolerates a missing key', () => {
  const { source, status } = patchFontManagerSource(UPSTREAM)
  assert.equal(status, 'patched')
  assert.ok(!source.includes(UNSAFE_LINE))
  assert.ok(source.includes(SAFE_LINE))
  // Nothing else in the file moves.
  assert.equal(source, UPSTREAM.replace(UNSAFE_LINE, SAFE_LINE))
})

test('an already patched source is left alone', () => {
  const once = patchFontManagerSource(UPSTREAM).source
  assert.deepEqual(patchFontManagerSource(once), { source: once, status: 'present' })
})

test('a Matplotlib without the unsafe line (a fixed release) is not touched', () => {
  const fixed = UPSTREAM.replace(UNSAFE_LINE, '    return _safe_paths(d)')
  assert.deepEqual(patchFontManagerSource(fixed), { source: fixed, status: 'not-needed' })
})

test('CRLF line endings survive the patch', () => {
  const crlf = UPSTREAM.replace(/\n/g, '\r\n')
  const { source, status } = patchFontManagerSource(crlf)
  assert.equal(status, 'patched')
  assert.equal(source, crlf.replace(UNSAFE_LINE, SAFE_LINE))
})

test('font_manager.py is found under any lib/python3.x', () => {
  const { pythonDir, files } = scratch(['python3.11', 'python3.12'])
  assert.deepEqual(findFontManagerFiles({ pythonDir, fs, path }).sort(), [...files].sort())
})

test('no lib directory means no files, not a throw', () => {
  const pythonDir = fs.mkdtempSync(path.join(os.tmpdir(), 'capforge-mpl-'))
  assert.deepEqual(findFontManagerFiles({ pythonDir, fs, path }), [])
})

test('macOS: the installed file is patched once, then reported present', () => {
  const { pythonDir, files } = scratch()
  const args = { platformName: 'darwin', pythonDir, fs, path, log: quiet }
  assert.equal(ensureMatplotlibFontGuard(args), 'patched')
  assert.ok(fs.readFileSync(files[0], 'utf-8').includes(SAFE_LINE))
  assert.equal(ensureMatplotlibFontGuard(args), 'present')
  // No temp file is left beside the module.
  assert.deepEqual(fs.readdirSync(path.dirname(files[0])), ['font_manager.py'])
})

test('other platforms never call the function, so nothing is touched', () => {
  const { pythonDir, files } = scratch()
  const result = ensureMatplotlibFontGuard({ platformName: 'win32', pythonDir, fs, path, log: quiet })
  assert.equal(result, 'skipped')
  assert.equal(fs.readFileSync(files[0], 'utf-8'), UPSTREAM)
})

test('Matplotlib not installed yet is reported, not thrown', () => {
  const pythonDir = fs.mkdtempSync(path.join(os.tmpdir(), 'capforge-mpl-'))
  const result = ensureMatplotlibFontGuard({ platformName: 'darwin', pythonDir, fs, path, log: quiet })
  assert.equal(result, 'missing')
})

test('a write failure is logged and reported, never thrown', () => {
  const { pythonDir } = scratch()
  const warnings = []
  const brokenFs = {
    ...fs,
    writeFileSync() {
      throw new Error('EACCES')
    },
  }
  const result = ensureMatplotlibFontGuard({
    platformName: 'darwin',
    pythonDir,
    fs: brokenFs,
    path,
    log: { log() {}, warn: (m) => warnings.push(m) },
  })
  assert.equal(result, 'error')
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /EACCES/)
})
