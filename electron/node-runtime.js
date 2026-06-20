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
  const globalNodeModules = path.join(nodeDir, platform.globalNodeModulesRelPath)
  return {
    nodeDir,
    nodeExe: path.join(nodeDir, platform.nodeExeRelPath),
    // JS entrypoints we invoke with `node <entry.js>` — never the .cmd shims,
    // which Node 22 / Python subprocess can't spawn without a shell on Windows.
    npmCli: path.join(globalNodeModules, 'npm', 'bin', 'npm-cli.js'),
    hyperframesCli: path.join(globalNodeModules, 'hyperframes', 'dist', 'cli.js'),
    // Dir to prepend to PATH so the `node` the CLI may sub-spawn resolves.
    // macOS: <nodeDir>/bin; Windows: <nodeDir> (exe at root).
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

/** True once the hyperframes CLI (its JS entrypoint) is installed in the managed Node. */
function isHyperframesReady() {
  try {
    return fs.existsSync(getNodeRuntimePaths().hyperframesCli)
  } catch {
    return false
  }
}

module.exports = { getNodeRuntimePaths, isNodeRuntimeReady, isHyperframesReady }
