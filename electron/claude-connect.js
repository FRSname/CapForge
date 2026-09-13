/**
 * One-click "Connect to Claude" for the MCP control layer.
 *
 * Customers shouldn't touch a terminal or hand-edit JSON. CapForge ships its own
 * Python runtime (with `mcp`+`httpx`) and the `mcp_server/` code, so connecting
 * is just: write a `capforge` entry into the right client config file, pointing
 * at the bundled python. The MCP server finds the running app via the discovery
 * file at runtime, so no port/path needs to be embedded in the config.
 *
 * Two clients supported:
 *   - Claude Desktop → merge into claude_desktop_config.json
 *   - Claude Code    → merge into ~/.claude.json (mcpServers)
 *
 * runtime-setup pulls in electron, so it's lazy-required — that keeps the pure
 * helpers (mergeMcpServers / buildServerEntryFrom / config paths) importable
 * from a plain-node test without an Electron runtime.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

const SERVER_NAME = 'capforge'

/** Folder name of the shipped publish skill, under `mcp_server/skills/`. */
const PUBLISH_SKILL_NAME = 'capforge-publish'

// ---------------------------------------------------------------------------
// Pure helpers (no electron) — unit-tested in claude-connect.test.js
// ---------------------------------------------------------------------------

/**
 * Build the stdio server entry.
 *
 * `mcp_server/server.py` uses package-relative imports (`from .cleanup import …`),
 * so it must be loaded as a package with the folder *containing* `mcp_server/`
 * on `sys.path`. The obvious mechanisms for that both have holes:
 *   - `cwd: projectDir` — only works if the MCP *client* honours `cwd`, and
 *     Claude Desktop on Windows does not reliably do so.
 *   - `env.PYTHONPATH` — the Windows embeddable python IGNORES it (its `._pth`
 *     freezes sys.path); only the macOS python-build-standalone honours it.
 * The net effect was a silent failure on Windows: the config wrote fine but the
 * server crashed on launch (unimportable package), so Claude Desktop showed
 * nothing connected.
 *
 * Fix: bootstrap `sys.path` explicitly via `-c` so the package resolves no
 * matter how the client treats `cwd`/`PYTHONPATH`. `JSON.stringify` yields a
 * Python-valid string literal (backslashes/quotes escape identically), so
 * Windows paths embed safely. `cwd`/`PYTHONPATH` stay as harmless redundancy
 * for clients that do honour them.
 */
function buildServerEntryFrom(pythonExe, projectDir) {
  const projectLiteral = JSON.stringify(projectDir)
  const bootstrap =
    `import sys; sys.path.insert(0, ${projectLiteral}); ` +
    `from mcp_server.server import main; main()`
  return {
    command: pythonExe,
    args: ['-c', bootstrap],
    cwd: projectDir,
    env: { PYTHONPATH: projectDir },
  }
}

/** Immutably merge a server entry under `mcpServers[name]`, preserving the rest. */
function mergeMcpServers(config, entry, name = SERVER_NAME) {
  const base = config && typeof config === 'object' ? config : {}
  return {
    ...base,
    mcpServers: { ...(base.mcpServers || {}), [name]: entry },
  }
}

/**
 * Pure: given %LOCALAPPDATA% and the folder names under `Packages\`, return the
 * Claude Desktop targets for any Microsoft Store (MSIX) install.
 *
 * The Store build is sandboxed — Windows virtualizes its `%APPDATA%\Claude\`
 * into the package container, so it never reads the standard Roaming path. The
 * real config lives at:
 *   %LOCALAPPDATA%\Packages\<pkg>\LocalCache\Roaming\Claude\claude_desktop_config.json
 * `dir` is the package folder (proof the Store app is installed); `config` is
 * the file to write.
 */
function storeDesktopTargetsFrom(localAppData, packageNames) {
  return packageNames
    .filter((name) => /claude/i.test(name))
    .map((name) => {
      const dir = path.join(localAppData, 'Packages', name)
      return {
        dir,
        config: path.join(dir, 'LocalCache', 'Roaming', 'Claude', 'claude_desktop_config.json'),
      }
    })
}

/**
 * All Claude Desktop install targets on this machine. Each is `{ dir, config }`
 * where `dir` existing means that flavour of Claude Desktop is installed. On
 * Windows this covers BOTH the standard .exe installer (Roaming) and any
 * Microsoft Store builds (virtualized package container) — a user can have
 * either, and writing to the wrong one is a silent no-op (the symptom that
 * started this whole chase).
 */
