/**
 * Manages the Python FastAPI backend as a child process.
 */

const { spawn } = require('child_process')
const { app } = require('electron')
const path = require('path')
const http = require('http')
const fs = require('fs')
const net = require('net')
const crypto = require('crypto')

const { getRuntimePaths, isRuntimeReady } = require('./runtime-setup')
const { getNodeRuntimePaths } = require('./node-runtime')
const platform = require('./platform')

const PROJECT_ROOT = path.join(__dirname, '..')
// Picked from IANA dynamic/private range (49152-65535) to avoid collisions
// with common dev tools that camp on 8000/3000/5000/etc. The free-port lookup
// below still falls back to an OS-assigned port if even this one is busy.
// Mirrored in: backend/main.py (__main__ fallback), package.json `backend`
// script, src/renderer/src/lib/api.ts (constructor default).
const PREFERRED_PORT = 53421

/**
 * Resolve a free TCP port, preferring `preferred`. If that's busy (another
 * CapForge instance, an unrelated dev server, etc.), fall back to an
 * OS-assigned ephemeral port. The renderer reads the actual port via the
 * `backend:port` IPC handler, so the value isn't hardcoded anywhere else.
 */
function findFreePort(preferred) {
  return new Promise((resolve) => {
    const tryListen = (port, onFail) => {
      const srv = net.createServer()
      srv.unref()
      srv.once('error', () => {
        try {
          srv.close()
        } catch {}
        onFail()
      })
      srv.listen(port, '127.0.0.1', () => {
        const got = srv.address().port
        srv.close(() => resolve(got))
      })
    }
    tryListen(preferred, () => tryListen(0, () => resolve(preferred)))
  })
}

// Maximum size of the backend log file before it is rotated. Small enough to
// open quickly in Notepad, large enough to capture one long transcription.
const LOG_MAX_BYTES = 5 * 1024 * 1024 // 5 MB

/**
 * Resolve the log file path. `app.getPath("logs")` is platform-standard
 * (`%APPDATA%/<AppName>/logs` on Windows). Falls back to the project dir
 * if called before the app is ready, which shouldn't happen in practice.
 */
function getLogFilePath() {
  try {
    return path.join(app.getPath('logs'), 'backend.log')
  } catch {
    return path.join(PROJECT_ROOT, 'backend.log')
  }
}

/**
 * Rotate the log if it has exceeded LOG_MAX_BYTES. Keeps exactly one old
 * copy at `backend.log.1`; simpler and safer than a numbered ring buffer.
 */
function rotateLogIfNeeded(logPath) {
  try {
    const stat = fs.statSync(logPath)
    if (stat.size < LOG_MAX_BYTES) return
    const rotated = logPath + '.1'
    if (fs.existsSync(rotated)) fs.unlinkSync(rotated)
    fs.renameSync(logPath, rotated)
  } catch {
    // File doesn't exist yet or race with another writer — either is fine.
  }
}

/**
 * Resolve the directory that holds bundled native binaries (ffmpeg, ffprobe, ...).
 *
 * - In a packaged app: `<app>/resources/bin` — both platforms land here because
 *   package.json maps resources/bin-win and resources/bin-mac to `to: "bin"`.
 * - In dev (running via `npm start`): `<project>/resources/bin-mac` or
 *   `<project>/resources/bin-win`, chosen by platform.
 */
/**
 * Pure decision logic behind `findBundledBinDir()` — everything the choice
 * depends on is passed in, so it's testable without a packaged/dev Electron
 * environment.
 */
function resolveBundledBinDir({ resourcesPath, projectRoot, platformName, fs, path }) {
  if (resourcesPath) {
    const packaged = path.join(resourcesPath, 'bin')
    if (fs.existsSync(packaged)) return packaged
  }
  const devDir = platformName === 'darwin' ? 'bin-mac' : 'bin-win'
  return path.join(projectRoot, 'resources', devDir)
}

function findBundledBinDir() {
  return resolveBundledBinDir({
    resourcesPath: process.resourcesPath,
    projectRoot: PROJECT_ROOT,
    platformName: process.platform,
    fs,
    path,
  })
}

