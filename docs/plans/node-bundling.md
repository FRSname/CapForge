# Plan: Bundle a Node runtime for HyperFrames (R1)

**Goal:** the HyperFrames features (render, snapshot/preview, native + custom caption
styles, Studio) work out of the box, without the user installing Node.js. Today they
require **Node 22+ on PATH** and degrade gracefully when it's absent; classic Pillow
rendering is unaffected.

## The real scope (why this is more than "bundle node")

`hyperframes@0.6.x` (`engines: node >=22`) is invoked as `npx hyperframes …`. Bundling
Node is the easy 10%. The dependency tree is the hard part:

- **Headless browser** — `puppeteer-core` + `@puppeteer/browsers`. HyperFrames captures
  frames from **`chrome-headless-shell`**, which `@puppeteer/browsers` downloads at
  runtime (~100–150 MB). It honours **`PUPPETEER_CACHE_DIR`** / `PUPPETEER_EXECUTABLE_PATH`
  / `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD`. HyperFrames exposes **`hyperframes browser`**,
  **`hyperframes setup`**, and **`hyperframes doctor`** subcommands to manage/verify this.
- **Native modules** — `sharp` (libvips), `onnxruntime-node`, `esbuild`: per-platform,
  per-arch binaries. The installed `hyperframes` package must match the target OS/arch,
  so we can't just copy one dev machine's `node_modules` across platforms.
- **First-run footprint** — adds Node (~50 MB) + hyperframes deps (~100–200 MB) +
  chrome-headless-shell (~150 MB) on top of the existing ~1.6 GB Whisper model download.

**Strategy:** mirror the existing Python pattern — an **app-managed runtime** under
`<userData>/runtime/` provisioned during first-run setup (the same place the Whisper
model already downloads to), driven by the bundled Node and the hyperframes CLI's own
`setup`/`browser` subcommands. Heavy assets are fetched on first run, not shipped in the
installer.

## Env contract (Electron → backend / studio)

| Var | Set by | Consumed by |
|---|---|---|
| `CAPFORGE_NODE_BIN` | `python-manager.js` (when managed node exists) | reserved / diagnostics |
| `CAPFORGE_NPX` | `python-manager.js` | `backend/exporters/node_runtime.find_npx()` |
| `PUPPETEER_CACHE_DIR` | `python-manager.js` + `hyperframes-studio.js` | hyperframes (browser cache) |
| `PATH` (node bin prepended) | both | the `node` the hyperframes CLI spawns |

Managed layout under `<userData>/runtime/`: `node/` (extracted Node), `puppeteer/`
(chrome-headless-shell). Paths computed in `electron/node-runtime.js`; platform leaf
names in `platform/{mac,win}.js` (`nodeExeRelPath`, `npxRelPath`).

## Phases

### Phase 1 — Resolution plumbing ✅ (this change)
Make the app *able* to use a managed Node, with safe fallback. No provisioning yet, so
behaviour in production is unchanged until Phase 2 (the managed exe doesn't exist →
fall back to system `npx`).
- `backend/exporters/node_runtime.py` — `find_npx()` (CAPFORGE_NPX → PATH → None).
- `hyperframes_render.py` / `hyperframes_captions.py` — resolve via `find_npx()`.
- `electron/node-runtime.js` — managed paths + `isNodeRuntimeReady()`.
- `electron/platform/{mac,win}.js` — `nodeExeRelPath` / `npxRelPath`.
- `python-manager.js` + `hyperframes-studio.js` — inject env when managed node exists.
- Tests: `backend/tests/test_node_runtime.py`.

### Phase 2 — Provision the Node runtime
- Bundle/extract a Node 22 build (official tarball/zip) into `<userData>/runtime/node/`,
  mirroring `extractPython()`; add `findBundledNodeArchive()` / `extractNode()` to the
  platform modules. Wire into `ensureRuntime()` and bump `RUNTIME_VERSION`.
- `package.json` `build`: add the Node archive to per-platform `extraResources`.
- Decision: **bundle-in-installer** (bigger download, offline) vs **download-on-first-run**
  (smaller installer, matches the model-download UX). Lean download-on-first-run.

### Phase 3 — Provision hyperframes + browser
- Install the `hyperframes` package into a managed dir with the managed Node (correct
  native binaries), or `npx -y hyperframes` with a managed npm cache.
- Run `hyperframes browser install` (or `hyperframes setup`) with `PUPPETEER_CACHE_DIR`
  pointed at `<userData>/runtime/puppeteer/` during first-run setup.
- Add a `hyperframes doctor` check + a setup-wizard step with progress; surface a clear
  "HyperFrames extras (~Xmb) — install now?" opt-in so users who only need classic
  captions don't pay the download.

## Open questions
- Exact `hyperframes browser` / `setup` flag surface + offline behaviour (verify against
  the pinned version).
- Pin a Node version + checksum; self-heal on partial extract (mirror the Python
  `.state.json` version-bump reinstall).
- macOS notarization/codesigning of the bundled Node + chrome-headless-shell binaries.
- Whether to gate the HyperFrames extras behind an explicit opt-in vs first-run default.