function desktopTargets() {
  if (process.platform === 'darwin') {
    const dir = path.join(os.homedir(), 'Library', 'Application Support', 'Claude')
    return [{ dir, config: path.join(dir, 'claude_desktop_config.json') }]
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
    const stdDir = path.join(appData, 'Claude')
    const targets = [{ dir: stdDir, config: path.join(stdDir, 'claude_desktop_config.json') }]
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
    let names = []
    try {
      names = fs.readdirSync(path.join(local, 'Packages'))
    } catch {
      /* no Packages dir → no Store apps */
    }
    targets.push(...storeDesktopTargetsFrom(local, names))
    return targets
  }
  const dir = path.join(os.homedir(), '.config', 'Claude')
  return [{ dir, config: path.join(dir, 'claude_desktop_config.json') }]
}

/** Primary desktop config path for display/manual-copy: an installed one if found. */
function desktopConfigPath() {
  const targets = desktopTargets()
  const existing = targets.find((t) => fs.existsSync(t.dir))
  return (existing || targets[0]).config
}

function codeConfigPath() {
  return path.join(os.homedir(), '.claude.json')
}

/**
 * Publish-skill install (opt-in).
 *
 * CapForge bundles a *generic* `capforge-publish` skill. Claude Code loads
 * skills from `~/.claude/skills/<name>/`, so "install" is a plain file copy —
 * but it is opt-in and never silent: the caller shows the target path, and an
 * install that would clobber a user-edited `SKILL.md` is refused instead.
 * The helpers below take `fs` so they are testable against temp dirs.
 */

/** Where the bundled skill lives (`getProjectDir()` resolves asar-unpacked vs dev). */
function skillSourceDir(projectDir) {
  return path.join(projectDir, 'mcp_server', 'skills', PUBLISH_SKILL_NAME)
}

/** Where Claude Code looks for it. */
function skillTargetDir(homeDir) {
  return path.join(homeDir, '.claude', 'skills', PUBLISH_SKILL_NAME)
}

/**
 * Every `*.md` under `dir`, as paths relative to it. Dotfiles and dot-dirs are
 * skipped (editor/OS cruft is not part of the skill).
 */
function _listMarkdown(dir, fsImpl, prefix = '') {
  const entries = fsImpl.readdirSync(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      files.push(..._listMarkdown(path.join(dir, entry.name), fsImpl, rel))
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(rel)
    }
  }
  return files.sort()
}

/** True when both paths exist and hold identical bytes. */
function _sameBytes(a, b, fsImpl) {
  try {
    return Buffer.compare(fsImpl.readFileSync(a), fsImpl.readFileSync(b)) === 0
  } catch {
    return false
  }
}

/**
 * What installing would do, without touching the disk.
 *   - `edited`     — the target SKILL.md exists and differs from the bundled one
 *                    (the user adapted it; their copy is never overwritten)
 *   - `up-to-date` — every bundled file is already at the target, byte-identical
 *   - `install`    — anything else (missing or partially copied)
 * Throws if `sourceDir` is unreadable; callers decide what that means.
 */
function planSkillInstall({ sourceDir, targetDir, fs: fsImpl = fs }) {
  const files = _listMarkdown(sourceDir, fsImpl)
  const skillMd = 'SKILL.md'
  const targetSkill = path.join(targetDir, skillMd)
  if (files.includes(skillMd) && fsImpl.existsSync(targetSkill)) {
    if (!_sameBytes(path.join(sourceDir, skillMd), targetSkill, fsImpl)) {
      return { status: 'edited', files }
    }
  }
  const allPresent = files.every((rel) =>
    _sameBytes(path.join(sourceDir, rel), path.join(targetDir, rel), fsImpl)
  )
  return { status: allPresent && files.length > 0 ? 'up-to-date' : 'install', files }
}

/** Run the plan: copy on `install`, no-op on `up-to-date`, refuse on `edited`. */
function installSkillFrom({ sourceDir, targetDir, fs: fsImpl = fs }) {
  if (!fsImpl.existsSync(sourceDir)) {
    return { ok: false, reason: 'not-bundled', detail: `No skill at ${sourceDir}` }
  }
  try {
    const plan = planSkillInstall({ sourceDir, targetDir, fs: fsImpl })
    // A source folder with no markdown means the build dropped the skill files;
    // reporting "installed" for zero files would be a silent lie.
    if (plan.files.length === 0) {
      return { ok: false, reason: 'not-bundled', detail: `No markdown in ${sourceDir}` }
    }
    if (plan.status === 'edited') return { ok: false, reason: 'edited', path: targetDir }
    if (plan.status === 'up-to-date') return { ok: true, path: targetDir, status: 'up-to-date' }
    for (const rel of plan.files) {
      const dest = path.join(targetDir, rel)
      fsImpl.mkdirSync(path.dirname(dest), { recursive: true })
      fsImpl.writeFileSync(dest, fsImpl.readFileSync(path.join(sourceDir, rel)))
    }
    return { ok: true, path: targetDir, status: 'installed' }
  } catch (err) {
    return { ok: false, reason: 'write-failed', detail: String(err && err.message) }
  }
}

