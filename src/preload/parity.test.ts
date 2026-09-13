/**
 * Dual-preload parity.
 *
 * `electron/preload.js` (vanilla CJS) is the preload Electron actually loads;
 * `src/preload/index.ts` is a types mirror that electron-vite compiles to
 * `out/preload/` where nothing loads it. An API added to only one of them
 * either type-checks and does nothing at runtime, or works at runtime with no
 * renderer types. These tests fail when the two surfaces drift.
 *
 * Both files call `contextBridge.exposeInMainWorld('subforge', {...})` at import
 * time, so "loading" a preload under a mocked `electron` is enough to capture
 * its API object.
 */

import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, test, vi } from 'vitest'

/** Sentinel returned by the mocked `webUtils.getPathForFile` (it uses no IPC channel). */
const WEB_UTILS_MARKER = '<webUtils.getPathForFile>'

/** Recorded value for a leaf that neither invoked IPC nor returned a string. */
const NO_CHANNEL = '<no-ipc-channel>'

/**
 * One mock `electron` module shared by both loaders: it records every
 * `exposeInMainWorld` payload and every IPC channel touched.
 */
const mocked = vi.hoisted(() => {
  const exposed: Record<string, unknown> = {}
  const channels: string[] = []

  const electron = {
    contextBridge: {
      exposeInMainWorld(name: string, api: unknown) {
        exposed[name] = api
      },
    },
    ipcRenderer: {
      invoke(channel: string, ..._args: unknown[]) {
        channels.push(channel)
        return Promise.resolve(null)
      },
      on(channel: string, _listener: unknown) {
        channels.push(channel)
      },
      removeListener(channel: string, _listener: unknown) {
        channels.push(channel)
      },
    },
    webUtils: {
      getPathForFile(_file: unknown) {
        return '<webUtils.getPathForFile>'
      },
    },
  }

  return {
    electron,
    exposed,
    channels,
    reset() {
      for (const key of Object.keys(exposed)) delete exposed[key]
      channels.length = 0
    },
  }
})

vi.mock('electron', () => mocked.electron)

type PreloadApi = Record<string, unknown>

function takeExposedApi(source: string): PreloadApi {
  const api = mocked.exposed.subforge
  if (!api || typeof api !== 'object') {
    throw new Error(`${source} did not expose a 'subforge' object on the context bridge`)
  }
  return api as PreloadApi
}

/** Load the TypeScript types-mirror preload (ESM, `vi.mock`-able). */
async function loadTsPreload(): Promise<PreloadApi> {
  mocked.reset()
  await import('./index')
  return takeExposedApi('src/preload/index.ts')
}

/**
 * Load the runtime CJS preload. `vi.mock` does not reach a native
 * `require('electron')` inside a CJS file, so the mock is injected straight
 * into `require.cache` under electron's resolved path instead.
 */
function loadCjsPreload(): PreloadApi {
  const requireCjs = createRequire(import.meta.url)
  const electronPath = requireCjs.resolve('electron')
  requireCjs.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: mocked.electron,
  } as unknown as NodeModule

  const preloadPath = fileURLToPath(new URL('../../electron/preload.js', import.meta.url))
  delete requireCjs.cache[requireCjs.resolve(preloadPath)]

  mocked.reset()
  requireCjs(preloadPath)
  return takeExposedApi('electron/preload.js')
}

/** Dummy arguments per dotted path; everything else gets harmless strings. */
const DUMMY_ARGS: Record<string, unknown[]> = {
  getPathForFile: [{}],
  'hyperframes.onProvisionProgress': [() => {}],
}
const DEFAULT_ARGS: unknown[] = ['dummy-arg-1', 'dummy-arg-2']

type Leaf = 'function' | 'object' | 'other'

function shapeOf(value: unknown): Leaf {
  if (typeof value === 'function') return 'function'
  if (value !== null && typeof value === 'object') return 'object'
  return 'other'
}

/** Key sets by namespace: `''` is the top level, `'claude'` a nested namespace. */
function keySetsOf(api: PreloadApi): Record<string, string[]> {
  const sets: Record<string, string[]> = { '': Object.keys(api).sort() }
  for (const [key, value] of Object.entries(api)) {
    if (shapeOf(value) === 'object') {
      sets[key] = Object.keys(value as PreloadApi).sort()
    }
  }
  return sets
}

/** `{ 'hyperframes.provision': 'function', ... }` for every key, nested included. */
function shapesOf(api: PreloadApi): Record<string, Leaf> {
  const shapes: Record<string, Leaf> = {}
  for (const [key, value] of Object.entries(api)) {
    shapes[key] = shapeOf(value)
    if (shapeOf(value) === 'object') {
      for (const [nested, nestedValue] of Object.entries(value as PreloadApi)) {
        shapes[`${key}.${nested}`] = shapeOf(nestedValue)
      }
    }
  }
  return shapes
}

/** Call every leaf function and record the IPC channel it reached. */
function channelsOf(api: PreloadApi): Record<string, string> {
  const map: Record<string, string> = {}

  const visit = (value: unknown, path: string) => {
    if (shapeOf(value) === 'object') {
      for (const [key, nested] of Object.entries(value as PreloadApi)) {
        visit(nested, path ? `${path}.${key}` : key)
      }
      return
    }
    if (typeof value !== 'function') return

    mocked.channels.length = 0
    const args = DUMMY_ARGS[path] ?? DEFAULT_ARGS
    const result = (value as (...a: unknown[]) => unknown)(...args)
    if (mocked.channels.length > 0) {
      map[path] = mocked.channels[0]
    } else {
      map[path] = typeof result === 'string' ? result : NO_CHANNEL
    }
  }

  visit(api, '')
  return map
}

function diffMessage(label: string, js: string[], ts: string[]): string {
  const missingInJs = ts.filter((k) => !js.includes(k))
  const missingInTs = js.filter((k) => !ts.includes(k))
  return [
    `Preload drift in ${label}:`,
    missingInJs.length
      ? `  missing from electron/preload.js (runtime): ${missingInJs.join(', ')}`
      : null,
    missingInTs.length
      ? `  missing from src/preload/index.ts (types): ${missingInTs.join(', ')}`
      : null,
  ]
    .filter(Boolean)
    .join('\n')
}

describe('preload parity: electron/preload.js vs src/preload/index.ts', () => {
  let jsApi: PreloadApi
  let tsApi: PreloadApi

  beforeAll(async () => {
    tsApi = await loadTsPreload()
    jsApi = loadCjsPreload()
  })

  test('exposes the same key set at every level', () => {
    const jsSets = keySetsOf(jsApi)
    const tsSets = keySetsOf(tsApi)

    const namespaces = Array.from(new Set([...Object.keys(jsSets), ...Object.keys(tsSets)])).sort()
    for (const ns of namespaces) {
      const label = ns === '' ? 'window.subforge' : `window.subforge.${ns}`
      const js = jsSets[ns] ?? []
      const ts = tsSets[ns] ?? []
      expect(js, diffMessage(label, js, ts)).toEqual(ts)
    }
  })

  test('every key has the same shape (function vs namespace object)', () => {
    expect(shapesOf(jsApi)).toEqual(shapesOf(tsApi))
  })

  test('every function reaches the same IPC channel', () => {
    const jsChannels = channelsOf(jsApi)
    const tsChannels = channelsOf(tsApi)

    // getPathForFile is the one leaf that is not IPC-backed.
    expect(jsChannels.getPathForFile).toBe(WEB_UTILS_MARKER)
    expect(jsChannels).toEqual(tsChannels)
  })
})
