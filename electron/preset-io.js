/**
 * CapForge — Shareable Presets format helpers (.cfpreset).
 *
 * Pure, testable functions for building and parsing the .cfpreset export file.
 * No Electron / fs / path imports live here: callers in electron/main.js pass
 * `fs` and `path` in as arguments where filesystem probing is needed, so this
 * module stays unit-testable in isolation.
 *
 * Implements Phase 1 of docs/plans/shareable-presets-export-import.md
 * (see "File format spec" and "Phase 1 — Format helpers + main-process I/O").
 */

const PRESET_FILE_TYPE = 'capforge-preset'
const PRESET_FILE_VERSION = 1
const PRESET_FILE_EXT = 'cfpreset'
const MAX_FONT_BYTES = 10 * 1024 * 1024

/**
 * Classify how a preset's custom font should travel in an export.
 *  - 'none'    : the preset has no font family or custom font path.
 *  - 'system'  : the preset references an installed font by family only. The
 *                file is not embedded because its redistribution rights are
 *                unknown, so the renderer must warn before export.
 *  - 'bundled' : the font basename matches a file in the local bundled Fonts dir
 *                — referenced by name only, re-resolved on the target machine.
 *  - 'custom'  : the file at customFontPath is readable — its bytes get embedded.
 *  - 'missing' : a custom font was set but the file can no longer be read.
 *
 * Edge case: a user-uploaded custom font that happens to share a basename with a
 * bundled font is treated as 'bundled'. This is acceptable — it re-resolves
 * locally without embedding bytes; the on-disk basename collision means the
 * bundled file is what every machine will resolve to anyway.
 */
function classifyFont({ fontFamily, customFontPath, bundledFontsDir, fs, path }) {
  if (!customFontPath) return fontFamily ? 'system' : 'none'
  const base = path.basename(customFontPath)
  // Bundled basename takes priority — re-resolved locally, no embedding needed.
  if (fs.existsSync(path.join(bundledFontsDir, base))) return 'bundled'
  if (fs.existsSync(customFontPath)) return 'custom'
  return 'missing'
}

const DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype']

/**
 * Copy a settings object into a NEW plain object, keeping only own-enumerable
 * keys whose value is a primitive (string | number | boolean). Nested
 * objects/arrays are dropped (VanillaPreset values are all primitives). The
 * prototype-pollution keys are explicitly skipped.
 */
function sanitizeSettings(obj) {
  const out = {}
  for (const key of Object.keys(obj)) {
    if (DANGEROUS_KEYS.includes(key)) continue
    const value = obj[key]
    const t = typeof value
    if (t === 'string') {
      // Drop pathologically long strings — guards against a malicious preset
      // bloating a single setting value.
      if (value.length > 4096) continue
      out[key] = value
    } else if (t === 'number' || t === 'boolean') {
      out[key] = value
    }
    // Drop nested objects/arrays/functions/null/undefined.
  }
  return out
}

/**
 * Assemble the .cfpreset export object. Builds a NEW settings object with
 * customFontPath blanked to '' (the absolute local path is not portable) —
 * the input settings object is never mutated.
 */
function buildPresetExport({ name, settings, font }) {
  const exportedSettings = { ...settings, customFontPath: '' }
  return {
    type: PRESET_FILE_TYPE,
    version: PRESET_FILE_VERSION,
    name,
    settings: exportedSettings,
    font: font || null,
  }
}

/**
 * Validate and normalise a parsed .cfpreset object (external, untrusted data).
 * Returns { name, settings, font } or throws Error with a user-facing message.
 */
function parsePresetImport(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('This file is not a valid CapForge preset.')
  }
  if (raw.type !== PRESET_FILE_TYPE) {
    throw new Error('This file is not a CapForge preset.')
  }
  if (!Number.isInteger(raw.version) || raw.version > PRESET_FILE_VERSION) {
    throw new Error('This preset was made with a newer version of CapForge.')
  }
  if (typeof raw.name !== 'string' || raw.name.trim() === '') {
    throw new Error('This preset file is missing a name.')
  }
  if (raw.name.length > 256) {
    throw new Error('This preset has an invalid name.')
  }
  if (!raw.settings || typeof raw.settings !== 'object' || Array.isArray(raw.settings)) {
    throw new Error('This preset file has invalid settings.')
  }

  const settings = sanitizeSettings(raw.settings)

  let font = null
  if (raw.font && typeof raw.font === 'object' && !Array.isArray(raw.font)) {
    font = raw.font
    // Validate the untrusted font reference fields. fileName/family are
    // optional, but when present they MUST be strings; fileName length is
    // capped so a malicious reference can't blow up downstream path handling.
    if ('fileName' in font && font.fileName !== undefined && typeof font.fileName !== 'string') {
      throw new Error('This preset file has an invalid font reference.')
    }
    if (typeof font.fileName === 'string' && font.fileName.length > 256) {
      throw new Error('This preset file has an invalid font reference.')
    }
    if ('family' in font && font.family !== undefined && typeof font.family !== 'string') {
      throw new Error('This preset file has an invalid font reference.')
    }
    if (typeof font.dataB64 === 'string' && font.dataB64 !== '') {
      let decoded
      try {
        decoded = Buffer.from(font.dataB64, 'base64')
      } catch {
        throw new Error('This preset has a corrupted embedded font.')
      }
      // Buffer.from never throws on bad base64 (it drops invalid chars), so
      // guard against an empty decode of non-empty input as well.
      if (!decoded || decoded.length === 0) {
        throw new Error('This preset has a corrupted embedded font.')
      }
      if (decoded.length > MAX_FONT_BYTES) {
        throw new Error('This preset has an embedded font that is too large.')
      }
      // Attach the already-validated buffer so the write site doesn't need to
      // re-decode (the size guarantee then holds self-evidently at write time).
      font.dataBuffer = decoded
    }
  }

  return { name: raw.name, settings, font }
}

/**
 * Produce a non-colliding preset name. First collision appends ' (imported)',
 * subsequent collisions append ' (2)', ' (3)', …
 */
function uniquePresetName(existingNames, name) {
  const taken = new Set(existingNames)
  if (!taken.has(name)) return name
  const imported = `${name} (imported)`
  if (!taken.has(imported)) return imported
  let n = 2
  while (taken.has(`${name} (${n})`)) n += 1
  return `${name} (${n})`
}

module.exports = {
  PRESET_FILE_TYPE,
  PRESET_FILE_VERSION,
  PRESET_FILE_EXT,
  MAX_FONT_BYTES,
  classifyFont,
  sanitizeSettings,
  buildPresetExport,
  parsePresetImport,
  uniquePresetName,
}