/**
 * Locate the Python interpreter to run the backend with.
 *
 * Priority:
 *   1. The managed runtime installed by runtime-setup.js on first launch.
 *   2. A dev venv at the project root (path is platform-specific — Windows
 *      `.venv\Scripts\python.exe`, macOS `venv/bin/python3`).
 *   3. System `python` / `python3` on PATH (last-resort fallback).
 *
 * The decision itself is pure and takes everything as an injected dep
 * (mirrors `preset-io.js`/`path-validate.js`) so it's unit-testable without
 * Electron; `findPython()` below just wires it up to the real environment.
 */
function resolvePythonPath({
  runtimeReady,
  runtimePythonExe,
  projectRoot,
  devVenvPythonRelPath,
  platformName,
  fs,
  path,
}) {
  if (runtimeReady) return runtimePythonExe
  const venvPython = path.join(projectRoot, devVenvPythonRelPath)
  if (fs.existsSync(venvPython)) return venvPython
  return platformName === 'darwin' ? 'python3' : 'python'
}

function findPython() {
  const runtimeReady = isRuntimeReady()
  return resolvePythonPath({
    runtimeReady,
    // Only read getRuntimePaths() when the runtime is actually ready — same
    // short-circuit as the original inline
    // `if (isRuntimeReady()) return getRuntimePaths().pythonExe`.
    runtimePythonExe: runtimeReady ? getRuntimePaths().pythonExe : undefined,
    projectRoot: PROJECT_ROOT,
    devVenvPythonRelPath: platform.devVenvPythonRelPath,
    platformName: process.platform,
    fs,
    path,
  })
}

/**
 * Build the environment for the spawned uvicorn process from a base env
 * (normally `process.env`) plus everything the backend needs to discover
 * bundled binaries, models, the local media token, and the HyperFrames Node
 * runtime. Returns a NEW object — `baseEnv` is never mutated.
 *
 * Extracted verbatim from the inline assembly in `start()` (same key order,
 * same PATH-prepend sequence — bundled bin dir first, then the managed Node
 * dir) — a behavior-preserving move, not a rewrite.
 */
function buildBackendEnv({
  baseEnv,
  binDir,
  ffmpegExe,
  ffprobeExe,
  fs,
  path,
  modelDir,
  port,
  localToken,
  extraModelDownloadEnv,
  node,
}) {
  // Prepend bundled bin dir to PATH so whisperx (which shells out to
  // ffmpeg by name) finds our copy first. Also expose explicit paths
  // via env vars that our own exporters consult.
  const env = { ...baseEnv }
  env.PATH = binDir + path.delimiter + (env.PATH || '')
  if (fs.existsSync(ffmpegExe)) env.CAPFORGE_FFMPEG = ffmpegExe
  if (fs.existsSync(ffprobeExe)) env.CAPFORGE_FFPROBE = ffprobeExe
  // Point the backend at the managed model dir populated during first-run setup.
  env.CAPFORGE_MODEL_DIR = modelDir
  env.HF_HOME = modelDir
  env.HUGGINGFACE_HUB_CACHE = modelDir
  env.PYTHONIOENCODING = 'utf-8'
  env.PYTHONUTF8 = '1'
  // Tell the backend the port we chose so it can publish the agent discovery
  // file (~/.capforge/backend.json) the local MCP control server reads.
  env.CAPFORGE_PORT = String(port)
  // Secret the renderer must echo back on media requests (see constructor).
  env.CAPFORGE_LOCAL_TOKEN = localToken
  // Platform-specific HF Hub tweaks (Windows disables symlinks to avoid
  // WinError 1314; macOS inherits defaults). See electron/platform/win.js.
  Object.assign(env, extraModelDownloadEnv)

  // HyperFrames (`npx hyperframes`) needs Node 22+. Point the backend at the
  // app-managed Node + CLI + render-browser cache. We export these paths
  // *unconditionally* — even before provisioning has created the files — and
  // the backend resolver (node_runtime.hyperframes_argv) checks existence at
  // call time. That way, on-demand provisioning that finishes *after* this
  // backend spawned is picked up on the very next render, with no restart
  // (restarting would drop the in-memory transcription). The paths are
  // deterministic (derived from userData), so they're valid in any state.
  env.CAPFORGE_NODE_BIN = node.nodeExe
  // The pinned, offline CLI is run as `node <cli.js>` (never the .cmd shim,
  // which Python subprocess can't spawn without a shell on Windows).
  env.CAPFORGE_HYPERFRAMES_CLI = node.hyperframesCli
  // Prepend the managed Node dir so the `node` the CLI sub-spawns resolves;
  // harmless before provisioning (the dir simply doesn't exist yet).
  env.PATH = node.nodeBinDir + path.delimiter + (env.PATH || '')
  // Keep the managed chrome-headless-shell app-local + uninstallable.
  env.PUPPETEER_CACHE_DIR = node.browserCacheDir

  return env
}

