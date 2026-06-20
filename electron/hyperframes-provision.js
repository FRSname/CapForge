/**
 * Provision the HyperFrames CLI + its render browser into the app-managed Node.
 *
 * This is the piece that makes HyperFrames work out of the box (R1). With the
 * managed Node 22 in place (see node-provision.js), it:
 *   1. `npm install -g hyperframes@<pinned>` into the managed Node prefix, so the
 *      package + its native deps (sharp, onnxruntime-node, esbuild, puppeteer-core)
 *      land app-locally with binaries matching the bundled Node.
 *   2. `hyperframes browser ensure` with PUPPETEER_CACHE_DIR pointed at the managed
 *      cache — the CLI uses a system Chrome if present, else downloads
 *      chrome-headless-shell (~150 MB) into our cache.
 *   3. `hyperframes doctor --json` as a best-effort readiness check (logged only).
 *
 * Tracked with its own `.hyperframes-version` marker under the managed Node dir
 * (so a Node re-provision, which clears that dir, correctly forces a reinstall).
 * Idempotent: a matching marker short-circuits.
 *
 * This is the heavy step (~150–300 MB). It runs best-effort in the first-run
 * wizard; failure leaves HyperFrames in the "needs Node" degraded state while
 * classic captions/rendering keep working.
 */

const path = require('path')
const fs = require('fs')

const { runCommand } = require('./runtime-setup')
const { getNodeRuntimePaths, isNodeRuntimeReady, isHyperframesReady } = require('./node-runtime')

// Pinned HyperFrames version. Bump to upgrade.
const HYPERFRAMES_VERSION = '0.6.116'

function versionMarkerPath() {
  return path.join(getNodeRuntimePaths().nodeDir, '.hyperframes-version')
}

function provisionedVersion() {
  try {
    return fs.readFileSync(versionMarkerPath(), 'utf-8').trim()
  } catch {
    return null
  }
}

/** True when the pinned HyperFrames CLI is already installed in the managed Node. */
function isHyperframesCurrent() {
  return isHyperframesReady() && provisionedVersion() === HYPERFRAMES_VERSION
}

/** Env that points child tools at the managed Node + browser cache. */
function managedEnv() {
  const { nodeBinDir, browserCacheDir, nodeDir } = getNodeRuntimePaths()
  return {
    ...process.env,
    PATH: nodeBinDir + path.delimiter + (process.env.PATH || ''),
    PUPPETEER_CACHE_DIR: browserCacheDir,
    // Be explicit about the global prefix so `npm install -g` lands in the
    // managed Node, never the user's system npm prefix.
    npm_config_prefix: nodeDir,
  }
}

/**
 * Ensure the HyperFrames CLI + render browser are installed in the managed Node.
 * Idempotent. Requires the managed Node runtime (call ensureNodeRuntime first).
 *
 * @param {{ onProgress?: (p: { stage: string, message: string }) => void }} opts
 */
async function ensureHyperframesRuntime({ onProgress } = {}) {
  const report = (p) => onProgress && onProgress(p)
  const { nodeExe, npmCli, hyperframesCli, browserCacheDir } = getNodeRuntimePaths()

  if (isHyperframesCurrent()) {
    return { hyperframesCli, alreadyReady: true }
  }
  if (!isNodeRuntimeReady()) {
    throw new Error('Managed Node runtime is not ready — provision Node before HyperFrames.')
  }

  const env = managedEnv()

  // Invoke `node <npm-cli.js>` rather than the npm.cmd shim — Node 22 won't spawn
  // a .cmd without a shell on Windows, and this is identical on macOS.
  report({ stage: 'hyperframes', message: `Installing HyperFrames ${HYPERFRAMES_VERSION}…` })
  await runCommand(
    nodeExe,
    [npmCli, 'install', '-g', `hyperframes@${HYPERFRAMES_VERSION}`, '--no-fund', '--no-audit'],
    { env, onLine: (line) => report({ stage: 'hyperframes', message: line }) }
  )
  if (!isHyperframesReady()) {
    throw new Error('HyperFrames install did not produce a CLI entrypoint.')
  }

  fs.mkdirSync(browserCacheDir, { recursive: true })
  report({ stage: 'hyperframes', message: 'Preparing the HyperFrames render browser…' })
  await runCommand(nodeExe, [hyperframesCli, 'browser', 'ensure'], {
    env,
    onLine: (line) => report({ stage: 'hyperframes', message: line }),
  })

  // Best-effort sanity check; never gate provisioning on it.
  await runCommand(nodeExe, [hyperframesCli, 'doctor'], {
    env,
    onLine: (line) => report({ stage: 'hyperframes', message: line }),
  }).catch(() => {})

  fs.writeFileSync(versionMarkerPath(), HYPERFRAMES_VERSION, 'utf-8')
  report({ stage: 'hyperframes', message: 'HyperFrames ready.' })
  return { hyperframesCli, alreadyReady: false }
}

module.exports = { ensureHyperframesRuntime, isHyperframesCurrent, HYPERFRAMES_VERSION }
