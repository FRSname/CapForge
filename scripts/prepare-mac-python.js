#!/usr/bin/env node
/**
 * Pre-extracts the bundled Python tarball so electron-builder ships the runtime
 * as a folder of individually signable binaries — required for macOS notarization,
 * which recursively scans inside tar/zip archives and rejects unsigned Mach-Os.
 *
 * Idempotent: re-runs only if the tarball is newer than the cached extraction.
 * Invoked by: release-mac.sh, before-build.js (electron-builder beforeBuild hook).
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TARBALL = path.join(ROOT, 'resources', 'python', 'python-mac-arm64.tar.gz');
const OUT_DIR = path.join(ROOT, 'resources', 'python-mac-extracted');
const MARKER = path.join(OUT_DIR, '.extracted-from-mtime');
const SENTINEL = path.join(OUT_DIR, 'bin', 'python3');

function mtimeMs(p) {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

function prepare() {
  if (!fs.existsSync(TARBALL)) {
    throw new Error(`[prepare-mac-python] Tarball missing: ${TARBALL}`);
  }

  const tarballMtime = mtimeMs(TARBALL);
  const cachedMtime = fs.existsSync(MARKER)
    ? Number(fs.readFileSync(MARKER, 'utf-8'))
    : 0;

  if (fs.existsSync(SENTINEL) && cachedMtime === tarballMtime) {
    console.log('[prepare-mac-python] Extraction is up to date — skipping.');
    return;
  }

  if (fs.existsSync(OUT_DIR)) {
    fs.rmSync(OUT_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log(`[prepare-mac-python] Extracting ${path.basename(TARBALL)} → ${OUT_DIR}`);
  execFileSync(
    'tar',
    ['--strip-components=1', '-xzf', TARBALL, '-C', OUT_DIR],
    { stdio: 'inherit' },
  );

  fs.writeFileSync(MARKER, String(tarballMtime), 'utf-8');
  console.log('[prepare-mac-python] Done.');
}

module.exports = { prepare };

if (require.main === module) {
  try {
    prepare();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
