/**
 * CapForge runtime bootstrapper (shared, platform-agnostic layer).
 *
 * Orchestrates the first-run install:
 *   1. Detect accelerator               — platform.detectAccelerator()
 *   2. Extract bundled Python runtime   — platform.extractPython()
 *   3. Patch Python config (Windows _pth / no-op on macOS) — platform.patchPythonConfig()
 *   4. Bootstrap pip                    — shared
 *   5. Install WhisperX + backend deps  — shared
 *   6. Install correct torch variant    — platform.installTorch()
 *   7. Pre-download the default model   — shared
 *
 * Everything truly different between Windows and macOS lives in
 * `./platform/{win,mac}.js`. The rest — state file, progress plumbing, pip
 * helpers, model download — is shared.
 *
 * Layout under `<userData>/runtime/`:
 *
 *   runtime/
 *     python/                 <- extracted Python runtime (embed / pbs)
 *     .state.json             <- { version, gpu, completed, torchVariant }
 *
 * Public API:
 *   ensureRuntime({ onProgress, force }) -> Promise<{ pythonExe, gpu, torchVariant }>
 *   getRuntimePaths()                    -> { runtimeDir, pythonDir, pythonExe, stateFile, modelDir }
 *   isRuntimeReady()                     -> boolean
 *   detectAccelerator()                  -> Promise<{ present, name, kind }>
 */

const { app } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const https = require("https");

const platform = require("./platform");

// Bump this whenever the install recipe changes (python version, package set,
// platform module logic, etc.) — a mismatch forces a clean reinstall on next
// launch.
const RUNTIME_VERSION = 9;

const BACKEND_PACKAGES = [
  "whisperx",
  "fastapi[standard]",
  "uvicorn[standard]",
  "websockets",
  "pydantic>=2.0",
];

const GET_PIP_URL = "https://bootstrap.pypa.io/get-pip.py";

// Default Whisper model preloaded during first-run setup.
// large-v3-turbo: ~1.6 GB, near-v3 quality at ~4x speed.
const DEFAULT_MODEL = "large-v3-turbo";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function getRuntimePaths() {
  const runtimeDir = path.join(app.getPath("userData"), "runtime");
  const pythonDir = path.join(runtimeDir, "python");
  const modelDir = path.join(app.getPath("userData"), "models");
  return {
    runtimeDir,
    pythonDir,
    pythonExe: path.join(pythonDir, platform.pythonExeRelPath),
    getPipFile: path.join(runtimeDir, "get-pip.py"),
    stateFile: path.join(runtimeDir, ".state.json"),
    modelDir,
  };
}

// ---------------------------------------------------------------------------
// State file
// ---------------------------------------------------------------------------

function readState() {
  const { stateFile } = getRuntimePaths();
  if (!fs.existsSync(stateFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(stateFile, "utf-8"));
  } catch {
    return null;
  }
}

function writeState(state) {
  const { stateFile, runtimeDir } = getRuntimePaths();
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf-8");
}

function isRuntimeReady() {
  const state = readState();
  if (!state) return false;
  if (state.version !== RUNTIME_VERSION) return false;
  if (!state.completed) return false;
  const { pythonExe, stateFile } = getRuntimePaths();
  if (fs.existsSync(pythonExe)) return true;
  // Self-heal: state claims install is complete but python is gone
  // (antivirus quarantine, user manually nuked the folder, disk corruption).
  // Delete the stale state file so the next launch re-runs the wizard.
  try {
    fs.unlinkSync(stateFile);
    console.warn("[CapForge] Runtime marker was stale; deleted .state.json to force reinstall");
  } catch {}
  return false;
}

// ---------------------------------------------------------------------------
// Helpers: download + run
// ---------------------------------------------------------------------------

