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

### Phase 2 — Provision the Node runtime ✅ (this change)
**Decision: download-on-first-run** (not bundle-in-installer) — the app already requires
first-run network, it keeps the installer small, and official Node builds are
signed/notarized by the Node project so the downloaded binary runs under Gatekeeper.
- `electron/node-provision.js` — `ensureNodeRuntime()`: idempotent (own `.node-version`
  marker, **no `RUNTIME_VERSION` coupling** so it never forces a model re-download),
  downloads + extracts Node `NODE_VERSION` (pinned `22.20.0`) into `<userData>/runtime/node/`.
- `platform/{mac,win}.js` — `nodeArchiveUrl()` + `extractNode()` (mac: `tar --strip-components=1`;
  win: Expand-Archive to staging → promote inner dir).
- `runtime-setup.js` exports `downloadFile` for reuse.
- `main.js` — runs `ensureNodeRuntime()` in the first-run wizard after `ensureRuntime()`,
  **best-effort** (a failure logs + continues; classic captions/rendering unaffected).
- Verified live on macOS arm64: download → `extractNode` → `bin/node --version` works.
  URL/path logic unit-tested in `electron/node-archive.test.js`.

**Known limitation (→ Phase 3):** only *new* installs provision Node (they run the wizard).
Existing installs keep the system-`npx` fallback until a lazy/opt-in provision is added.

### Phase 3 — Provision hyperframes + browser ◑ (mechanism done; UI remains)
Live CLI findings (v0.6.116): the command is **`hyperframes browser ensure`** (not
`install`) — it uses a **system Chrome if present**, else downloads
`chrome-headless-shell` into `PUPPETEER_CACHE_DIR`; runs non-interactively;
**`doctor --json`** gives `{ok, checks[]}`.

Done:
- `electron/hyperframes-provision.js` — `ensureHyperframesRuntime()`: `npm install -g
  hyperframes@0.6.116` into the managed Node prefix → `browser ensure` (PUPPETEER_CACHE_DIR
  = `<userData>/runtime/puppeteer/`) → `doctor` (best-effort). Idempotent via a
  `.hyperframes-version` marker under the managed Node dir.
- Resolver: `backend/exporters/node_runtime.hyperframes_argv()` prefers the managed CLI
  (`CAPFORGE_HYPERFRAMES_BIN`) over `npx -y hyperframes`; render/snapshot/catalog/add all
  route through it; `python-manager.js` injects the env var when the CLI exists.
- **Opt-in trigger** (not forced into first-run, since it's the heavy ~150–300 MB step):
  IPC `hyperframes:status` / `hyperframes:provision` (+ progress event) and the runtime
  preload `window.subforge.hyperframes`. This single path provisions Node→CLI→browser, so
  it also serves **existing installs** that finished setup before this shipped.

Opt-in UI ✅:
- `HyperFramesPanel.tsx` shows a non-blocking "Install HyperFrames extras" banner (with
  live progress) when the managed CLI isn't provisioned, calling
  `window.subforge.hyperframes.provision()`. It's an *offer*, not a gate — the Studio /
  Render buttons stay enabled so a system-Node user keeps working via the `npx` fallback.
- Typed preload `window.subforge.hyperframes` added to `src/preload/index.ts` (mirrors the
  runtime `electron/preload.js`). Renderer + node typechecks pass.

Remaining:
- **Clean-machine validation**: the `npm install -g` + `chrome-headless-shell` download
  couldn't be fully exercised here (this dev box has system Node + system Chrome, which
  the CLI prefers). Verify end-to-end on a box without either, on both macOS and Windows,
  ideally from a packaged build.

## Open questions
- Exact `hyperframes browser` / `setup` flag surface + offline behaviour (verify against
  the pinned version).
- Pin a Node version + checksum; self-heal on partial extract (mirror the Python
  `.state.json` version-bump reinstall).
- macOS notarization/codesigning of the bundled Node + chrome-headless-shell binaries.
- Whether to gate the HyperFrames extras behind an explicit opt-in vs first-run default.
