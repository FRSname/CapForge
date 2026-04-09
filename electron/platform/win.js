/**
 * Windows platform module for CapForge.
 *
 * Implements the platform contract — everything that differs from macOS goes
 * here. The shared layer (runtime-setup.js, python-manager.js) imports this
 * through `./platform/index.js` and never touches `process.platform`.
 *
 * ### Platform contract
 *
 *   id: "win" | "mac"
 *   pythonExeRelPath: string                         — relative to pythonDir
 *   devVenvPythonRelPath: string                     — dev-mode venv fallback
 *   ffmpegExeName / ffprobeExeName: string
 *
 *   findBundledPythonArchive(): string               — returns path to archive
 *   extractPython(archivePath, pythonDir): Promise   — extracts into pythonDir
 *   patchPythonConfig(pythonDir): void               — post-extract fixups
 *
 *   detectAccelerator(): Promise<{ present, name, kind }>    — kind: "cuda"|"cpu"
 *   installTorch({ gpu, pipInstall, pipUninstall, report }):
 *       Promise<{ torchVariant }>                    — "cu124" / "mps" / "cpu"
 *
 *   killProcess(child): void                         — terminate child tree
 *
 *   extraModelDownloadEnv: object                    — HF hub env tweaks
 */

const { spawn, spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

// ---------------------------------------------------------------------------
// Torch package pinning
// ---------------------------------------------------------------------------

// cu124 index tops out at 2.6.0 (not 2.8 as the name might suggest). Driver
// requirement: NVIDIA driver ≥ 550. See DOCS.md "Packaging Lessons Learned"
// for the full trap list around torch install order.
const TORCH_CUDA_INDEX = "https://download.pytorch.org/whl/cu124";
const TORCH_CUDA_PACKAGES = ["torch==2.6.0", "torchaudio==2.6.0", "torchvision==0.21.0"];

// ---------------------------------------------------------------------------
// Python runtime bootstrapping
// ---------------------------------------------------------------------------

function findBundledPythonArchive() {
  if (process.resourcesPath) {
    const packaged = path.join(process.resourcesPath, "python", "python-embed.zip");
    if (fs.existsSync(packaged)) return packaged;
  }
  const dev = path.join(__dirname, "..", "..", "resources", "python", "python-embed.zip");
  if (fs.existsSync(dev)) return dev;
  throw new Error(
    "Bundled Python not found. Expected python-embed.zip in resources/python/."
  );
}

/**
 * Extract a .zip using PowerShell's built-in Expand-Archive. Avoids adding a
 * Node dependency for zip handling.
 */
function extractPython(archivePath, destDir) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(destDir, { recursive: true });
    const ps = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Expand-Archive -LiteralPath "${archivePath}" -DestinationPath "${destDir}" -Force`,
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
 * The embeddable Python ships with site.py disabled via `python311._pth`.
 * Uncommenting `import site` re-enables site-packages so pip-installed
 * packages are actually importable. Also — critically — keep `.` in the list
 * so the backend's spawn cwd ends up on sys.path (see python-manager.js for
 * why this matters; embedded Python ignores PYTHONPATH when _pth exists).
 */
function patchPythonConfig(pythonDir) {
  const pthFile = path.join(pythonDir, "python311._pth");
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

// ---------------------------------------------------------------------------
// GPU detection
// ---------------------------------------------------------------------------

/**
 * Detect NVIDIA GPU by invoking `nvidia-smi`. Works on any machine with a
 * recent NVIDIA driver installed — the tool ships with the driver itself.
 * Falls back to CPU if no NVIDIA GPU is found.
 */
async function detectAccelerator() {
  try {
    const result = spawnSync("nvidia-smi", ["--query-gpu=name", "--format=csv,noheader"], {
      encoding: "utf-8",
      timeout: 5000,
      windowsHide: true,
    });
    if (result.status === 0 && result.stdout) {
      const name = result.stdout.split("\n")[0].trim();
      if (name) return { present: true, name, kind: "cuda" };
    }
  } catch {
    // fall through
  }
  return { present: false, name: "CPU", kind: "cpu" };
}

// ---------------------------------------------------------------------------
// Torch install — the trap-filled part
// ---------------------------------------------------------------------------

/**
 * Install the correct torch variant for this machine. Called AFTER the
 * backend package set (whisperx + fastapi + …) is already installed, because
 * whisperx drags in a CPU torch as a transitive that we then replace on GPU
 * machines. See DOCS.md traps B–F for the full history of why each step of
 * this dance is required.
 */
async function installTorch({ accelerator, pipInstall, pipUninstall, report }) {
  if (accelerator.kind !== "cuda") {
    // CPU users are already done — whisperx pulled the right (CPU) torch.
    return { torchVariant: "cpu" };
  }

  report({ stage: "install", message: "Removing CPU PyTorch…" });
  await pipUninstall(["torch", "torchaudio", "torchvision"], report);

  report({ stage: "install", message: `Installing PyTorch (CUDA 12.4) for ${accelerator.name}…` });
  await pipInstall(TORCH_CUDA_PACKAGES, {
    indexUrl: TORCH_CUDA_INDEX,
    report,
  });

  return { torchVariant: "cu124" };
}

// ---------------------------------------------------------------------------
// Backend process management
// ---------------------------------------------------------------------------

function killProcess(child) {
  try {
    const treeKill = require("tree-kill");
    treeKill(child.pid);
  } catch {
    child.kill();
  }
}

module.exports = {
  id: "win",

  pythonExeRelPath: "python.exe",
  devVenvPythonRelPath: path.join(".venv", "Scripts", "python.exe"),

  ffmpegExeName: "ffmpeg.exe",
  ffprobeExeName: "ffprobe.exe",

  findBundledPythonArchive,
  extractPython,
  patchPythonConfig,
  detectAccelerator,
  installTorch,
  killProcess,

  // HF Hub on Windows tries to symlink blobs into snapshots/ by default. That
  // fails with WinError 1314 unless the user has admin or Developer Mode.
  // Disabling symlinks makes HF copy files instead. See DOCS.md for context.
  extraModelDownloadEnv: {
    HF_HUB_DISABLE_SYMLINKS: "1",
    HF_HUB_DISABLE_SYMLINKS_WARNING: "1",
  },
};
