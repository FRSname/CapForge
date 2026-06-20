/**
 * Managed Node.js runtime paths (for the HyperFrames CLI).
 *
 * HyperFrames (`npx hyperframes …`) needs Node.js 22+. We provision an
 * app-managed Node under `<userData>/runtime/node/` so the feature works
 * without the user installing Node system-wide — mirroring how Python is
 * managed in `runtime-setup.js`.
 *
 * This module only computes paths and reports readiness. Provisioning
 * (download/extract Node, install the hyperframes package, fetch the headless
 * browser) lands in a later phase. Until then `isNodeRuntimeReady()` is false
 * and callers transparently fall back to a system `npx` on PATH.
 *
 * Layout under `<userData>/runtime/`:
 *   node/                 <- extracted Node runtime (bin/node|node.exe, …)
 *   puppeteer/            <- managed chrome-headless-shell (PUPPETEER_CACHE_DIR)
 */

const { app } = require('electron')
const path = require('path')
const fs = require('fs')

const platform = require('./platform')

function getNodeRuntimePaths() {
  const runtimeDir = path.join(app.getPath('userData'), 'runtime')
  const nodeDir = path.join(runtimeDir, 'node')
  return {
    nodeDir,
    nodeExe: path.join(nodeDir, platform.nodeExeRelPath),
    npx: path.join(nodeDir, platform.npxRelPath),
    npm: path.join(nodeDir, platform.npmRelPath),
    // The hyperframes CLI, installed via `npm install -g` into the managed node.
    hyperframesBin: path.join(nodeDir, platform.hyperframesBinRelPath),
    // Dir to prepend to PATH so `node`/`npx`/`hyperframes` (and the node the
    // CLI spawns) resolve. macOS: <nodeDir>/bin; Windows: <nodeDir> (exe at root).
    nodeBinDir: path.join(nodeDir, path.dirname(platform.nodeExeRelPath)),
    // hyperframes downloads chrome-headless-shell via @puppeteer/browsers and
    // honours PUPPETEER_CACHE_DIR — keep it app-managed, not in ~/.cache.
    browserCacheDir: path.join(runtimeDir, 'puppeteer'),
  }
}

/** True once a managed Node binary exists on disk. */
function isNodeRuntimeReady() {
  try {
    return fs.existsSync(getNodeRuntimePaths().nodeExe)
  } catch {
    return false
  }
}

/** True once the hyperframes CLI is installed into the managed Node. */
function isHyperframesReady() {
  try {
    return fs.existsSync(getNodeRuntimePaths().hyperframesBin)
  } catch {
    return false
  }
}

module.exports = { getNodeRuntimePaths, isNodeRuntimeReady, isHyperframesReady }