function downloadFile(url, destPath, { onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const req = https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlinkSync(destPath);
        downloadFile(res.headers.location, destPath, { onProgress }).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`Download failed: HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const total = parseInt(res.headers["content-length"] || "0", 10);
      let received = 0;
      res.on("data", (chunk) => {
        received += chunk.length;
        if (onProgress && total) onProgress(received, total);
      });
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
    });
    req.on("error", (err) => {
      try { fs.unlinkSync(destPath); } catch {}
      reject(err);
    });
  });
}

/**
 * Run a command, streaming stdout/stderr to onLine(). Resolves on exit 0,
 * rejects otherwise.
 */
function runCommand(cmd, args, { cwd, env, onLine } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env, windowsHide: true });
    const tail = [];
    const handle = (data) => {
      const text = data.toString();
      text.split(/\r?\n/).forEach((line) => {
        if (!line) return;
        tail.push(line);
        if (tail.length > 200) tail.shift();
        if (onLine) onLine(line);
      });
    };
    child.stdout.on("data", handle);
    child.stderr.on("data", handle);
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed (${code}): ${cmd} ${args.join(" ")}\n${tail.slice(-20).join("\n")}`));
    });
  });
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

async function extractPython(report) {
  const { pythonDir, runtimeDir } = getRuntimePaths();
  const archivePath = platform.findBundledPythonArchive();
  // Fresh install: nuke any stale python dir first.
  if (fs.existsSync(pythonDir)) {
    fs.rmSync(pythonDir, { recursive: true, force: true });
  }
  fs.mkdirSync(runtimeDir, { recursive: true });
  report({ stage: "extract", message: "Extracting Python runtime…" });
  await platform.extractPython(archivePath, pythonDir);
}

async function installPip(report) {
  const { getPipFile, pythonExe, runtimeDir } = getRuntimePaths();
  report({ stage: "pip", message: "Downloading pip bootstrap…" });
  await downloadFile(GET_PIP_URL, getPipFile, {
    onProgress: (rx, total) => {
      report({ stage: "pip", message: `Downloading get-pip.py (${Math.round((rx / total) * 100)}%)` });
    },
  });
  report({ stage: "pip", message: "Installing pip…" });
  await runCommand(pythonExe, [getPipFile, "--no-warn-script-location"], {
    cwd: runtimeDir,
    onLine: (line) => report({ stage: "pip", message: line }),
  });
}

async function pipInstall(pkgs, { indexUrl, extraIndexUrl, report }) {
  const { pythonExe, runtimeDir } = getRuntimePaths();
  const args = ["-m", "pip", "install", "--no-warn-script-location", "--disable-pip-version-check"];
  if (indexUrl) args.push("--index-url", indexUrl);
  if (extraIndexUrl) args.push("--extra-index-url", extraIndexUrl);
  args.push(...pkgs);
  await runCommand(pythonExe, args, {
    cwd: runtimeDir,
    onLine: (line) => report({ stage: "install", message: line }),
  });
}

async function pipUninstall(pkgs, report) {
  const { pythonExe, runtimeDir } = getRuntimePaths();
  await runCommand(pythonExe, ["-m", "pip", "uninstall", "-y", ...pkgs], {
    cwd: runtimeDir,
    onLine: (line) => report({ stage: "install", message: line }),
  }).catch(() => { /* nothing to uninstall is fine */ });
}

/**
 * Install backend packages, then hand off to the platform module for the
 * correct torch variant. Returns the chosen torch variant string so it can
 * be written to the state file for later diagnostics.
 */
async function installPackages(accelerator, report) {
  report({ stage: "install", message: "Installing WhisperX and backend dependencies…" });
  await pipInstall(BACKEND_PACKAGES, { report });

  const { torchVariant } = await platform.installTorch({
    accelerator,
    pipInstall,
    pipUninstall,
    report,
  });
  return torchVariant;
}

/**
 * Pre-download the default Whisper model into CAPFORGE_MODEL_DIR by asking
 * the just-installed Python to call `whisperx.load_model` with
 * `download_root` pointed at our managed folder.
 */
