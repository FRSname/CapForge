/**
 * Provision the app-managed Node.js runtime used by the HyperFrames CLI.
 *
 * Mirrors the Python pattern in runtime-setup.js, but Node is *downloaded on
 * first run* (like the Whisper model) rather than shipped in the installer —
 * the app already requires first-run network, and this keeps the installer
 * small. Official Node builds are signed/notarized by the Node project, so the
 * downloaded binary executes under macOS Gatekeeper without re-signing.
 *
 * Tracked independently of the Python runtime (its own `.node-version` marker,
 * no RUNTIME_VERSION coupling) so adding/upgrading Node never forces an existing
 * user to re-download the ~1.6 GB model. Idempotent: a matching marker short-
 * circuits.
 *
 * The heavier pieces (the hyperframes package + chrome-headless-shell browser)
 * are Phase 3 — see docs/plans/node-bundling.md.
 */

const path = require('path')
const fs = require('fs')

const { downloadFile } = require('./runtime-setup')
const { getNodeRuntimePaths, isNodeRuntimeReady } = require('./node-runtime')
const platform = require('./platform')

// Pinned Node version. Bump to upgrade — the version marker mismatch triggers a
// clean re-provision on next launch.
const NODE_VERSION = '22.20.0'

function versionMarkerPath() {
  return path.join(getNodeRuntimePaths().nodeDir, '.node-version')
}

function provisionedVersion() {
  try {
    return fs.readFileSync(versionMarkerPath(), 'utf-8').trim()
  } catch {
    return null
  }
}

/** True when a managed Node of the pinned version is already installed. */
function isNodeRuntimeCurrent() {
  return isNodeRuntimeReady() && provisionedVersion() === NODE_VERSION
}

/**
 * Ensure the managed Node runtime exists. Idempotent — returns early when the
 * pinned version is already installed. Downloads + extracts otherwise.
 *
 * @param {{ onProgress?: (p: { stage: string, message: string }) => void }} opts
 */
async function ensureNodeRuntime({ onProgress } = {}) {
  const report = (p) => onProgress && onProgress(p)
  const { nodeDir, nodeExe } = getNodeRuntimePaths()

  if (isNodeRuntimeCurrent()) {
    return { nodeExe, alreadyReady: true }
  }

  // Fresh (or version bump): clear any stale/partial install first.
  fs.rmSync(nodeDir, { recursive: true, force: true })
  fs.mkdirSync(nodeDir, { recursive: true })

  const url = platform.nodeArchiveUrl(NODE_VERSION)
  const archivePath = path.join(path.dirname(nodeDir), path.basename(url))

  report({ stage: 'node', message: `Downloading Node ${NODE_VERSION} for HyperFrames…` })
  await downloadFile(url, archivePath, {
    onProgress: (rx, total) => {
      if (total) {
        report({ stage: 'node', message: `Downloading Node (${Math.round((rx / total) * 100)}%)` })
      }
    },
  })

  report({ stage: 'node', message: 'Extracting Node runtime…' })
  await platform.extractNode(archivePath, nodeDir)
  try {
    fs.unlinkSync(archivePath)
  } catch {
    /* best effort */
  }

  if (!isNodeRuntimeReady()) {
    throw new Error('Node runtime extraction did not produce a node executable.')
  }
  fs.writeFileSync(versionMarkerPath(), NODE_VERSION, 'utf-8')
  report({ stage: 'node', message: 'Node runtime ready.' })
  return { nodeExe, alreadyReady: false }
}

module.exports = { ensureNodeRuntime, isNodeRuntimeCurrent, NODE_VERSION }
