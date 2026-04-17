/**
 * Manages the Python FastAPI backend as a child process.
 */

const { spawn } = require("child_process");
const { app } = require("electron");
const path = require("path");
const http = require("http");
const fs = require("fs");
const net = require("net");

const { getRuntimePaths, isRuntimeReady } = require("./runtime-setup");
const platform = require("./platform");

const PROJECT_ROOT = path.join(__dirname, "..");
// Picked from IANA dynamic/private range (49152-65535) to avoid collisions
// with common dev tools that camp on 8000/3000/5000/etc. The free-port lookup
// below still falls back to an OS-assigned port if even this one is busy.
// Mirrored in: backend/main.py (__main__ fallback), package.json `backend`
// script, src/renderer/src/lib/api.ts (constructor default).
const PREFERRED_PORT = 53421;

/**
 * Resolve a free TCP port, preferring `preferred`. If that's busy (another
 * CapForge instance, an unrelated dev server, etc.), fall back to an
 * OS-assigned ephemeral port. The renderer reads the actual port via the
 * `backend:port` IPC handler, so the value isn't hardcoded anywhere else.
 */
function findFreePort(preferred) {
  return new Promise((resolve) => {
    const tryListen = (port, onFail) => {
      const srv = net.createServer();
      srv.unref();
      srv.once("error", () => {
        try { srv.close(); } catch {}
        onFail();
      });
      srv.listen(port, "127.0.0.1", () => {
        const got = srv.address().port;
        srv.close(() => resolve(got));
      });
    };
    tryListen(preferred, () => tryListen(0, () => resolve(preferred)));
  });
}

// Maximum size of the backend log file before it is rotated. Small enough to
// open quickly in Notepad, large enough to capture one long transcription.
const LOG_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Resolve the log file path. `app.getPath("logs")` is platform-standard
 * (`%APPDATA%/<AppName>/logs` on Windows). Falls back to the project dir
 * if called before the app is ready, which shouldn't happen in practice.
 */
function getLogFilePath() {
  try {
    return path.join(app.getPath("logs"), "backend.log");
  } catch {
    return path.join(PROJECT_ROOT, "backend.log");
  }
}

/**
 * Rotate the log if it has exceeded LOG_MAX_BYTES. Keeps exactly one old
 * copy at `backend.log.1`; simpler and safer than a numbered ring buffer.
 */