// ---------------------------------------------------------------------------
// Runtime-aware helpers (lazy electron deps)
// ---------------------------------------------------------------------------

/** Folder that contains `mcp_server/` — asar-unpacked in prod, repo root in dev. */
function getProjectDir() {
  const unpacked = process.resourcesPath
    ? path.join(process.resourcesPath, 'app.asar.unpacked')
    : null
  if (unpacked && fs.existsSync(path.join(unpacked, 'mcp_server'))) return unpacked
  return path.join(__dirname, '..') // electron/ → repo root (dev)
}

function buildServerEntry() {
  const { getRuntimePaths } = require('./runtime-setup')
  return buildServerEntryFrom(getRuntimePaths().pythonExe, getProjectDir())
}

function isRuntimeReady() {
  return require('./runtime-setup').isRuntimeReady()
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch {
    return {}
  }
}

/** Copy the bundled publish skill into `~/.claude/skills/` (opt-in, user-invoked). */
function installPublishSkill() {
  return installSkillFrom({
    sourceDir: skillSourceDir(getProjectDir()),
    targetDir: skillTargetDir(os.homedir()),
    fs,
  })
}

/**
 * Install state for the UI, which always shows the target path. Never throws —
 * an unreadable bundle is reported as `unknown` rather than breaking detect().
 */
function publishSkillStatus() {
  const targetDir = skillTargetDir(os.homedir())
  try {
    const { status } = planSkillInstall({
      sourceDir: skillSourceDir(getProjectDir()),
      targetDir,
      fs,
    })
    return { path: targetDir, status }
  } catch {
    return { path: targetDir, status: 'unknown' }
  }
}

/** Which clients look installed + whether the python runtime is ready. */
function detectClients() {
  return {
    desktop: desktopTargets().some((t) => fs.existsSync(t.dir)),
    code: fs.existsSync(codeConfigPath()),
    runtimeReady: isRuntimeReady(),
    publishSkill: publishSkillStatus(),
  }
}

/** Merge `entry` into the config at `configPath`, creating parent dirs as needed. */
function _writeConfig(configPath, entry) {
  try {
    const next = mergeMcpServers(readJsonSafe(configPath), entry)
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    fs.writeFileSync(configPath, JSON.stringify(next, null, 2) + '\n', 'utf-8')
    return { ok: true, path: configPath }
  } catch (err) {
    return { ok: false, reason: 'write-failed', detail: String(err && err.message) }
  }
}

function connectDesktop() {
  if (!isRuntimeReady()) return { ok: false, reason: 'runtime-not-ready' }
  const entry = buildServerEntry()
  // Write to EVERY installed Claude Desktop flavour (standard + Store). Writing
  // only the standard path silently no-ops for Store users — the original bug.
  const installed = desktopTargets().filter((t) => fs.existsSync(t.dir))
  if (installed.length === 0) return { ok: false, reason: 'not-installed' }
  const results = installed.map((t) => _writeConfig(t.config, entry))
  return results.find((r) => r.ok) || results[0]
}

function connectCode() {
  if (!isRuntimeReady()) return { ok: false, reason: 'runtime-not-ready' }
  // Claude Code stdio entries carry an explicit type discriminator. The config
  // lives in the home dir, which always exists — so this always writes.
  const entry = { type: 'stdio', ...buildServerEntry() }
  return _writeConfig(codeConfigPath(), entry)
}

/** Everything needed for a manual copy-paste fallback. */
function getManualConfig() {
  const entry = buildServerEntry()
  return {
    ...entry,
    desktopPath: desktopConfigPath(),
    codePath: codeConfigPath(),
    desktopJson: JSON.stringify({ mcpServers: { [SERVER_NAME]: entry } }, null, 2),
    codeCommand: `claude mcp add-json ${SERVER_NAME} --scope user '${JSON.stringify({ type: 'stdio', ...entry })}'`,
  }
}

module.exports = {
  SERVER_NAME,
  PUBLISH_SKILL_NAME,
  buildServerEntryFrom,
  mergeMcpServers,
  storeDesktopTargetsFrom,
  desktopTargets,
  desktopConfigPath,
  codeConfigPath,
  getProjectDir,
  buildServerEntry,
  skillSourceDir,
  skillTargetDir,
  planSkillInstall,
  installSkillFrom,
  installPublishSkill,
  publishSkillStatus,
  detectClients,
  connectDesktop,
  connectCode,
  getManualConfig,
}
