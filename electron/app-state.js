/**
 * Tiny persistent key/value store for CapForge UI preferences.
 *
 * Backed by a single JSON file at `%APPDATA%/CapForge/app-state.json`.
 * Loaded on first access, written atomically on every `set()`.
 *
 * Keys currently in use:
 *   window           {x, y, width, height, maximized}
 *   lastProjectPath  string   — last opened .capforge file
 *   lastOutputDir    string   — last directory used for export
 *   lastPreset       string   — last selected style preset name
 *   lastInputPath    string   — last audio/video file opened
 *
 * Missing keys return `undefined`; callers should have their own defaults.
 */

const { app } = require("electron");
const path = require("path");
const fs = require("fs");

let cache = null;
let stateFile = null;

function ensureLoaded() {
  if (cache !== null) return;
  stateFile = path.join(app.getPath("userData"), "app-state.json");
  if (fs.existsSync(stateFile)) {
    try {
      cache = JSON.parse(fs.readFileSync(stateFile, "utf-8"));
    } catch (err) {
      console.warn("[CapForge] Failed to parse app-state.json:", err.message);
      cache = {};
    }
  } else {
    cache = {};
  }
}

function get(key, fallback) {
  ensureLoaded();
  return cache[key] !== undefined ? cache[key] : fallback;
}

function set(key, value) {
  ensureLoaded();
  cache[key] = value;
  try {
    // Atomic-ish: write to a temp file then rename. Protects against
    // truncation if the app is killed mid-write.
    const tmp = stateFile + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), "utf-8");
    fs.renameSync(tmp, stateFile);
  } catch (err) {
    console.warn("[CapForge] Failed to persist app state:", err.message);
  }
}

function del(key) {
  ensureLoaded();
  delete cache[key];
  set(key, undefined); // triggers a write via the same path
}

module.exports = { get, set, del };
