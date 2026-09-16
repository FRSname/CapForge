/**
 * Tiny persistent key/value store for CapForge UI preferences.
 *
 * Backed by a single JSON file at `%APPDATA%/CapForge/app-state.json`.
 * Loaded on first access, written atomically on every `set()`.
 *
 * Keys currently in use:
 *   window           {x, y, width, height, maximized}
 *   lastProjectPath  string   — last saved .capforge file (Save's default and
 *                               the v3 first-launch migration)
 *   lastOutputDir    string   — last directory used for export
 *   lastPreset       string   — last selected style preset name
 *   lastInputPath    string   — last audio/video file opened
 *   favoriteFonts    string[] — font families pinned to the top of the picker
 *   lastPublishChannels
 *                    string[] — channel ids the last import published to; the
 *                               import "Publish to:" sheet pre-ticks them, and
 *                               drops any the Settings list no longer has
 *   libraryView      {layout: 'grid'|'list', tileSize: number,
 *                     sort: {key, direction}}
 *                             — the library's layout, icon size and sort;
 *                               parsed per field by src/renderer/src/lib/libraryPrefs.ts
 *   whisper_model    string   — chosen Whisper model id ('' = auto-detect);
 *                               seeded by first-run setup, edited in Settings
 *   lastSeenVersion  string   — the version whose "What's new" / startup guide
 *                               the user has dismissed. The onboarding prompts
 *                               write this key and no other; they only *read*
 *                               lastInputPath / lastProjectPath / lastOutputDir
 *                               as evidence that this install has been used
 *                               before (not whisper_model: first-run setup
 *                               can write it before the library is seen)
 *
 * Missing keys return `undefined`; callers should have their own defaults.
 */

const { app } = require('electron')
const path = require('path')
const fs = require('fs')

let cache = null
let stateFile = null

function ensureLoaded() {
  if (cache !== null) return
  stateFile = path.join(app.getPath('userData'), 'app-state.json')
  if (fs.existsSync(stateFile)) {
    try {
      cache = JSON.parse(fs.readFileSync(stateFile, 'utf-8'))
    } catch (err) {
      console.warn('[CapForge] Failed to parse app-state.json:', err.message)
      cache = {}
    }
  } else {
    cache = {}
  }
}

function get(key, fallback) {
  ensureLoaded()
  return cache[key] !== undefined ? cache[key] : fallback
}

function set(key, value) {
  ensureLoaded()
  cache[key] = value
  try {
    // Atomic-ish: write to a temp file then rename. Protects against
    // truncation if the app is killed mid-write.
    const tmp = stateFile + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), 'utf-8')
    fs.renameSync(tmp, stateFile)
  } catch (err) {
    console.warn('[CapForge] Failed to persist app state:', err.message)
  }
}

function del(key) {
  ensureLoaded()
  delete cache[key]
  set(key, undefined) // triggers a write via the same path
}

module.exports = { get, set, del }