/**
 * The uvicorn argv, extracted verbatim from the `spawn()` call in `start()`.
 * `--no-access-log`: the local media endpoints carry the auth token as a
 * `?token=` query param (media elements can't send headers), and uvicorn's
 * access log would otherwise write that query string to backend.log. The
 * token must never be logged, so access logging is disabled here.
 */
function buildUvicornArgs(port) {
  return [
    '-m',
    'uvicorn',
    'backend.main:app',
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--no-access-log',
  ]
}

/** The health-check URL polled by `_waitForReady()`. */
function buildStatusUrl(port) {
  return `http://127.0.0.1:${port}/api/status`
}

class PythonBackend {
  constructor() {
    this.process = null
    this.port = PREFERRED_PORT
    this._output = []
    this._logStream = null
    // Per-launch random secret gating the backend's local media endpoints
    // (/api/serve-audio, /api/video-info). Minted here, injected into the
    // backend env as CAPFORGE_LOCAL_TOKEN, and handed to the renderer via the
    // `backend:local-token` IPC handler. Never persisted, never logged.
    this.localToken = crypto.randomBytes(32).toString('hex')
  }

  /** Path to the current backend log file. Exposed so the UI can open it. */
  get logFilePath() {
    return getLogFilePath()
  }

  /** Start the uvicorn server. Resolves when the server is reachable. */
  async start() {
    // Resolve a free port BEFORE spawning uvicorn. If PREFERRED_PORT is busy
    // (another CapForge instance, unrelated dev server), fall back to an
    // OS-assigned port. Without this the spawn still happens, uvicorn fails
    // to bind silently, and _waitForReady times out 30s later with no
    // useful diagnostic.
    this.port = await findFreePort(PREFERRED_PORT)
    if (this.port !== PREFERRED_PORT) {
      console.log(`[CapForge] Port ${PREFERRED_PORT} busy — using ${this.port} instead.`)
    }

    return new Promise((resolve, reject) => {
      const python = findPython()
      const binDir = findBundledBinDir()
      const ffmpegExe = path.join(binDir, platform.ffmpegExeName)
      const ffprobeExe = path.join(binDir, platform.ffprobeExeName)

      // Point the backend at the managed model dir populated during first-run setup.
      const { modelDir } = getRuntimePaths()
      // HyperFrames (`npx hyperframes`) needs Node 22+. Point the backend at the
      // app-managed Node + CLI + render-browser cache. We export these paths
      // *unconditionally* — even before provisioning has created the files — and
      // the backend resolver (node_runtime.hyperframes_argv) checks existence at
      // call time. That way, on-demand provisioning that finishes *after* this
      // backend spawned is picked up on the very next render, with no restart
      // (restarting would drop the in-memory transcription). The paths are
      // deterministic (derived from userData), so they're valid in any state.
      const node = getNodeRuntimePaths()
      const env = buildBackendEnv({
        baseEnv: process.env,
        binDir,
        ffmpegExe,
        ffprobeExe,
        fs,
        path,
        modelDir,
        port: this.port,
        localToken: this.localToken,
        extraModelDownloadEnv: platform.extraModelDownloadEnv,
        node,
      })

      // Open the log file for append (rotating first if it's oversized).
      // Every backend write goes to both the file and the Electron console.
      const logPath = getLogFilePath()
      try {
        fs.mkdirSync(path.dirname(logPath), { recursive: true })
        rotateLogIfNeeded(logPath)
        this._logStream = fs.createWriteStream(logPath, { flags: 'a' })
        const stamp = new Date().toISOString()
        this._logStream.write(`\n===== CapForge backend started ${stamp} =====\n`)
      } catch (err) {
        console.warn('[CapForge] Could not open log file:', err.message)
        this._logStream = null
      }

      console.log(`[CapForge] Starting backend: ${python}`)
      console.log(`[CapForge] Bundled bin dir:  ${binDir}`)
      console.log(`[CapForge] Log file:         ${logPath}`)

      // Backend import path resolution. Two constraints:
      //   1. cwd must be a real on-disk folder (app.asar is virtual — Windows
      //      CreateProcess fails with ENOENT if we point at it).
      //   2. Embedded Python IGNORES PYTHONPATH when a `._pth` file exists,
      //      but our patched _pth includes "." — so whatever we set as cwd
      //      is on sys.path. Therefore cwd must be the folder *containing*
      //      `backend/`, so `import backend.main` resolves.
      // In packaged mode backend/ is asarUnpack'd to app.asar.unpacked/backend.
      // In dev, backend/ lives directly under PROJECT_ROOT.
      const unpacked = process.resourcesPath
        ? path.join(process.resourcesPath, 'app.asar.unpacked')
        : null
      const cwd =
        unpacked && fs.existsSync(path.join(unpacked, 'backend')) ? unpacked : PROJECT_ROOT

      this.process = spawn(python, buildUvicornArgs(this.port), { cwd, windowsHide: true, env })

      const writeLog = (text) => {
        this._output.push(text)
        const trimmed = text.trim()
        if (trimmed) console.log(`[backend] ${trimmed}`)
        if (this._logStream) {
          try {
            this._logStream.write(text)
          } catch {}
        }
      }
      this.process.stdout.on('data', (d) => writeLog(d.toString()))
      this.process.stderr.on('data', (d) => writeLog(d.toString()))

      this.process.on('error', (err) => {
        reject(new Error(`Failed to spawn Python: ${err.message}`))
      })

      this.process.on('exit', (code) => {
        console.log(`[CapForge] Backend exited with code ${code}`)
        this.process = null
      })

      // Poll until the server responds
      this._waitForReady(resolve, reject, 30_000)
    })
  }

