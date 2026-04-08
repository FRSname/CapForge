/**
 * CapForge runtime bootstrapper.
 *
 * On first launch, extracts the bundled embedded Python into the user's
 * AppData, installs pip, detects an NVIDIA GPU, then pip-installs the
 * correct torch variant + whisperx + backend deps.
 *
 * Layout under `%APPDATA%/CapForge/runtime/`:
 *
 *   runtime/
 *     python/                     <- extracted embedded Python
 *       python.exe
 *       python311._pth            <- patched to enable `import site`
 *       Lib/site-packages/        <- pip installs land here
 *     .state.json                 <- { version, gpu, completed, torchVariant }
 *
 * Public API:
 *   ensureRuntime({ onProgress }) -> Promise<{ pythonExe, gpu, torchVariant }>
 *   getRuntimePaths()             -> { runtimeDir, pythonDir, pythonExe, stateFile }
 *   isRuntimeReady()              -> boolean
 *   detectGpu()                   -> Promise<{ present, name } | { present: false }>
 */

const { app } = require("electron");
const { spawn, spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const https = require("https");

// Bump this whenever the install recipe changes (python version, package set,
// pth patch, etc.) — a mismatch forces a clean reinstall on next launch.
const RUNTIME_VERSION = 8;

// Pinned package set. Keep torch/torchaudio together so the resolver agrees.
const TORCH_CPU_INDEX = "https://download.pytorch.org/whl/cpu";
// cu124 hosts torch 2.6–2.8, which matches what PyPI ships for the current
// whisperx/transformers versions. cu121 tops out at 2.5.1 and causes API
// mismatches when transformers tries to import its pipelines submodule.
// Requires NVIDIA driver >= 550 (released March 2024).
const TORCH_CUDA_INDEX = "https://download.pytorch.org/whl/cu124";
// torchvision must be in this list too — whisperx pulls it in transitively
// and it is ABI-locked to the torch build it was compiled against. If we
// reinstall torch without also replacing torchvision, importing whisperx.asr
// fails with "operator torchvision::nms does not exist".
//
// Versions are PINNED because the cu124 index only serves torch 2.6–2.8,
// while PyPI already has 2.11. Without a pin, pip with --extra-index-url
// picks the highest version (PyPI CPU) and you end up in CPU mode despite
// asking for CUDA. These three versions are a matched ABI set.
const TORCH_PACKAGES = ["torch==2.6.0", "torchaudio==2.6.0", "torchvision==0.21.0"];
const BACKEND_PACKAGES = [
  "whisperx",
  "fastapi[standard]",
  "uvicorn[standard]",
  "websockets",
  "pydantic>=2.0",
];

const GET_PIP_URL = "https://bootstrap.pypa.io/get-pip.py";

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
    pythonExe: path.join(pythonDir, "python.exe"),
    pthFile: path.join(pythonDir, "python311._pth"),
    getPipFile: path.join(runtimeDir, "get-pip.py"),
    stateFile: path.join(runtimeDir, ".state.json"),
    modelDir,
  };
}

// Default Whisper model preloaded during first-run setup.
// large-v3-turbo: ~1.6 GB, near-v3 quality at ~4x speed.
const DEFAULT_MODEL = "large-v3-turbo";

/**
 * Resolve the bundled Python embed zip.
 * - Packaged: `<process.resourcesPath>/python/python-embed.zip`
 * - Dev:      `<project>/resources/python/python-embed.zip`
 */
function findBundledPythonZip() {
  if (process.resourcesPath) {
    const packaged = path.join(process.resourcesPath, "python", "python-embed.zip");
    if (fs.existsSync(packaged)) return packaged;
  }
  const dev = path.join(__dirname, "..", "resources", "python", "python-embed.zip");
  if (fs.existsSync(dev)) return dev;
  throw new Error(
    "Bundled Python not found. Expected python-embed.zip in resources/python/."
  );
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
  // Self-heal: state claims install is complete but python.exe is gone
  // (antivirus quarantine, user manually nuked the folder, disk corruption).
  // Delete the stale state file so the next launch re-runs the wizard
  // instead of crashing when the backend tries to spawn a missing binary.
  try {
    fs.unlinkSync(stateFile);
    console.warn("[CapForge] Runtime marker was stale; deleted .state.json to force reinstall");
  } catch {}
  return false;
}

// ---------------------------------------------------------------------------
// GPU detection
// ---------------------------------------------------------------------------

/**
 * Detect NVIDIA GPU by invoking `nvidia-smi`. Works on any machine with a
 * recent NVIDIA driver installed — the tool ships with the driver itself.
 */
async function detectGpu() {
  try {
    const result = spawnSync("nvidia-smi", ["--query-gpu=name", "--format=csv,noheader"], {
      encoding: "utf-8",
      timeout: 5000,
      windowsHide: true,
    });
    if (result.status === 0 && result.stdout) {
      const name = result.stdout.split("\n")[0].trim();
      if (name) return { present: true, name };
    }
  } catch {
    // fall through
  }
  return { present: false };
}

// ---------------------------------------------------------------------------
// Helpers: download, extract, run
// ---------------------------------------------------------------------------

