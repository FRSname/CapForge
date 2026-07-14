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
  PREFERRED_PORT,
  LOG_MAX_BYTES,
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