async function downloadDefaultModel(report) {
  const { pythonExe, modelDir } = getRuntimePaths();
  fs.mkdirSync(modelDir, { recursive: true });
  report({
    stage: "model",
    message: `Downloading Whisper model (${DEFAULT_MODEL}, ~1.6 GB)…`,
  });
  const script = [
    "import os, sys, traceback",
    "try:",
    "    import torch",
    "    print(f'[capforge] torch={torch.__version__} cuda_build={torch.version.cuda} cuda_available={torch.cuda.is_available()}', flush=True)",
    "except Exception:",
    "    print('[capforge] torch import FAILED:', flush=True)",
    "    traceback.print_exc()",
    "    sys.exit(2)",
    "try:",
    "    import whisperx",
    "except Exception as e:",
    "    print('[capforge] whisperx import FAILED — full cause chain:', flush=True)",
    "    traceback.print_exc()",
    "    cause = e.__cause__ or e.__context__",
    "    while cause is not None:",
    "        print('[capforge] caused by:', flush=True)",
    "        traceback.print_exception(type(cause), cause, cause.__traceback__)",
    "        cause = cause.__cause__ or cause.__context__",
    "    sys.exit(3)",
    `model_dir = r"${modelDir.replace(/\\/g, "\\\\")}"`,
    "os.makedirs(model_dir, exist_ok=True)",
    'print(f"[capforge] Downloading into {model_dir}", flush=True)',
    "try:",
    `    whisperx.load_model("${DEFAULT_MODEL}", "cpu", compute_type="int8", download_root=model_dir)`,
    "except Exception as e:",
    "    print('[capforge] load_model FAILED — full cause chain:', flush=True)",
    "    traceback.print_exc()",
    "    cause = e.__cause__ or e.__context__",
    "    while cause is not None:",
    "        print('[capforge] caused by:', flush=True)",
    "        traceback.print_exception(type(cause), cause, cause.__traceback__)",
    "        cause = cause.__cause__ or cause.__context__",
    "    sys.exit(4)",
    'print("[capforge] Model ready", flush=True)',
  ].join("\n");
  await runCommand(pythonExe, ["-u", "-c", script], {
    env: {
      ...process.env,
      PYTHONIOENCODING: "utf-8",
      PYTHONUTF8: "1",
      HF_HOME: modelDir,
      HUGGINGFACE_HUB_CACHE: modelDir,
      ...platform.extraModelDownloadEnv,
    },
    onLine: (line) => report({ stage: "model", message: line }),
  });
}

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------

/**
 * Ensure the runtime is ready. Idempotent: returns immediately if already
 * installed and the state file matches RUNTIME_VERSION.
 */
async function ensureRuntime({ onProgress, force = false } = {}) {
  const report = (p) => { if (onProgress) onProgress(p); };

  if (!force && isRuntimeReady()) {
    const state = readState();
    return {
      pythonExe: getRuntimePaths().pythonExe,
      accelerator: state.accelerator || state.gpu,
      torchVariant: state.torchVariant,
      alreadyReady: true,
    };
  }

  report({ stage: "start", message: "Preparing CapForge runtime…" });

  const accelerator = await platform.detectAccelerator();
  report({
    stage: "detect",
    message: accelerator.kind === "cuda"
      ? `NVIDIA GPU detected: ${accelerator.name}`
      : `Running in CPU mode (${accelerator.name})`,
  });

  await extractPython(report);
  platform.patchPythonConfig(getRuntimePaths().pythonDir);
  await installPip(report);
  const torchVariant = await installPackages(accelerator, report);
  await downloadDefaultModel(report);

  const state = {
    version: RUNTIME_VERSION,
    completed: true,
    completedAt: new Date().toISOString(),
    platform: platform.id,
    accelerator,
    torchVariant,
    defaultModel: DEFAULT_MODEL,
  };
  writeState(state);
  report({ stage: "done", message: "Runtime ready." });

  return {
    pythonExe: getRuntimePaths().pythonExe,
    accelerator,
    torchVariant,
    alreadyReady: false,
  };
}

module.exports = {
  ensureRuntime,
  getRuntimePaths,
  isRuntimeReady,
  detectAccelerator: platform.detectAccelerator,
  RUNTIME_VERSION,
};
