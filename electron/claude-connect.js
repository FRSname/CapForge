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

function desktopConfigPath() {
  if (process.platform === 'darwin') {
    return path.join(
      os.homedir(),
      'Library',
      'Application Support',
      'Claude',
      'claude_desktop_config.json'
    )
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
    return path.join(appData, 'Claude', 'claude_desktop_config.json')
  }
  return path.join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json')
}

function codeConfigPath() {
  return path.join(os.homedir(), '.claude.json')
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

/** Which clients look installed + whether the python runtime is ready. */
function detectClients() {
  return {
    desktop: fs.existsSync(path.dirname(desktopConfigPath())),
    code: fs.existsSync(codeConfigPath()),
    runtimeReady: isRuntimeReady(),
  }
}

function _connect(configPath, requireExistingDir, entry) {
  if (!isRuntimeReady()) return { ok: false, reason: 'runtime-not-ready' }
  const dir = path.dirname(configPath)
  // Only write where the client clearly exists — don't fabricate its folders.
  if (requireExistingDir && !fs.existsSync(dir)) return { ok: false, reason: 'not-installed' }
  try {
    const next = mergeMcpServers(readJsonSafe(configPath), entry)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(configPath, JSON.stringify(next, null, 2) + '\n', 'utf-8')
    return { ok: true, path: configPath }
  } catch (err) {
    return { ok: false, reason: 'write-failed', detail: String(err && err.message) }
  }
}

function connectDesktop() {
  return _connect(desktopConfigPath(), true, buildServerEntry())
}

function connectCode() {
  // Claude Code stdio entries carry an explicit type discriminator.
  const entry = { type: 'stdio', ...buildServerEntry() }
  return _connect(codeConfigPath(), true, entry)
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
  buildServerEntryFrom,
  mergeMcpServers,
  desktopConfigPath,
  codeConfigPath,
  getProjectDir,
  buildServerEntry,
  detectClients,
  connectDesktop,
  connectCode,
  getManualConfig,
}