function downloadFile(url, destPath, { onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const req = https.get(url, (res) => {
      // Follow redirects
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
 * Extract a .zip using PowerShell's built-in Expand-Archive. Avoids adding a
 * Node dependency for zip handling. Windows-only — fine, this whole app is.
 */
function extractZipPowerShell(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(destDir, { recursive: true });
    const ps = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Expand-Archive -LiteralPath "${zipPath}" -DestinationPath "${destDir}" -Force`,
      ],
      { windowsHide: true }
    );
    let stderr = "";
    ps.stderr.on("data", (d) => { stderr += d.toString(); });
    ps.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Expand-Archive failed (${code}): ${stderr}`));
    });
    ps.on("error", reject);
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
  const zipPath = findBundledPythonZip();
  // Fresh install: nuke any stale python dir first.
  if (fs.existsSync(pythonDir)) {
    fs.rmSync(pythonDir, { recursive: true, force: true });
  }
  fs.mkdirSync(runtimeDir, { recursive: true });
  report({ stage: "extract", message: "Extracting Python runtime…" });
  await extractZipPowerShell(zipPath, pythonDir);
}

/**
 * The embeddable Python ships with site.py disabled via `python311._pth`.
 * Uncommenting `import site` re-enables site-packages so pip-installed
 * packages are actually importable. We also add `Lib\site-packages` and
 * `Scripts` to sys.path explicitly for good measure.
 */
function patchPth() {
  const { pthFile } = getRuntimePaths();
  const patched = [
    "python311.zip",
    ".",
    "Lib\\site-packages",
    "",
    "import site",
    "",
  ].join("\r\n");
  fs.writeFileSync(pthFile, patched, "utf-8");
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
 * Pre-download the default Whisper model into CAPFORGE_MODEL_DIR by asking
 * the just-installed Python to call `whisperx.load_model` with
 * `download_root` pointed at our managed folder. faster-whisper prints
 * "Downloading …" and HF hub prints progress bars that we forward to the UI.
 */
async function downloadDefaultModel(report) {
  const { pythonExe, modelDir } = getRuntimePaths();
  fs.mkdirSync(modelDir, { recursive: true });
  report({
    stage: "model",
    message: `Downloading Whisper model (${DEFAULT_MODEL}, ~1.6 GB)…`,
  });
  // One-liner: load the model just to trigger the download, then exit.
  // compute_type=int8 is the cheapest — we only care about the files, not
  // about keeping the model resident in memory.
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
      // Force UTF-8 output so HF progress bars don't blow up on cp1250.
      PYTHONIOENCODING: "utf-8",
      PYTHONUTF8: "1",
      // Point HF cache into our dir too, in case whisperx ignores download_root for aux files.
      HF_HOME: modelDir,
      HUGGINGFACE_HUB_CACHE: modelDir,
    },
    onLine: (line) => report({ stage: "model", message: line }),
  });
}

async function installPackages(gpu, report) {
  // Install backend packages first. whisperx depends on torch and will pull
  // the default CPU wheel from PyPI — that's fine, we wipe it on the GPU path.
  report({ stage: "install", message: "Installing WhisperX and backend dependencies…" });
  await pipInstall(BACKEND_PACKAGES, { report });

  if (!gpu.present) return; // CPU users are done — whisperx already pulled cpu torch.

  // GPU path: cleanly uninstall the cpu torch that whisperx pulled in, then
  // install cu121 torch fresh with its full dep tree. We set the cu121 index
  // as primary and PyPI as --extra-index-url so any transitive deps torch
  // needs (filelock, sympy, networkx, jinja2, fsspec, typing-extensions) can
  // still resolve from PyPI. Ordering matters: if we install cu121 torch
  // FIRST, whisperx later upgrades it back to +cpu from PyPI.
  report({ stage: "install", message: "Removing CPU PyTorch…" });
  // pip uninstall needs plain package names, not version specifiers.
  await pipUninstall(["torch", "torchaudio", "torchvision"], report);

  report({ stage: "install", message: `Installing PyTorch (CUDA 12.4) for ${gpu.name}…` });
  // Pinned versions + cu124-only index = pip can't accidentally grab a newer
  // CPU wheel from PyPI. The cu124 index mirrors all transitive deps torch
  // needs (filelock, sympy, networkx, jinja2, fsspec, typing-extensions).
  await pipInstall(TORCH_PACKAGES, {
    indexUrl: TORCH_CUDA_INDEX,
    report,
  });
}

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------

/**
 * Ensure the runtime is ready. Idempotent: returns immediately if already
 * installed and the state file matches RUNTIME_VERSION.
 *
 * @param {object} opts
 * @param {(progress: {stage: string, message: string}) => void} [opts.onProgress]
 * @param {boolean} [opts.force] - reinstall even if already ready
 */
async function ensureRuntime({ onProgress, force = false } = {}) {
  const report = (p) => { if (onProgress) onProgress(p); };

  if (!force && isRuntimeReady()) {
    const state = readState();
    return {
      pythonExe: getRuntimePaths().pythonExe,
      gpu: state.gpu,
      torchVariant: state.torchVariant,
      alreadyReady: true,
    };
  }

  report({ stage: "start", message: "Preparing CapForge runtime…" });

  const gpu = await detectGpu();
  report({
    stage: "detect",
    message: gpu.present
      ? `NVIDIA GPU detected: ${gpu.name}`
      : "No NVIDIA GPU detected — using CPU build",
  });

  await extractPython(report);
  patchPth();
  await installPip(report);
  await installPackages(gpu, report);
  await downloadDefaultModel(report);

  const state = {
    version: RUNTIME_VERSION,
    completed: true,
    completedAt: new Date().toISOString(),
    gpu,
    torchVariant: gpu.present ? "cu124" : "cpu",
    defaultModel: DEFAULT_MODEL,
  };
  writeState(state);
  report({ stage: "done", message: "Runtime ready." });

  return {
    pythonExe: getRuntimePaths().pythonExe,
    gpu,
    torchVariant: state.torchVariant,
    alreadyReady: false,
  };
}

module.exports = {
  ensureRuntime,
  getRuntimePaths,
  isRuntimeReady,
  detectGpu,
  RUNTIME_VERSION,
};
