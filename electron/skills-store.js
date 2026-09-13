/**
 * Bundled Claude skills: view, edit, install.
 *
 * CapForge ships skills under `mcp_server/skills/<name>/` (markdown only). A
 * skill is only useful once the user has adapted it to their channel, so the
 * bundle is never what gets installed:
 *
 *   bundle (read-only, shipped)  →  user copy (~/.capforge/skills/<name>/)
 *                                        →  install (~/.claude/skills/<name>/)
 *
 * The user copy is seeded from the bundle on first sight and then belongs to
 * the user — a CapForge update that changes the bundled skill never silently
 * overwrites it. Instead the seeded bundle hash (`.bundled-sha1`, a dotfile so
 * it is never installed) stops matching and `bundleChanged` goes true; the UI
 * offers "Keep mine" (`acknowledgeBundle`) or "Reset to bundled"
 * (`resetUserCopy`).
 *
 * Style follows claude-connect.js: the pure helpers take an injected `fs` plus
 * explicit dirs so they are testable against temp folders from plain node, and
 * the runtime wrappers at the bottom resolve the real paths.
 */

const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { getProjectDir } = require('./claude-connect')

/** The one file every skill must have; also the file the editor edits. */
const SKILL_FILE = 'SKILL.md'

/** Where the seeded bundle's hash is remembered inside the user copy. */
const BUNDLE_HASH_FILE = '.bundled-sha1'

/** Upper bound for an edited SKILL.md — a guard against a runaway renderer. */
const MAX_SKILL_BYTES = 1024 * 1024

// ---------------------------------------------------------------------------
// Pure helpers (no electron) — unit-tested in skills-store.test.js
// ---------------------------------------------------------------------------

/**
 * Every `*.md` under `dir`, as `/`-joined paths relative to it, sorted.
 * Dotfiles and dot-dirs are skipped (editor/OS cruft, and our own
 * `.bundled-sha1`, are not part of a skill). A missing dir yields `[]`.
 */
function listMarkdown(dir, fsImpl = fs, prefix = '') {
  let entries
  try {
    entries = fsImpl.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const files = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      files.push(...listMarkdown(path.join(dir, entry.name), fsImpl, rel))
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(rel)
    }
  }
  return files.sort()
}

/**
 * The `description:` value from a SKILL.md YAML frontmatter block, with any
 * surrounding quotes stripped. Missing frontmatter or key → `''` (the UI shows
 * the name alone rather than failing).
 */
function readFrontmatterDescription(text) {
  if (typeof text !== 'string') return ''
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!match) return ''
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^description:\s*(.*)$/.exec(line)
    if (!kv) continue
    const raw = kv[1].trim()
    const quoted = /^(["'])([\s\S]*)\1$/.exec(raw)
    return quoted ? quoted[2] : raw
  }
  return ''
}

/**
 * Content fingerprint of a bundled skill: sha1 over every `.md` file as
 * `relpath \0 content`, in sorted path order. Path-sensitive, so adding or
 * renaming a file changes it as much as editing one does.
 */
function bundleHash(sourceDir, fsImpl = fs) {
  const hash = crypto.createHash('sha1')
  for (const rel of listMarkdown(sourceDir, fsImpl)) {
    hash.update(rel)
    hash.update('\0')
    hash.update(fsImpl.readFileSync(path.join(sourceDir, rel)))
  }
  return hash.digest('hex')
}

/** True when both paths exist and hold identical bytes. */
function _sameBytes(a, b, fsImpl) {
  try {
    return Buffer.compare(fsImpl.readFileSync(a), fsImpl.readFileSync(b)) === 0
  } catch {
    return false
  }
}

function _readTextSafe(filePath, fsImpl) {
  try {
    return fsImpl.readFileSync(filePath, 'utf-8')
  } catch {
    return ''
  }
}

/** Copy every bundled `.md` into the user dir and record the bundle hash. */
function _seed({ sourceDir, userDir, fs: fsImpl = fs }) {
  fsImpl.mkdirSync(userDir, { recursive: true })
  for (const rel of listMarkdown(sourceDir, fsImpl)) {
    const dest = path.join(userDir, rel)
    fsImpl.mkdirSync(path.dirname(dest), { recursive: true })
    fsImpl.writeFileSync(dest, fsImpl.readFileSync(path.join(sourceDir, rel)))
  }
  fsImpl.writeFileSync(path.join(userDir, BUNDLE_HASH_FILE), bundleHash(sourceDir, fsImpl), 'utf-8')
}

/**
 * Seed the user copy from the bundle the first time we see this skill. A user
 * copy that already has a SKILL.md is left completely alone — this runs on
 * every `listSkills()`, so anything else would eat the user's edits.
 */
function ensureUserCopy({ sourceDir, userDir, fs: fsImpl = fs }) {
  if (fsImpl.existsSync(path.join(userDir, SKILL_FILE))) return { seeded: false }
  _seed({ sourceDir, userDir, fs: fsImpl })
  return { seeded: true }
}

