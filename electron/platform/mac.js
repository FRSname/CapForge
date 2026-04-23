/**
 * macOS platform module for CapForge — Option A (CPU-only).
 *
 * Rationale: whisperx uses CTranslate2 for transcription, and CTranslate2
 * does not support Metal/MPS. MPS could only accelerate the alignment and
 * diarization stages (which run through plain torch), but those aren't the
 * bottleneck. A real speedup on Apple Silicon would require swapping in
 * whisper.cpp + CoreML, which is a second ASR engine to maintain. For v1 we
 * ship CPU-only — the same Python stack as Windows, zero platform-specific
 * ML code. Performance on M-series chips is acceptable (~60–120 s for a
 * 10-minute clip with large-v3-turbo).
 *
 * ### TODO(whisper-cpp) — future perf upgrade path
 *
 * If users complain about transcription speed, the plug-in point is
 * `backend/engine/transcriber.py`. Add an alternate backend that uses
 * `pywhispercpp` on macOS when `platform.id === "mac"`, keep whisperx's
 * aligner for word timestamps. Don't touch this file — the runtime install
 * recipe stays identical.
 *
 * ### Still-open implementation work before the first Mac build ships
 *
 * 1. **Bundled Python** — drop an arm64 build from
 *    https://github.com/astral-sh/python-build-standalone into
 *    `resources/python/python-mac-arm64.tar.gz`. Confirm the interpreter
 *    lands at `<pythonDir>/bin/python3` after extraction; adjust
 *    `pythonExeRelPath` if the layout differs.
 * 2. **ffmpeg** — bundle a macOS arm64 build into `resources/bin/` (or a
 *    sibling `resources/bin-mac/` — then update `findBundledBinDir` in
 *    python-manager.js to be platform-aware). Must be codesigned or the
 *    notarization step rejects the app.
 * 3. **package.json `build.mac`** — add `target: ["dmg"]`, `category`,
 *    `hardenedRuntime: true`, entitlements file, `notarize: true`. Needs an
 *    Apple Developer account ($99/yr) and a signing certificate in the
 *    build-machine keychain.
 * 4. **CI** — add a `macos-latest` job to GitHub Actions so releases build
 *    both installers automatically.
 */

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

// ---------------------------------------------------------------------------
// Python runtime bootstrapping
// ---------------------------------------------------------------------------

/**
 * Locate the bundled Python runtime.
 *
 * The returned path is a DIRECTORY (not a tarball) on macOS — Apple's
 * notarization service recursively scans inside tar/zip archives and rejects
 * unsigned Mach-O binaries, so we extract at build time and ship the folder.
 * Each binary inside gets signed by electron-builder's signing pass.
 *
 * Packaged layout:  <appResources>/python/bin/python3
 * Dev layout:       <repo>/resources/python-mac-extracted/bin/python3
 *
 * Dev-mode autoextract: if the dev folder is missing but the tarball exists,
 * unpack on-the-fly so `npm run dev` still works without a manual step.
 */
function findBundledPythonArchive() {
  if (process.resourcesPath) {
    const packaged = path.join(process.resourcesPath, "python");
    if (fs.existsSync(path.join(packaged, "bin", "python3"))) return packaged;
  }

  const devExtracted = path.join(__dirname, "..", "..", "resources", "python-mac-extracted");
  if (fs.existsSync(path.join(devExtracted, "bin", "python3"))) return devExtracted;

  const devTarball = path.join(__dirname, "..", "..", "resources", "python", "python-mac-arm64.tar.gz");
  if (fs.existsSync(devTarball)) {
    const { execFileSync } = require("child_process");
    fs.mkdirSync(devExtracted, { recursive: true });
    execFileSync("tar", ["--strip-components=1", "-xzf", devTarball, "-C", devExtracted]);
    return devExtracted;
  }

  throw new Error(
    "Bundled Python not found. Run `node scripts/prepare-mac-python.js` or " +
    "download a build from https://github.com/astral-sh/python-build-standalone " +
    "into resources/python/python-mac-arm64.tar.gz."
  );
}

/**
 * Copy the pre-extracted, codesigned Python runtime into the user's writable
 * runtime dir. Uses `ditto` to preserve symlinks, executable bits, and
 * extended attributes — including the codesign signatures applied at build time.
 * `cp -R` mangles Python's bin/ symlinks; `ditto` doesn't.
 */
function extractPython(sourceDir, destDir) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(destDir, { recursive: true });
    const proc = spawn("ditto", [sourceDir, destDir], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ditto failed (${code}): ${stderr}`));
    });
    proc.on("error", reject);
  });
}

// python-build-standalone ships a normal Python install — no `._pth` file
// and site-packages is enabled by default. Nothing to patch.
function patchPythonConfig(_pythonDir) {
  /* no-op */
}

// ---------------------------------------------------------------------------
// Accelerator detection
// ---------------------------------------------------------------------------

/**
 * macOS doesn't have NVIDIA GPUs and we ship CPU-only (see file header for
 * rationale). This always returns CPU — no detection needed. Kept as an
 * async function so the contract matches Windows.
 */
async function detectAccelerator() {
  return {
    present: false,
    name: process.arch === "arm64" ? "Apple Silicon (CPU)" : "CPU",
    kind: "cpu",
  };
}

// ---------------------------------------------------------------------------
// Torch install
// ---------------------------------------------------------------------------

/**
 * On macOS, whisperx's transitive torch install is already the right one
 * (PyPI's default macOS wheels). No index switching, no uninstall/reinstall,
 * no pinning. The entire Windows trap list (cu124 index, version pinning,
 * torchvision ABI lock, `--extra-index-url` gotcha) does not apply.
 */
async function installTorch({ accelerator, pipInstall, pipUninstall, report }) {
  // Avoid unused-param lint noise — contract symmetry with win.js.
  void pipInstall; void pipUninstall; void accelerator;
  report({ stage: "install", message: "PyTorch (CPU) already installed by whisperx." });
  return { torchVariant: "cpu" };
}

// ---------------------------------------------------------------------------
// Process termination
// ---------------------------------------------------------------------------

/**
 * macOS posix process groups mean SIGTERM to the child usually takes down
 * uvicorn workers cleanly. If we ever see orphaned children, add a SIGKILL
 * escalation after a short grace period.
 */
function killProcess(child) {
  try { child.kill("SIGTERM"); } catch { /* already dead */ }
}

module.exports = {
  id: "mac",

  // python-build-standalone standard layout: <extracted>/bin/python3
  pythonExeRelPath: path.join("bin", "python3"),
  devVenvPythonRelPath: path.join(".venv", "bin", "python3"),

  ffmpegExeName: "ffmpeg",
  ffprobeExeName: "ffprobe",

  findBundledPythonArchive,
  extractPython,
  patchPythonConfig,
  detectAccelerator,
  installTorch,
  killProcess,

  // macOS supports symlinks natively — no HF Hub workarounds needed.
  extraModelDownloadEnv: {},
};
