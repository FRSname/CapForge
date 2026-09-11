/**
 * Pure-logic tests for python-manager. Run with the built-in node runner:
 *   node --test electron/python-manager.test.js
 * No electron running required — `require('electron')` degrades to a path
 * string outside the Electron runtime, and every helper under test takes
 * its electron-derived values (env, resourcesPath, platform name, …) as
 * injected params, mirroring `preset-io.js` / `path-validate.js`. We only
 * avoid exercising `findFreePort()` (real socket binding) and spawning the
 * actual backend process — those need a live Electron/OS environment.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const {
  PythonBackend,
  PREFERRED_PORT,
  LOG_MAX_BYTES,
  READY_POLL_INITIAL_MS,
  READY_POLL_INTERVAL_MS,
  createReadyGate,
  resolvePythonPath,
  resolveBundledBinDir,
  buildBackendEnv,
  buildUvicornArgs,
  buildStatusUrl,
  rotateLogIfNeeded,
} = require('./python-manager')

// --- buildUvicornArgs / buildStatusUrl --------------------------------------

test('buildUvicornArgs builds the exact uvicorn argv, including --no-access-log', () => {
  const args = buildUvicornArgs(53421)
  assert.deepEqual(args, [
    '-m',
    'uvicorn',
    'backend.main:app',
    '--host',
    '127.0.0.1',
    '--port',
    '53421',
    '--no-access-log',
  ])
})

test('buildUvicornArgs stringifies a numeric port', () => {
  const args = buildUvicornArgs(0)
  assert.equal(args[args.indexOf('--port') + 1], '0')
})

test('buildStatusUrl builds the health-check URL for the chosen port', () => {
  assert.equal(buildStatusUrl(53421), 'http://127.0.0.1:53421/api/status')
  assert.equal(buildStatusUrl(12345), 'http://127.0.0.1:12345/api/status')
})

test('PREFERRED_PORT matches the documented default (53421)', () => {
  assert.equal(PREFERRED_PORT, 53421)
})

// --- buildBackendEnv ----------------------------------------------------------

function fakeExistingFs(existingPaths) {
  const set = new Set(existingPaths)
  return { existsSync: (p) => set.has(p) }
}

function baseArgs(overrides = {}) {
  return {
    baseEnv: { PATH: '/usr/bin', EXISTING_VAR: 'keep-me' },
    binDir: '/app/resources/bin',
    ffmpegExe: '/app/resources/bin/ffmpeg',
    ffprobeExe: '/app/resources/bin/ffprobe',
    fs: fakeExistingFs([]),
    path,
    modelDir: '/userData/models',
    port: 53421,
    localToken: 'deadbeef',
    extraModelDownloadEnv: {},
    node: {
      nodeExe: '/userData/runtime/node/bin/node',
      hyperframesCli: '/userData/runtime/node/lib/hyperframes/dist/cli.js',
      nodeBinDir: '/userData/runtime/node/bin',
      browserCacheDir: '/userData/runtime/puppeteer',
    },
    ...overrides,
  }
}

test('buildBackendEnv does not mutate baseEnv (returns a new object)', () => {
  const baseEnv = { PATH: '/usr/bin', UNTOUCHED: '1' }
  const env = buildBackendEnv(baseArgs({ baseEnv }))
  assert.equal(baseEnv.PATH, '/usr/bin')
  assert.equal(Object.prototype.hasOwnProperty.call(baseEnv, 'CAPFORGE_PORT'), false)
  assert.notEqual(env, baseEnv)
})

test('buildBackendEnv preserves unrelated existing env vars', () => {
  const env = buildBackendEnv(baseArgs())
  assert.equal(env.EXISTING_VAR, 'keep-me')
})

test('buildBackendEnv prepends binDir then the managed Node dir to PATH, in that order', () => {
  const env = buildBackendEnv(baseArgs())
  // Original PATH assembly: env.PATH = binDir + delim + PATH; then later
  // env.PATH = node.nodeBinDir + delim + PATH (so nodeBinDir ends up first).
  const expected = ['/userData/runtime/node/bin', '/app/resources/bin', '/usr/bin'].join(
    path.delimiter
  )
  assert.equal(env.PATH, expected)
})

test('buildBackendEnv sets CAPFORGE_FFMPEG/CAPFORGE_FFPROBE only when the binaries exist', () => {
  const withBinaries = buildBackendEnv(
    baseArgs({
      fs: fakeExistingFs(['/app/resources/bin/ffmpeg', '/app/resources/bin/ffprobe']),
    })
  )
  assert.equal(withBinaries.CAPFORGE_FFMPEG, '/app/resources/bin/ffmpeg')
  assert.equal(withBinaries.CAPFORGE_FFPROBE, '/app/resources/bin/ffprobe')

  const withoutBinaries = buildBackendEnv(baseArgs({ fs: fakeExistingFs([]) }))
  assert.equal('CAPFORGE_FFMPEG' in withoutBinaries, false)
  assert.equal('CAPFORGE_FFPROBE' in withoutBinaries, false)
})

test('buildBackendEnv sets model dir, encoding, port, and local token', () => {
  const env = buildBackendEnv(baseArgs({ port: 9999, localToken: 'abc123' }))
  assert.equal(env.CAPFORGE_MODEL_DIR, '/userData/models')
  assert.equal(env.HF_HOME, '/userData/models')
  assert.equal(env.HUGGINGFACE_HUB_CACHE, '/userData/models')
  assert.equal(env.PYTHONIOENCODING, 'utf-8')
  assert.equal(env.PYTHONUTF8, '1')
  assert.equal(env.CAPFORGE_PORT, '9999')
  assert.equal(env.CAPFORGE_LOCAL_TOKEN, 'abc123')
})

test('buildBackendEnv merges extraModelDownloadEnv (platform-specific HF Hub tweaks)', () => {
  const env = buildBackendEnv(
    baseArgs({ extraModelDownloadEnv: { HF_HUB_DISABLE_SYMLINKS_WARNING: '1' } })
  )
  assert.equal(env.HF_HUB_DISABLE_SYMLINKS_WARNING, '1')
})

test('buildBackendEnv extraModelDownloadEnv can override an earlier-set key (Object.assign semantics)', () => {
  const env = buildBackendEnv(baseArgs({ extraModelDownloadEnv: { PYTHONUTF8: '0' } }))
  assert.equal(env.PYTHONUTF8, '0')
})

test('buildBackendEnv wires the HyperFrames Node runtime paths', () => {
  const env = buildBackendEnv(baseArgs())
  assert.equal(env.CAPFORGE_NODE_BIN, '/userData/runtime/node/bin/node')
  assert.equal(env.CAPFORGE_HYPERFRAMES_CLI, '/userData/runtime/node/lib/hyperframes/dist/cli.js')
  assert.equal(env.PUPPETEER_CACHE_DIR, '/userData/runtime/puppeteer')
})

// --- resolveBundledBinDir -----------------------------------------------------

test('resolveBundledBinDir prefers the packaged resources/bin dir when it exists', () => {
  const dir = resolveBundledBinDir({
    resourcesPath: '/Applications/CapForge.app/Contents/Resources',
    projectRoot: '/project',
    platformName: 'darwin',
    fs: fakeExistingFs(['/Applications/CapForge.app/Contents/Resources/bin']),
    path,
  })
  assert.equal(dir, '/Applications/CapForge.app/Contents/Resources/bin')
})

test('resolveBundledBinDir falls back to the dev dir when resourcesPath has no bin/', () => {
  const dir = resolveBundledBinDir({
    resourcesPath: '/Applications/CapForge.app/Contents/Resources',
    projectRoot: '/project',
    platformName: 'darwin',
    fs: fakeExistingFs([]), // packaged bin/ doesn't exist
    path,
  })
  assert.equal(dir, path.join('/project', 'resources', 'bin-mac'))
})

test('resolveBundledBinDir falls back to the dev dir when resourcesPath is unset (dev mode)', () => {
  const macDir = resolveBundledBinDir({
    resourcesPath: undefined,
    projectRoot: '/project',
    platformName: 'darwin',
    fs: fakeExistingFs([]),
    path,
  })
  assert.equal(macDir, path.join('/project', 'resources', 'bin-mac'))

  const winDir = resolveBundledBinDir({
    resourcesPath: undefined,
    projectRoot: '/project',
    platformName: 'win32',
    fs: fakeExistingFs([]),
    path,
  })
  assert.equal(winDir, path.join('/project', 'resources', 'bin-win'))
})

// --- resolvePythonPath ---------------------------------------------------------

test('resolvePythonPath returns the managed runtime python when the runtime is ready', () => {
  const python = resolvePythonPath({
    runtimeReady: true,
    runtimePythonExe: '/userData/runtime/python/bin/python3',
    projectRoot: '/project',
    devVenvPythonRelPath: path.join('.venv', 'bin', 'python3'),
    platformName: 'darwin',
    fs: fakeExistingFs([]), // irrelevant on this branch
    path,
  })
  assert.equal(python, '/userData/runtime/python/bin/python3')
})

test('resolvePythonPath falls back to the dev venv when the runtime is not ready and the venv exists', () => {
  const venvPython = path.join('/project', '.venv', 'bin', 'python3')
  const python = resolvePythonPath({
    runtimeReady: false,
    runtimePythonExe: undefined,
    projectRoot: '/project',
    devVenvPythonRelPath: path.join('.venv', 'bin', 'python3'),
    platformName: 'darwin',
    fs: fakeExistingFs([venvPython]),
    path,
  })
  assert.equal(python, venvPython)
})

test('resolvePythonPath falls back to system python3/python when neither the runtime nor the venv is ready', () => {
  const mac = resolvePythonPath({
    runtimeReady: false,
    runtimePythonExe: undefined,
    projectRoot: '/project',
    devVenvPythonRelPath: path.join('.venv', 'bin', 'python3'),
    platformName: 'darwin',
    fs: fakeExistingFs([]),
    path,
  })
  assert.equal(mac, 'python3')

  const win = resolvePythonPath({
    runtimeReady: false,
    runtimePythonExe: undefined,
    projectRoot: 'C:\\project',
    devVenvPythonRelPath: path.win32.join('.venv', 'Scripts', 'python.exe'),
    platformName: 'win32',
    fs: fakeExistingFs([]),
    path: path.win32,
  })
  assert.equal(win, 'python')
})

// --- rotateLogIfNeeded (real fs, real temp files — mirrors path-validate.test.js) --

function withTempLogDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capforge-python-manager-'))
  try {
    fn(dir)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

test('rotateLogIfNeeded leaves a small log file alone', () => {
  withTempLogDir((dir) => {
    const logPath = path.join(dir, 'backend.log')
    fs.writeFileSync(logPath, 'small log content')
    rotateLogIfNeeded(logPath)
    assert.equal(fs.existsSync(logPath), true)
    assert.equal(fs.existsSync(logPath + '.1'), false)
    assert.equal(fs.readFileSync(logPath, 'utf-8'), 'small log content')
  })
})

test('rotateLogIfNeeded renames an oversized log to .1', () => {
  withTempLogDir((dir) => {
    const logPath = path.join(dir, 'backend.log')
    fs.writeFileSync(logPath, Buffer.alloc(LOG_MAX_BYTES, 'x'))
    rotateLogIfNeeded(logPath)
    assert.equal(fs.existsSync(logPath), false)
    assert.equal(fs.existsSync(logPath + '.1'), true)
    assert.equal(fs.statSync(logPath + '.1').size, LOG_MAX_BYTES)
  })
})

test('rotateLogIfNeeded overwrites a pre-existing .1 file rather than appending', () => {
  withTempLogDir((dir) => {
    const logPath = path.join(dir, 'backend.log')
    fs.writeFileSync(logPath + '.1', 'stale rotated content')
    fs.writeFileSync(logPath, Buffer.alloc(LOG_MAX_BYTES, 'y'))
    rotateLogIfNeeded(logPath)
    const rotatedContent = fs.readFileSync(logPath + '.1')
    assert.equal(rotatedContent.length, LOG_MAX_BYTES)
    assert.equal(rotatedContent.includes('stale rotated content'), false)
  })
})

test('rotateLogIfNeeded is a no-op (does not throw) when the log file does not exist yet', () => {
  withTempLogDir((dir) => {
    const logPath = path.join(dir, 'does-not-exist.log')
    assert.doesNotThrow(() => rotateLogIfNeeded(logPath))
    assert.equal(fs.existsSync(logPath), false)
  })
})

// --- createReadyGate ----------------------------------------------------------

test('createReadyGate exposes a promise that stays pending until settled', async () => {
  const gate = createReadyGate()
  const marker = Symbol('pending')
  const winner = await Promise.race([gate.promise, Promise.resolve(marker)])
  assert.equal(winner, marker)
})

test('createReadyGate resolves its promise with the settled value', async () => {
  const gate = createReadyGate()
  gate.resolve('ready')
  assert.equal(await gate.promise, 'ready')
})

test('createReadyGate rejects its promise with the given error', async () => {
  const gate = createReadyGate()
  gate.reject(new Error('backend did not start'))
  await assert.rejects(() => gate.promise, /backend did not start/)
})

test('createReadyGate settles once — a later reject cannot un-resolve it', async () => {
  const gate = createReadyGate()
  gate.resolve('ready')
  gate.reject(new Error('too late'))
  gate.resolve('also too late')
  assert.equal(await gate.promise, 'ready')
})

test('createReadyGate settles once — a later resolve cannot clear a rejection', async () => {
  const gate = createReadyGate()
  gate.reject(new Error('spawn failed'))
  gate.resolve('too late')
  await assert.rejects(() => gate.promise, /spawn failed/)
})

test('createReadyGate rejection is safe to observe long after it happened', async () => {
  // The gate is rejected while nothing awaits it (backend dies during window
  // load); the internal no-op catch keeps Node quiet, but the error must still
  // reach a later awaiter.
  const gate = createReadyGate()
  gate.reject(new Error('late observer'))
  await new Promise((r) => setTimeout(r, 10))
  await assert.rejects(() => gate.promise, /late observer/)
})

// --- readiness poll schedule --------------------------------------------------

test('the readiness poll schedule is 100ms initial + 100ms steps', () => {
  // Pinned: the window is created before the backend answers, and the
  // port/token IPCs wait on this poll, so a coarse schedule shows up directly
  // as startup latency.
  assert.equal(READY_POLL_INITIAL_MS, 100)
  assert.equal(READY_POLL_INTERVAL_MS, 100)
})

// --- PythonBackend readiness gate ---------------------------------------------

test('a freshly constructed PythonBackend exposes a pending whenReady() promise', async () => {
  // No start() call here — constructing the object must not spawn anything, and
  // the gate must already be awaitable so main.js can register the port/token
  // IPC handlers before the backend exists.
  const backend = new PythonBackend()
  const ready = backend.whenReady()
  assert.equal(typeof ready.then, 'function')
  const marker = Symbol('pending')
  assert.equal(await Promise.race([ready, Promise.resolve(marker)]), marker)
})

test('whenReady() returns the same promise on every call', () => {
  const backend = new PythonBackend()
  assert.equal(backend.whenReady(), backend.whenReady())
})

test('a constructed PythonBackend starts on PREFERRED_PORT with a fresh local token', () => {
  const backend = new PythonBackend()
  assert.equal(backend.port, PREFERRED_PORT)
  assert.match(backend.localToken, /^[0-9a-f]{64}$/)
  assert.notEqual(new PythonBackend().localToken, backend.localToken)
})
