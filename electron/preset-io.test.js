/**
 * Pure-logic tests for preset-io — the .cfpreset export/import trust
 * boundary. Run with the built-in node runner:
 *   node --test electron/preset-io.test.js
 * No electron required — every export here is a pure, import-safe helper
 * (fs/path are injected only into `classifyFont`, mirrored from the module).
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')

const {
  PRESET_FILE_TYPE,
  PRESET_FILE_VERSION,
  MAX_FONT_BYTES,
  classifyFont,
  buildPresetExport,
  parsePresetImport,
  uniquePresetName,
} = require('./preset-io')

// --- parsePresetImport: type/version/name gates -----------------------------

test('parsePresetImport rejects a non-object payload', () => {
  assert.throws(() => parsePresetImport(null), /not a valid CapForge preset/i)
  assert.throws(() => parsePresetImport('nope'), /not a valid CapForge preset/i)
  assert.throws(() => parsePresetImport([1, 2]), /not a valid CapForge preset/i)
})

test('parsePresetImport rejects a missing type tag', () => {
  assert.throws(
    () => parsePresetImport({ version: 1, name: 'x', settings: {} }),
    /not a CapForge preset/i
  )
})

test('parsePresetImport rejects the wrong type tag', () => {
  assert.throws(
    () => parsePresetImport({ type: 'some-other-app-preset', version: 1, name: 'x', settings: {} }),
    /not a CapForge preset/i
  )
})

test('parsePresetImport rejects a version above PRESET_FILE_VERSION', () => {
  assert.throws(
    () =>
      parsePresetImport({
        type: PRESET_FILE_TYPE,
        version: PRESET_FILE_VERSION + 1,
        name: 'x',
        settings: {},
      }),
    /newer version of CapForge/i
  )
})

test('parsePresetImport rejects a non-integer version', () => {
  assert.throws(
    () => parsePresetImport({ type: PRESET_FILE_TYPE, version: 1.5, name: 'x', settings: {} }),
    /newer version of CapForge/i
  )
})

test('parsePresetImport accepts the current PRESET_FILE_VERSION', () => {
  const result = parsePresetImport({
    type: PRESET_FILE_TYPE,
    version: PRESET_FILE_VERSION,
    name: 'My Preset',
    settings: { fontSize: 42 },
  })
  assert.equal(result.name, 'My Preset')
  assert.deepEqual(result.settings, { fontSize: 42 })
  assert.equal(result.font, null)
})

test('parsePresetImport rejects a missing/blank name', () => {
  assert.throws(
    () => parsePresetImport({ type: PRESET_FILE_TYPE, version: 1, settings: {} }),
    /missing a name/i
  )
  assert.throws(
    () => parsePresetImport({ type: PRESET_FILE_TYPE, version: 1, name: '   ', settings: {} }),
    /missing a name/i
  )
})

test('parsePresetImport rejects a name longer than 256 chars', () => {
  const longName = 'x'.repeat(257)
  assert.throws(
    () => parsePresetImport({ type: PRESET_FILE_TYPE, version: 1, name: longName, settings: {} }),
    /invalid name/i
  )
})

test('parsePresetImport accepts a name at exactly 256 chars', () => {
  const name = 'x'.repeat(256)
  const result = parsePresetImport({
    type: PRESET_FILE_TYPE,
    version: 1,
    name,
    settings: {},
  })
  assert.equal(result.name, name)
})

test('parsePresetImport rejects missing/invalid settings', () => {
  assert.throws(
    () => parsePresetImport({ type: PRESET_FILE_TYPE, version: 1, name: 'x' }),
    /invalid settings/i
  )
  assert.throws(
    () => parsePresetImport({ type: PRESET_FILE_TYPE, version: 1, name: 'x', settings: [1] }),
    /invalid settings/i
  )
  assert.throws(
    () => parsePresetImport({ type: PRESET_FILE_TYPE, version: 1, name: 'x', settings: 'nope' }),
    /invalid settings/i
  )
})

// --- parsePresetImport: settings sanitization (prototype pollution) --------

test('parsePresetImport strips __proto__/constructor/prototype own-keys from settings', () => {
  // Build the payload via JSON.parse (as the real import path does) so
  // `__proto__` lands as an own-enumerable key rather than mutating the
  // object's actual prototype at construction time.
  const raw = JSON.parse(
    JSON.stringify({
      type: PRESET_FILE_TYPE,
      version: 1,
      name: 'Evil',
      settings: {
        fontSize: 10,
        __proto__: { polluted: true },
        constructor: { polluted: true },
        prototype: { polluted: true },
      },
    })
  )
  const result = parsePresetImport(raw)
  assert.equal(Object.prototype.hasOwnProperty.call(result.settings, '__proto__'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(result.settings, 'constructor'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(result.settings, 'prototype'), false)
  assert.equal(result.settings.fontSize, 10)
  // The global Object prototype itself was never touched.
  assert.equal({}.polluted, undefined)
})

test('parsePresetImport blocks a literal __proto__ pollution attempt via JSON.parse', () => {
  // JSON.parse itself assigns __proto__ as an own key (it does not trigger
  // the setter) — this is the realistic attack shape for a parsed file.
  const payload = JSON.parse(
    '{"type":"' +
      PRESET_FILE_TYPE +
      '","version":1,"name":"Evil","settings":{"__proto__":{"polluted":true}}}'
  )
  const result = parsePresetImport(payload)
  assert.equal({}.polluted, undefined)
  assert.equal(Object.getPrototypeOf(result.settings), Object.prototype)
})

test('parsePresetImport drops nested object/array settings values, keeps primitives', () => {
  const result = parsePresetImport({
    type: PRESET_FILE_TYPE,
    version: 1,
    name: 'x',
    settings: {
      str: 'hello',
      num: 12,
      bool: true,
      nested: { a: 1 },
      arr: [1, 2, 3],
      nullish: null,
      undef: undefined,
    },
  })
  assert.deepEqual(result.settings, { str: 'hello', num: 12, bool: true })
})

test('parsePresetImport drops pathologically long string setting values', () => {
  const result = parsePresetImport({
    type: PRESET_FILE_TYPE,
    version: 1,
    name: 'x',
    settings: { short: 'ok', long: 'y'.repeat(4097) },
  })
  assert.deepEqual(result.settings, { short: 'ok' })
})

// --- parsePresetImport: font block ------------------------------------------

test('parsePresetImport tolerates a missing font block', () => {
  const result = parsePresetImport({
    type: PRESET_FILE_TYPE,
    version: 1,
    name: 'x',
    settings: {},
  })
  assert.equal(result.font, null)
})

test('parsePresetImport rejects a non-string fileName', () => {
  assert.throws(
    () =>
      parsePresetImport({
        type: PRESET_FILE_TYPE,
        version: 1,
        name: 'x',
        settings: {},
        font: { fileName: 42 },
      }),
    /invalid font reference/i
  )
})

test('parsePresetImport rejects a fileName longer than 256 chars', () => {
  assert.throws(
    () =>
      parsePresetImport({
        type: PRESET_FILE_TYPE,
        version: 1,
        name: 'x',
        settings: {},
        font: { fileName: 'f'.repeat(257) },
      }),
    /invalid font reference/i
  )
})

test('parsePresetImport rejects a non-string family', () => {
  assert.throws(
    () =>
      parsePresetImport({
        type: PRESET_FILE_TYPE,
        version: 1,
        name: 'x',
        settings: {},
        font: { family: { nope: true } },
      }),
    /invalid font reference/i
  )
})

test('parsePresetImport accepts a bundled font reference (no embedded bytes)', () => {
  const result = parsePresetImport({
    type: PRESET_FILE_TYPE,
    version: 1,
    name: 'x',
    settings: {},
    font: { family: 'Inter', fileName: 'Inter-Bold.ttf', bundled: true },
  })
  assert.equal(result.font.fileName, 'Inter-Bold.ttf')
  assert.equal(result.font.bundled, true)
  assert.equal(result.font.dataBuffer, undefined)
})

test('parsePresetImport decodes a small valid embedded font and attaches dataBuffer', () => {
  const bytes = Buffer.from('hello-font-bytes')
  const result = parsePresetImport({
    type: PRESET_FILE_TYPE,
    version: 1,
    name: 'x',
    settings: {},
    font: { fileName: 'Custom.ttf', dataB64: bytes.toString('base64') },
  })
  assert.ok(Buffer.isBuffer(result.font.dataBuffer))
  assert.equal(result.font.dataBuffer.toString(), 'hello-font-bytes')
})

test('parsePresetImport rejects an embedded font over the 10MB cap (minimal-size synthetic payload)', () => {
  // Smallest base64 string (in 4-char blocks) that decodes to just over the
  // cap — avoids allocating a gratuitously larger buffer than necessary.
  const targetBytes = MAX_FONT_BYTES + 1
  const b64Length = Math.ceil(targetBytes / 3) * 4
  const oversizedB64 = 'A'.repeat(b64Length)

  assert.throws(
    () =>
      parsePresetImport({
        type: PRESET_FILE_TYPE,
        version: 1,
        name: 'x',
        settings: {},
        font: { fileName: 'Huge.ttf', dataB64: oversizedB64 },
      }),
    /too large/i
  )
})

test('parsePresetImport rejects a corrupted embedded font that decodes to empty bytes', () => {
  assert.throws(
    () =>
      parsePresetImport({
        type: PRESET_FILE_TYPE,
        version: 1,
        name: 'x',
        settings: {},
        // No valid base64 alphabet characters at all — Buffer.from drops
        // every char, yielding a zero-length buffer.
        font: { fileName: 'Bad.ttf', dataB64: '!!!!' },
      }),
    /corrupted embedded font/i
  )
})

// --- extension allowlist + path traversal -----------------------------------
// The extension allowlist and basename-only write live at the main.js
// `presets:import` call site (FONT_EXTS.includes(...) + path.basename(...)),
// not inside parsePresetImport itself — parsePresetImport only validates the
// shape of the font reference. We exercise the exact basename + extension
// logic main.js uses, so the trust-boundary behavior is still pinned here.

const path = require('node:path')
const FONT_EXTS = ['.ttf', '.otf', '.woff', '.woff2']

function resolveImportedFontName(fileName) {
  return path.basename(fileName || 'imported-font')
}

test('extension allowlist rejects .exe font filenames', () => {
  const safeName = resolveImportedFontName('payload.exe')
  assert.equal(FONT_EXTS.includes(path.extname(safeName).toLowerCase()), false)
})

test('extension allowlist rejects .js font filenames', () => {
  const safeName = resolveImportedFontName('payload.js')
  assert.equal(FONT_EXTS.includes(path.extname(safeName).toLowerCase()), false)
})

test('extension allowlist accepts real font extensions', () => {
  for (const ext of FONT_EXTS) {
    const safeName = resolveImportedFontName(`Custom${ext}`)
    assert.equal(FONT_EXTS.includes(path.extname(safeName).toLowerCase()), true)
  }
})

test('path traversal in font filename is neutralized to a basename', () => {
  const safeName = resolveImportedFontName('../../../etc/evil.ttf')
  assert.equal(safeName, 'evil.ttf')
  assert.equal(safeName.includes('/'), false)
  assert.equal(safeName.includes('..'), false)
})

test('path traversal with backslashes (Windows-style) still yields a plain basename via path.win32', () => {
  const winSafeName = path.win32.basename('..\\..\\evil.ttf')
  assert.equal(winSafeName, 'evil.ttf')
})

// --- buildPresetExport -------------------------------------------------------

test('buildPresetExport produces the { type, version, name, settings, font } wrapper', () => {
  const out = buildPresetExport({
    name: 'My Preset',
    settings: { fontSize: 42, customFontPath: '/Users/me/fonts/Custom.ttf' },
    font: null,
  })
  assert.equal(out.type, PRESET_FILE_TYPE)
  assert.equal(out.version, PRESET_FILE_VERSION)
  assert.equal(out.name, 'My Preset')
  assert.equal(out.font, null)
  // customFontPath is blanked — the absolute local path is not portable.
  assert.equal(out.settings.customFontPath, '')
  assert.equal(out.settings.fontSize, 42)
})

test('buildPresetExport does not mutate the input settings object', () => {
  const settings = { fontSize: 10, customFontPath: '/local/font.ttf' }
  buildPresetExport({ name: 'x', settings, font: null })
  assert.equal(settings.customFontPath, '/local/font.ttf')
})

test('buildPresetExport embeds a user font as base64 (custom classification)', () => {
  const fs = {
    existsSync(p) {
      return p === '/local/fonts/Custom.ttf'
    },
  }
  const kind = classifyFont({
    customFontPath: '/local/fonts/Custom.ttf',
    bundledFontsDir: '/app/Fonts',
    fs,
    path,
  })
  assert.equal(kind, 'custom')

  const fontBytes = Buffer.from('fake-ttf-bytes')
  const out = buildPresetExport({
    name: 'x',
    settings: { customFontPath: '/local/fonts/Custom.ttf' },
    font: {
      family: 'Custom',
      fileName: 'Custom.ttf',
      bundled: false,
      dataB64: fontBytes.toString('base64'),
    },
  })
  assert.equal(out.font.bundled, false)
  assert.equal(typeof out.font.dataB64, 'string')
  assert.equal(Buffer.from(out.font.dataB64, 'base64').toString(), 'fake-ttf-bytes')
})

test('buildPresetExport references a bundled CapForge font by name only (no embedded bytes)', () => {
  const fs = {
    existsSync(p) {
      return p === '/app/Fonts/Inter-Bold.ttf'
    },
  }
  const kind = classifyFont({
    customFontPath: '/anywhere/Inter-Bold.ttf',
    bundledFontsDir: '/app/Fonts',
    fs,
    path,
  })
  assert.equal(kind, 'bundled')

  const out = buildPresetExport({
    name: 'x',
    settings: { customFontPath: '/anywhere/Inter-Bold.ttf' },
    font: { family: 'Inter', fileName: 'Inter-Bold.ttf', bundled: true },
  })
  assert.equal(out.font.bundled, true)
  assert.equal(out.font.dataB64, undefined)
  assert.equal(out.font.fileName, 'Inter-Bold.ttf')
})

// --- classifyFont -------------------------------------------------------------

test('classifyFont returns "none" when there is no custom font path', () => {
  const fs = { existsSync: () => false }
  assert.equal(
    classifyFont({ customFontPath: '', bundledFontsDir: '/app/Fonts', fs, path }),
    'none'
  )
  assert.equal(
    classifyFont({ customFontPath: undefined, bundledFontsDir: '/app/Fonts', fs, path }),
    'none'
  )
})

test('classifyFont returns "bundled" for a font path (bundled basename takes priority)', () => {
  const fs = {
    existsSync(p) {
      return p === '/app/Fonts/Inter-Bold.ttf'
    },
  }
  const kind = classifyFont({
    customFontPath: '/some/user/dir/Inter-Bold.ttf',
    bundledFontsDir: '/app/Fonts',
    fs,
    path,
  })
  assert.equal(kind, 'bundled')
})

test('classifyFont returns "custom" for a readable non-bundled font path', () => {
  const fs = {
    existsSync(p) {
      return p === '/some/user/dir/MyFont.ttf'
    },
  }
  const kind = classifyFont({
    customFontPath: '/some/user/dir/MyFont.ttf',
    bundledFontsDir: '/app/Fonts',
    fs,
    path,
  })
  assert.equal(kind, 'custom')
})

test('classifyFont returns "missing" when the custom font file can no longer be read', () => {
  const fs = { existsSync: () => false }
  const kind = classifyFont({
    customFontPath: '/gone/MyFont.ttf',
    bundledFontsDir: '/app/Fonts',
    fs,
    path,
  })
  assert.equal(kind, 'missing')
})

// --- uniquePresetName ---------------------------------------------------------

test('uniquePresetName returns the name unchanged when there is no collision', () => {
  assert.equal(uniquePresetName(['Other', 'Another'], 'My Preset'), 'My Preset')
  assert.equal(uniquePresetName([], 'My Preset'), 'My Preset')
})

test('uniquePresetName appends " (imported)" on first collision', () => {
  assert.equal(uniquePresetName(['My Preset'], 'My Preset'), 'My Preset (imported)')
})

test('uniquePresetName appends " (2)", " (3)", … on subsequent collisions', () => {
  const existing = ['My Preset', 'My Preset (imported)', 'My Preset (2)']
  assert.equal(uniquePresetName(existing, 'My Preset'), 'My Preset (3)')
})
