/**
 * Manages the Python FastAPI backend as a child process.
 */

const { spawn } = require("child_process");
const { app } = require("electron");
const path = require("path");
const http = require("http");
const fs = require("fs");

const { getRuntimePaths, isRuntimeReady } = require("./runtime-setup");

const PROJECT_ROOT = path.join(__dirname, "..");
const PORT = 8000;

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
 * - In dev (running via `npm start`): `<project>/resources/bin`
 * - In a packaged app: `<app>/resources/bin` (set as extraResources in package.json)
 *
 * `process.resourcesPath` is only defined inside an Electron runtime; the
 * dev path is used when this file is required outside Electron (unit tests, etc.).
 */
function findBundledBinDir() {
  if (process.resourcesPath) {
    const packaged = path.join(process.resourcesPath, "bin");
    if (fs.existsSync(packaged)) return packaged;
  }
  return path.join(PROJECT_ROOT, "resources", "bin");
}

/**
 * Locate the Python interpreter to run the backend with.
 *
 * Priority:
 *   1. The managed runtime at `%APPDATA%/CapForge/runtime/python/python.exe`
 *      (installed by runtime-setup.js on first launch).
 *   2. A dev `.venv` at the project root (for developers running `npm start`
 *      without going through the first-run flow).
 *   3. System `python` on PATH (last-resort fallback).
 */
function findPython() {
  if (isRuntimeReady()) {
    return getRuntimePaths().pythonExe;
  }
  const venvPython = path.join(PROJECT_ROOT, ".venv", "Scripts", "python.exe");
  if (fs.existsSync(venvPython)) return venvPython;
  return "python";
}

class PythonBackend {
  constructor() {
    this.process = null;
    this.port = PORT;
    this._output = [];
    this._logStream = null;
  }

  /** Path to the current backend log file. Exposed so the UI can open it. */
  get logFilePath() {
    return getLogFilePath();
  }

  /** Start the uvicorn server. Resolves when the server is reachable. */
  start() {
    return new Promise((resolve, reject) => {
      const python = findPython();
      const binDir = findBundledBinDir();
      const ffmpegExe = path.join(binDir, "ffmpeg.exe");
      const ffprobeExe = path.join(binDir, "ffprobe.exe");

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
    try {
      const treeKill = require("tree-kill");
      treeKill(this.process.pid);
    } catch {
      this.process.kill();
    }
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