/**
 * Install + bundle state for one skill.
 *   - `installStatus`  `not-installed` (nothing at the install dir),
 *                      `up-to-date` (every user file is there byte-identical),
 *                      `outdated` (installed, but the bytes differ)
 *   - `bundleChanged`  the shipped skill changed since the user copy was
 *                      seeded/acknowledged — i.e. there is an update to look at
 *
 * "Installed" is keyed on the install dir's SKILL.md, not on the dir merely
 * existing, so it agrees with what `installSkill` reports back.
 */
function skillStatus({ sourceDir, userDir, installDir, fs: fsImpl = fs }) {
  // A user copy with no recorded hash (hand-made, or seeded by an older build)
  // counts as changed: we cannot prove which bundle it was based on.
  const stored = _readTextSafe(path.join(userDir, BUNDLE_HASH_FILE), fsImpl).trim()
  const bundleChanged = stored !== bundleHash(sourceDir, fsImpl)

  if (!fsImpl.existsSync(path.join(installDir, SKILL_FILE))) {
    return { installStatus: 'not-installed', bundleChanged }
  }
  const files = listMarkdown(userDir, fsImpl)
  const same =
    files.length > 0 &&
    files.every((rel) => _sameBytes(path.join(userDir, rel), path.join(installDir, rel), fsImpl))
  return { installStatus: same ? 'up-to-date' : 'outdated', bundleChanged }
}

/**
 * Copy the *user copy* (never the bundle) into Claude Code's skills folder.
 * `installed` / `updated` / `up-to-date` describe what the copy actually did,
 * so the UI can say so instead of guessing.
 */
function installSkill({ userDir, installDir, fs: fsImpl = fs }) {
  try {
    const files = listMarkdown(userDir, fsImpl)
    // Zero markdown means the user copy is missing or was emptied; reporting
    // "installed" for nothing copied would be a silent lie.
    if (files.length === 0) {
      return { ok: false, reason: 'write-failed', detail: `No markdown in ${userDir}` }
    }
    const existed = fsImpl.existsSync(path.join(installDir, SKILL_FILE))
    const same = files.every((rel) =>
      _sameBytes(path.join(userDir, rel), path.join(installDir, rel), fsImpl)
    )
    if (existed && same) return { ok: true, path: installDir, status: 'up-to-date' }
    for (const rel of files) {
      const dest = path.join(installDir, rel)
      fsImpl.mkdirSync(path.dirname(dest), { recursive: true })
      fsImpl.writeFileSync(dest, fsImpl.readFileSync(path.join(userDir, rel)))
    }
    return { ok: true, path: installDir, status: existed ? 'updated' : 'installed' }
  } catch (err) {
    return { ok: false, reason: 'write-failed', detail: String(err && err.message) }
  }
}

/**
 * Throw the user copy away and re-seed it from the bundle. Destructive on
 * purpose — this is the "Reset to bundled" action, and it keeps nothing.
 */
function resetUserCopy({ sourceDir, userDir, fs: fsImpl = fs }) {
  for (const rel of listMarkdown(userDir, fsImpl)) {
    try {
      fsImpl.rmSync(path.join(userDir, rel))
    } catch {
      /* already gone — the re-seed below is what matters */
    }
  }
  _seed({ sourceDir, userDir, fs: fsImpl })
  return { reset: true }
}

/**
 * "Keep mine": remember the current bundle hash without touching the user's
 * files, so `bundleChanged` clears until the next CapForge update changes the
 * shipped skill again.
 */
function acknowledgeBundle({ sourceDir, userDir, fs: fsImpl = fs }) {
  fsImpl.mkdirSync(userDir, { recursive: true })
  fsImpl.writeFileSync(path.join(userDir, BUNDLE_HASH_FILE), bundleHash(sourceDir, fsImpl), 'utf-8')
  return { acknowledged: true }
}

/**
 * Name validation for every IPC entry point: a name is only ever accepted when
 * it is one of the bundled folder names. Never join a client-supplied name into
 * a path before this passes — `../../.ssh` must not become a target.
 */
function isKnownSkill(name, names) {
  return typeof name === 'string' && name !== '' && names.includes(name)
}

/** `SKILL.md` first, then the rest in sorted order — the UI's file list. */
function orderSkillFiles(files) {
  return [...files].sort((a, b) => {
    if (a === SKILL_FILE) return -1
    if (b === SKILL_FILE) return 1
    return a < b ? -1 : a > b ? 1 : 0
  })
}

// ---------------------------------------------------------------------------
// Runtime-aware helpers — these are what the IPC handlers call
// ---------------------------------------------------------------------------

/** Read-only bundle shipped inside the app (asar-unpacked in prod). */
function bundleRoot() {
  return path.join(getProjectDir(), 'mcp_server', 'skills')
}