  /** Stop the backend process. */
  stop() {
    if (this._logStream) {
      try {
        this._logStream.end(`===== CapForge backend stopped ${new Date().toISOString()} =====\n`)
      } catch {}
      this._logStream = null
    }
    if (!this.process) return
    platform.killProcess(this.process)
    this.process = null
  }

  /** Poll the health endpoint until it responds or timeout. */
  _waitForReady(resolve, reject, timeoutMs) {
    const start = Date.now()
    const check = () => {
      if (Date.now() - start > timeoutMs) {
        reject(new Error('Backend did not start in time.\n\n' + this._output.join('')))
        return
      }
      const req = http.get(buildStatusUrl(this.port), (res) => {
        if (res.statusCode === 200) {
          console.log('[CapForge] Backend is ready.')
          resolve()
        } else {
          setTimeout(check, 500)
        }
      })
      req.on('error', () => setTimeout(check, 500))
    }
    setTimeout(check, 1000) // Give it a moment to start
  }
}

module.exports = {
  PythonBackend,
  // Pure helpers — exported for `python-manager.test.js` (no Electron
  // required, mirrors preset-io.js / path-validate.js).
  PREFERRED_PORT,
  LOG_MAX_BYTES,
  resolvePythonPath,
  resolveBundledBinDir,
  buildBackendEnv,
  buildUvicornArgs,
  buildStatusUrl,
  rotateLogIfNeeded,
}
