/**
 * Manages the HyperFrames "studio" preview server (`npx hyperframes preview`)
 * as a child process — the local webapp where the user visually inspects the
 * generated composition (captions + placed effects).
 *
 * Kept in Electron main (NOT the Python backend) so the server is tied to the
 * app lifecycle and gets killed on quit instead of being orphaned — mirrors how
 * python-manager.js owns the backend process.
 *
 * CLI surface (verified against hyperframes v0.6.114):
 *   hyperframes preview [DIR] --no-open --port <port>
 *   - --no-open: Electron owns the browser-open (shell.openExternal) so the
 *     studio always lands on one consistent surface.
 *   - --port <port>: we pass a free port so the URL is deterministic and we can
 *     poll it for readiness, the same way python-manager waits on the backend.
 */

const path = require('path')
const { spawn } = require('child_process')
const http = require('http')
const net = require('net')

const { getNodeRuntimePaths, isNodeRuntimeReady, isHyperframesReady } = require('./node-runtime')

// HyperFrames' own default preview port. The free-port lookup below falls back
// to an OS-assigned port if it's busy (another studio, unrelated dev server).
const PREFERRED_STUDIO_PORT = 3002

// Studio startup involves an npx resolve + a dev-server boot; give it room.
const READY_TIMEOUT_MS = 60_000

/**
 * Resolve a free TCP port, preferring `preferred`. Copied from the free-port
 * helper in python-manager.js so the studio doesn't collide with whatever is
 * already on 3002.
 */
function findFreePort(preferred) {
  return new Promise((resolve) => {
    const tryListen = (port, onFail) => {
      const srv = net.createServer()
      srv.unref()
      srv.once('error', () => {
        try {
          srv.close()
        } catch {}
        onFail()
      })
      srv.listen(port, '127.0.0.1', () => {
        const got = srv.address().port
        srv.close(() => resolve(got))
      })
    }
    tryListen(preferred, () => tryListen(0, () => resolve(preferred)))
  })
}

/**
 * Resolve the command + args to launch the studio preview server.
 * Prefer the app-managed CLI run as `node <cli.js>` (works without a system Node
 * and avoids the npx.cmd shim Windows can't spawn). Fall back to `npx -y
 * hyperframes` (dev / system Node; `npx.cmd` on Windows).
 */
function resolveStudioCommand(projectDir, port) {
  const previewArgs = ['preview', '--no-open', '--port', String(port), projectDir]
  if (isHyperframesReady()) {
    const { nodeExe, hyperframesCli } = getNodeRuntimePaths()
    return { cmd: nodeExe, args: [hyperframesCli, ...previewArgs] }
  }
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  return { cmd: npx, args: ['-y', 'hyperframes', ...previewArgs] }
}

/**
 * Spawn env for the studio: when a managed Node exists, put its bin dir on PATH
 * (the CLI spawns `node`) and point the headless browser at the app-managed
 * cache. Otherwise inherit the parent env unchanged.
 */
function studioEnv() {
  const env = { ...process.env }
  if (isNodeRuntimeReady()) {
    const node = getNodeRuntimePaths()
    env.PATH = node.nodeBinDir + path.delimiter + (env.PATH || '')
    env.PUPPETEER_CACHE_DIR = node.browserCacheDir
  }
  return env
}

class HyperframesStudio {
  constructor() {
    this.process = null
    this.port = null
    this.projectDir = null
  }

  /**
   * Start (or restart) the preview server for `projectDir`. Resolves with
   * `{ url }` once the server is listening. There is only ever one studio: any
   * prior server is killed first so the studio always reflects the latest
   * generated project.
   */
  async open(projectDir) {
    this.stop()
    const port = await findFreePort(PREFERRED_STUDIO_PORT)

    return new Promise((resolve, reject) => {
      const { cmd, args } = resolveStudioCommand(projectDir, port)
      console.log(`[CapForge] Starting HyperFrames Studio: ${cmd} ${args.join(' ')}`)

      let proc
      try {
        proc = spawn(cmd, args, { cwd: projectDir, windowsHide: true, env: studioEnv() })
      } catch (err) {
        reject(new Error(`Failed to launch HyperFrames Studio: ${err.message}`))
        return
      }

      this.process = proc
      this.port = port
      this.projectDir = projectDir

      const output = []
      const capture = (d) => {
        const text = d.toString()
        output.push(text)
        const trimmed = text.trim()
        if (trimmed) console.log(`[studio] ${trimmed}`)
      }
      if (proc.stdout) proc.stdout.on('data', capture)
      if (proc.stderr) proc.stderr.on('data', capture)

      proc.on('error', (err) => {
        // ENOENT = npx / Node not installed. Same gate as hyperframes_render.py.
        const msg =
          err.code === 'ENOENT'
            ? 'Node.js 22+ (npx) was not found. Install Node to use the HyperFrames Studio.'
            : `Failed to launch HyperFrames Studio: ${err.message}`
        if (this.process === proc) this._clear()
        reject(new Error(msg))
      })

      proc.on('exit', (code) => {
        console.log(`[CapForge] HyperFrames Studio exited with code ${code}`)
        if (this.process === proc) this._clear()
      })

      this._waitForReady(proc, port, resolve, reject, output, READY_TIMEOUT_MS)
    })
  }

  /**
   * Stop the preview server (idempotent). Uses tree-kill because `npx` spawns
   * the actual dev server as a grandchild — a plain SIGTERM to the npx process
   * would orphan the server (same reason platform/win.js tree-kills the
   * backend). tree-kill is an existing dependency.
   */
  stop() {
    if (this.process && this.process.pid) {
      try {
        require('tree-kill')(this.process.pid)
      } catch {
        try {
          this.process.kill()
        } catch {}
      }
    }
    this._clear()
  }

  _clear() {
    this.process = null
    this.port = null
    this.projectDir = null
  }

  /** Poll the chosen port until the dev server answers, then resolve its URL. */
  _waitForReady(proc, port, resolve, reject, output, timeoutMs) {
    const start = Date.now()
    const tail = () => output.join('').slice(-1200)
    const check = () => {
      if (proc.exitCode !== null) {
        reject(new Error('HyperFrames Studio exited before it was ready.\n' + tail()))
        return
      }
      if (Date.now() - start > timeoutMs) {
        this.stop()
        reject(new Error('HyperFrames Studio did not start in time.\n' + tail()))
        return
      }
      const req = http.get({ host: '127.0.0.1', port, path: '/' }, (res) => {
        res.resume()
        resolve({ url: `http://localhost:${port}` })
      })
      req.on('error', () => setTimeout(check, 500))
    }
    setTimeout(check, 800)
  }
}

module.exports = { HyperframesStudio }