/** The user's editable copies, in CapForge's data home. */
function userRoot() {
  const home = process.env.CAPFORGE_HOME || path.join(os.homedir(), '.capforge')
  return path.join(home, 'skills')
}

/** Where Claude Code looks for skills. */
function installRoot() {
  return path.join(os.homedir(), '.claude', 'skills')
}

/** Bundled folder names that actually contain a SKILL.md. `[]` if none ship. */
function bundledSkillNames() {
  const root = bundleRoot()
  let entries
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .filter((name) => fs.existsSync(path.join(root, name, SKILL_FILE)))
    .sort()
}

function _dirsFor(name) {
  return {
    sourceDir: path.join(bundleRoot(), name),
    userDir: path.join(userRoot(), name),
    installDir: path.join(installRoot(), name),
  }
}

/** Validate a client-supplied name against the bundle, or throw. */
function _requireKnown(name) {
  if (!isKnownSkill(name, bundledSkillNames())) throw new Error('unknown skill')
  return _dirsFor(name)
}

function _summary(name, dirs) {
  const { sourceDir, userDir, installDir } = dirs
  // Describe the user's copy (that is what installs); fall back to the bundle
  // if their SKILL.md has no frontmatter.
  const userText = _readTextSafe(path.join(userDir, SKILL_FILE), fs)
  const description =
    readFrontmatterDescription(userText) ||
    readFrontmatterDescription(_readTextSafe(path.join(sourceDir, SKILL_FILE), fs))
  return {
    name,
    description,
    ...skillStatus({ sourceDir, userDir, installDir, fs }),
    userDir,
    installDir,
  }
}

/** All bundled skills, seeding any user copy that does not exist yet. */
function listSkills() {
  return bundledSkillNames().map((name) => {
    const dirs = _dirsFor(name)
    ensureUserCopy({ sourceDir: dirs.sourceDir, userDir: dirs.userDir, fs })
    return _summary(name, dirs)
  })
}

/** One skill with its editable text, the bundled text, and its file list. */
function readSkill(name) {
  const dirs = _requireKnown(name)
  ensureUserCopy({ sourceDir: dirs.sourceDir, userDir: dirs.userDir, fs })
  return {
    ..._summary(name, dirs),
    text: _readTextSafe(path.join(dirs.userDir, SKILL_FILE), fs),
    bundledText: _readTextSafe(path.join(dirs.sourceDir, SKILL_FILE), fs),
    files: orderSkillFiles(listMarkdown(dirs.userDir, fs)),
  }
}

/** Save the editor's text into the user copy. Returns the refreshed detail. */
function writeSkill(name, text) {
  const dirs = _requireKnown(name)
  if (typeof text !== 'string') throw new Error('skill text must be a string')
  if (Buffer.byteLength(text, 'utf-8') > MAX_SKILL_BYTES) {
    throw new Error(`skill text exceeds ${MAX_SKILL_BYTES} bytes`)
  }
  fs.mkdirSync(dirs.userDir, { recursive: true })
  fs.writeFileSync(path.join(dirs.userDir, SKILL_FILE), text, 'utf-8')
  return readSkill(name)
}

/** "Reset to bundled" — discard the user's edits. */
function resetSkill(name) {
  const dirs = _requireKnown(name)
  resetUserCopy({ sourceDir: dirs.sourceDir, userDir: dirs.userDir, fs })
  return readSkill(name)
}

/** "Keep mine" — clear `bundleChanged` without touching the user's text. */
function acknowledgeSkillBundle(name) {
  const dirs = _requireKnown(name)
  acknowledgeBundle({ sourceDir: dirs.sourceDir, userDir: dirs.userDir, fs })
  return readSkill(name)
}

/** Copy the user copy into `~/.claude/skills/<name>/`. */
function installSkillByName(name) {
  const dirs = _requireKnown(name)
  ensureUserCopy({ sourceDir: dirs.sourceDir, userDir: dirs.userDir, fs })
  return installSkill({ userDir: dirs.userDir, installDir: dirs.installDir, fs })
}

/** Absolute path of the user copy's SKILL.md — for "Reveal in Finder". */
function skillUserFile(name) {
  const dirs = _requireKnown(name)
  return path.join(dirs.userDir, SKILL_FILE)
}

module.exports = {
  SKILL_FILE,
  BUNDLE_HASH_FILE,
  MAX_SKILL_BYTES,
  // pure
  listMarkdown,
  readFrontmatterDescription,
  bundleHash,
  ensureUserCopy,
  skillStatus,
  installSkill,
  resetUserCopy,
  acknowledgeBundle,
  isKnownSkill,
  orderSkillFiles,
  // runtime
  bundleRoot,
  userRoot,
  installRoot,
  bundledSkillNames,
  listSkills,
  readSkill,
  writeSkill,
  resetSkill,
  acknowledgeSkillBundle,
  installSkillByName,
  skillUserFile,
}
