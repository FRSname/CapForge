/**
 * Crash-recovery autosave store for the active editing session.
 *
 * Holds the most recent project snapshot (the same payload as the renderer's
 * ProjectIOHandle.gather()) plus a small ring of previous snapshots, in a
 * dedicated JSON file at `<userData>/autosave.json`.
 *
 * Kept separate from app-state.json on purpose: app-state holds small UI prefs
 * that are read fully into memory and rewritten on every set, whereas a
 * transcription snapshot can be large. Written atomically (tmp + rename) like
 * app-state.js so a kill mid-write can't truncate the file.
 */

const { app } = require('electron')
const path = require('path')
const fs = require('fs')

const MAX_HISTORY = 3

let file = null

function ensureFile() {
  // Lazy — app.getPath is only valid after the app is ready.
  if (file === null) file = path.join(app.getPath('userData'), 'autosave.json')
  return file
}

function readAll() {
  ensureFile()
  if (!fs.existsSync(file)) return { current: null, history: [] }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch (err) {
    console.warn('[CapForge] Failed to parse autosave.json:', err.message)
    return { current: null, history: [] }
  }
}

function writeAtomic(data) {
  ensureFile()
  try {
    const tmp = file + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(data), 'utf-8')
    fs.renameSync(tmp, file)
  } catch (err) {
    console.warn('[CapForge] Failed to persist autosave:', err.message)
  }
}

/** Store a new snapshot, stamping savedAt and rotating the previous current into history. */
function write(snapshot) {
  const prev = readAll()
  const stamped = { ...snapshot, savedAt: Date.now() }
  const history = prev.current
    ? [prev.current, ...prev.history].slice(0, MAX_HISTORY)
    : prev.history
  writeAtomic({ current: stamped, history })
}

/** Return the latest snapshot (with savedAt) or null when there is none. */
function read() {
  return readAll().current
}

/** Remove all autosave data — called on explicit Save and on New. */
function clear() {
  ensureFile()
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file)
  } catch (err) {
    console.warn('[CapForge] Failed to clear autosave:', err.message)
  }
}

module.exports = { write, read, clear }