function rotateLogIfNeeded(logPath) {
  try {
    const stat = fs.statSync(logPath);
    if (stat.size < LOG_MAX_BYTES) return;
    const rotated = logPath + ".1";
    if (fs.existsSync(rotated)) fs.unlinkSync(rotated);
    fs.renameSync(logPath, rotated);
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
function findBundledBinDir() {
  if (process.resourcesPath) {
    const packaged = path.join(process.resourcesPath, "bin");
    if (fs.existsSync(packaged)) return packaged;
  }
  const devDir = process.platform === "darwin" ? "bin-mac" : "bin-win";
  return path.join(PROJECT_ROOT, "resources", devDir);
}

/**
 * Locate the Python interpreter to run the backend with.
 *
 * Priority:
 *   1. The managed runtime installed by runtime-setup.js on first launch.
 *   2. A dev venv at the project root (path is platform-specific — Windows
 *      `.venv\Scripts\python.exe`, macOS `venv/bin/python3`).
 *   3. System `python` / `python3` on PATH (last-resort fallback).
 */
function findPython() {
  if (isRuntimeReady()) {
    return getRuntimePaths().pythonExe;
  }
  const venvPython = path.join(PROJECT_ROOT, platform.devVenvPythonRelPath);
  if (fs.existsSync(venvPython)) return venvPython;
  return process.platform === "darwin" ? "python3" : "python";
}

class PythonBackend {
  constructor() {
    this.process = null;
    this.port = PREFERRED_PORT;
    this._output = [];
    this._logStream = null;
  }

  /** Path to the current backend log file. Exposed so the UI can open it. */
  get logFilePath() {
    return getLogFilePath();
  }

  /** Start the uvicorn server. Resolves when the server is reachable. */
  async start() {
    // Resolve a free port BEFORE spawning uvicorn. If PREFERRED_PORT is busy
    // (another CapForge instance, unrelated dev server), fall back to an
    // OS-assigned port. Without this the spawn still happens, uvicorn fails
    // to bind silently, and _waitForReady times out 30s later with no
    // useful diagnostic.
    this.port = await findFreePort(PREFERRED_PORT);
    if (this.port !== PREFERRED_PORT) {
      console.log(`[CapForge] Port ${PREFERRED_PORT} busy — using ${this.port} instead.`);
    }

    return new Promise((resolve, reject) => {
      const python = findPython();
      const binDir = findBundledBinDir();
      const ffmpegExe = path.join(binDir, platform.ffmpegExeName);
      const ffprobeExe = path.join(binDir, platform.ffprobeExeName);

      // Prepend bundled bin dir to PATH so whisperx (which shells out to
      // ffmpeg by name) finds our copy first. Also expose explicit paths
      // via env vars that our own exporters consult.
      const env = { ...process.env };
      env.PATH = binDir + path.delimiter + (env.PATH || "");
      if (fs.existsSync(ffmpegExe)) env.CAPFORGE_FFMPEG = ffmpegExe;
      if (fs.existsSync(ffprobeExe)) env.CAPFORGE_FFPROBE = ffprobeExe;
      // Point the backend at the managed model dir populated during first-run setup.
      const { modelDir } = getRuntimePaths();
      env.CAPFORGE_MODEL_DIR = modelDir;
      env.HF_HOME = modelDir;
      env.HUGGINGFACE_HUB_CACHE = modelDir;
      env.PYTHONIOENCODING = "utf-8";
      env.PYTHONUTF8 = "1";
      // Platform-specific HF Hub tweaks (Windows disables symlinks to avoid
      // WinError 1314; macOS inherits defaults). See electron/platform/win.js.
      Object.assign(env, platform.extraModelDownloadEnv);

      // Open the log file for append (rotating first if it's oversized).
      // Every backend write goes to both the file and the Electron console.
      const logPath = getLogFilePath();
      try {
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        rotateLogIfNeeded(logPath);
        this._logStream = fs.createWriteStream(logPath, { flags: "a" });
        const stamp = new Date().toISOString();
        this._logStream.write(`\n===== CapForge backend started ${stamp} =====\n`);
      } catch (err) {
        console.warn("[CapForge] Could not open log file:", err.message);
        this._logStream = null;
      }

      console.log(`[CapForge] Starting backend: ${python}`);
      console.log(`[CapForge] Bundled bin dir:  ${binDir}`);
      console.log(`[CapForge] Log file:         ${logPath}`);

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
        ? path.join(process.resourcesPath, "app.asar.unpacked")
        : null;
      const cwd = unpacked && fs.existsSync(path.join(unpacked, "backend"))
        ? unpacked
        : PROJECT_ROOT;

      this.process = spawn(
        python,
        ["-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", String(this.port)],
        { cwd, windowsHide: true, env }
      );

      const writeLog = (text) => {
        this._output.push(text);
        const trimmed = text.trim();
        if (trimmed) console.log(`[backend] ${trimmed}`);
        if (this._logStream) {
          try { this._logStream.write(text); } catch {}
        }
      };
      this.process.stdout.on("data", (d) => writeLog(d.toString()));
      this.process.stderr.on("data", (d) => writeLog(d.toString()));

      this.process.on("error", (err) => {
        reject(new Error(`Failed to spawn Python: ${err.message}`));
      });

      this.process.on("exit", (code) => {
        console.log(`[CapForge] Backend exited with code ${code}`);
        this.process = null;
      });

      // Poll until the server responds
      this._waitForReady(resolve, reject, 30_000);
    });
  }

  /** Stop the backend process. */
  stop() {
    if (this._logStream) {
      try { this._logStream.end(`===== CapForge backend stopped ${new Date().toISOString()} =====\n`); } catch {}
      this._logStream = null;
    }
    if (!this.process) return;
    platform.killProcess(this.process);
    this.process = null;
  }

  /** Poll the health endpoint until it responds or timeout. */
  _waitForReady(resolve, reject, timeoutMs) {
    const start = Date.now();
    const check = () => {
      if (Date.now() - start > timeoutMs) {
        reject(new Error("Backend did not start in time.\n\n" + this._output.join("")));
        return;
      }
      const req = http.get(`http://127.0.0.1:${this.port}/api/status`, (res) => {
        if (res.statusCode === 200) {
          console.log("[CapForge] Backend is ready.");
          resolve();
        } else {
          setTimeout(check, 500);
        }
      });
      req.on("error", () => setTimeout(check, 500));
    };
    setTimeout(check, 1000); // Give it a moment to start
  }
}

module.exports = { PythonBackend };
