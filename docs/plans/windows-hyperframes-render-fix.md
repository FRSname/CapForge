# Plan: Fix Windows HyperFrames Render Failure

**Symptom (Windows live test):** HyperFrames Studio opens and is usable with Claude, but
clicking **Render** fails. Two error strings observed:

1. Toast (earlier): `Export failed` / `Server error (503). Check the terminal for details.`
2. Backend (authoritative, captured in terminal):
   `HyperFrames render failed — Node.js was not found. HyperFrames rendering needs Node.js 22+.
   Install Node, or use the file-only HyperFrames export.`

**Status:** Diagnosis complete with high confidence. This plan is diagnosis-first (Phase 1
confirms which root cause on the actual Windows box) then fixes the staleness bug that
explains "studio works, render doesn't."

---

## Background & Definitive Diagnosis

### How the render path resolves Node (the failing path)
`backend/exporters/hyperframes_render.py:35-43` → `backend/exporters/node_runtime.py:28-46`:

```
hyperframes_argv():
  1. managed:  if CAPFORGE_NODE_BIN and CAPFORGE_HYPERFRAMES_CLI both set AND both files exist
                 → [node, cli.js]
  2. fallback: npx = find_npx()  (CAPFORGE_NPX, else shutil.which("npx"))
                 → [npx, "-y", "hyperframes"]
  3. else      → None  → render raises "Node.js was not found." (HyperframesRenderError)
```

The user's error == branch 3 returned `None`. Therefore, **at the moment the backend was
running, it had NO `CAPFORGE_NODE_BIN`/`CAPFORGE_HYPERFRAMES_CLI` in its env AND no `npx` on
its PATH.**

### Why the env is empty: it's frozen at backend spawn
`electron/python-manager.js:175-184` injects the managed-Node env **only if
`isNodeRuntimeReady()` is true at spawn time**, and the backend is spawned **once** at app
launch (`electron/main.js:362`, `pythonBackend.start()`).

But the managed Node / HyperFrames CLI / browser are provisioned **later or separately**:
- First-run setup provisions **Node only** — `electron/main.js:316` calls `ensureNodeRuntime`
  but **NOT** `ensureHyperframesRuntime`. It is also **best-effort**: failure is swallowed at
  `electron/main.js:319` (`console.warn`), so a failed download silently leaves the app in the
  "needs Node" state.
- The HyperFrames CLI + chrome-headless-shell browser are installed by the **opt-in** IPC
  `hyperframes:provision` (`electron/main.js:451-457`), which runs `ensureNodeRuntime` +
  `ensureHyperframesRuntime` — typically **after** the backend already started.

**Result:** any Node/CLI/browser provisioned after backend spawn is invisible to the backend
until it is restarted. `hyperframes_argv()` keeps returning `None`.

### Why the studio works but render doesn't
The studio is spawned by Electron and re-checks readiness **live** every launch
(`electron/hyperframes-studio.js`, `isHyperframesReady()` / falls back to `npx.cmd`, which
Electron *can* spawn). The Python backend cannot — its env was captured at startup, and Python
`subprocess` (no shell) cannot run `npx.cmd` anyway. This asymmetry is the whole bug.
(Corroborated by prior findings: studio falls back to `npx.cmd`; the backend cannot.)

### Root-cause candidates (Phase 1 confirms which)
- **RC-1 (most likely): stale backend env.** Node/CLI provisioned (first-run or on-demand)
  *after* the backend spawned → backend never received the env → needs restart or live
  resolution. Explains "studio works, render fails."
- **RC-2: provisioning never succeeded.** `ensureNodeRuntime` download/extract failed silently
  (best-effort catch) → `node.exe` missing entirely.
- **RC-3: stale Windows build.** The packaged build predates PR #7 (node-bundling, merged to
  main `5c44915`) → no provisioning code at all + no system Node.
- **RC-4: MSIX/userData virtualization.** `app.getPath('userData')` resolves to a virtualized
  location under Store/MSIX; files written by provisioning aren't where `isNodeRuntimeReady()`
  or the backend look.
- **RC-5 (the NEXT failure, not the current one): browser missing.** Even once Node+CLI
  resolve, render needs chrome-headless-shell. First-run never installs it; only the on-demand
  path does. This will surface as a *non-zero render exit code* (not "Node not found") after
  Phase 2 lands — pre-empted in Phase 3.

### Note on the "503"
`Server error (503). Check the terminal for details.` is **not** a CapForge string (absent from
both worktrees and all git history; it originates from HyperFrames CLI output relayed by the
backend). The CapForge backend maps `HyperframesRenderError` → HTTP **400**
(`backend/main.py`, the `/api/export-hyperframes` handler), surfaced by
`src/renderer/src/lib/api.ts:181-195`. The authoritative, reproducible error is
"Node.js was not found"; the 503 was a transient/earlier observation. Phase 1 records the exact
status to confirm, but the fix targets Node resolution regardless.

---

## Phase 0 — Documentation Discovery / Allowed APIs (already gathered)

**Read these before touching code (exact, current-as-of-`main`@`5c44915`):**

| Concern | File:lines | What it guarantees |
|---|---|---|
| Render Node resolution | `backend/exporters/node_runtime.py:16-46` | `find_npx()`, `hyperframes_argv()` contract (env-first, PATH-second, `None`-last) |
| "Node not found" raise | `backend/exporters/hyperframes_render.py:35-43` | the exact failing branch + message text |
| Render subprocess | `backend/exporters/hyperframes_render.py:88-128` | `subprocess.Popen` (shell=False), pipes stderr→stdout, exit-code handling |
| Backend env injection | `electron/python-manager.js:152-184` | env frozen at spawn; managed vars gated on `isNodeRuntimeReady()` / `isHyperframesReady()` |
| Managed paths + readiness | `electron/node-runtime.js:25-63` | path layout under `<userData>/runtime/`; `isNodeRuntimeReady`/`isHyperframesReady` are `fs.existsSync` checks |
| Node provisioning | `electron/node-provision.js:53-93` | `ensureNodeRuntime` download/extract; `.node-version` marker; pinned `22.20.0` |
| HyperFrames provisioning | `electron/hyperframes-provision.js:68-111` | `ensureHyperframesRuntime` = npm install + `browser ensure` + `doctor`; pinned `0.6.116`; `.hyperframes-version` marker |
| App startup ordering | `electron/main.js:304-362` | first-run provisions **Node only** (best-effort), then `pythonBackend.start()` |
| On-demand provisioning IPC | `electron/main.js:442-457` | `hyperframes:provision` runs Node + HyperFrames provisioning post-startup |
| Error → HTTP → toast | `backend/main.py` `/api/export-hyperframes`; `src/renderer/src/lib/api.ts:181-211`; `src/renderer/src/hooks/useRender.ts:118,131-139` | `HyperframesRenderError`→400→`{title,hint}`→toast |

**Anti-patterns to avoid (these APIs/behaviours do NOT exist / must not be assumed):**
- ❌ The backend re-reads env after spawn — it does **not**. Env is captured once.
- ❌ Python `subprocess` can run `npx.cmd` without `shell=True` on Windows — it **cannot**.
- ❌ First-run installs the HyperFrames CLI/browser — it installs **Node only**.
- ❌ Provisioning failures surface to the user — they're swallowed (`console.warn`).
- ❌ There is a `/api/hyperframes/status` endpoint — none exists yet (Phase 2 adds one).

---

## Phase 1 — Diagnose on the Windows machine (no code changes)

**Goal:** Identify which RC is in play. Run these on the failing Windows box and record outputs.

### 1a. Confirm the build is current
- In the running app, check the version / commit. Compare against `main`@`5c44915` (v2.0.0).
- If older than PR #7 merge → **RC-3**; fix = rebuild/repackage from current `main` first, then
  re-test before doing anything else.

### 1b. Inspect the managed runtime on disk
Check `%APPDATA%\CapForge\runtime\` (the `userData` path from `node-runtime.js:26`):
- `node\node.exe` present? → `isNodeRuntimeReady()` would be true.
- `node\.node-version` == `22.20.0`?
- `node\node_modules\hyperframes\dist\cli.js` present? → `isHyperframesReady()` true.
- `node\.hyperframes-version` == `0.6.116`?
- `puppeteer\` contains a chrome-headless-shell build?

Decision:
- `node.exe` missing → **RC-2** (or RC-3). Look for the swallowed warning from `main.js:319` in
  the Electron console / log.
- `node.exe` present but `cli.js` missing → CLI never installed (first-run only did Node).
- Everything present but render still says "Node not found" → **RC-1** (backend env stale) or
  **RC-4** (path mismatch — compare the dir the app uses vs where files actually landed).

### 1c. Inspect the backend's actual environment
The backend log path is known (see prior finding: backend log location on Windows). Confirm
whether `CAPFORGE_NODE_BIN` / `CAPFORGE_HYPERFRAMES_CLI` were present when the backend started.
Quick probe: in the app's terminal, hit the backend health/info endpoint, or add a temporary
log line (Phase 2 makes this permanent). If the runtime dir is fully populated **but** the
backend env is empty → confirms **RC-1**.

### 1d. Capture the exact HTTP status
Reproduce the render and note the real status (400 expected for `HyperframesRenderError`).
Record it to settle the 503-vs-400 question.

**Phase 1 verification checklist:**
- [ ] Build commit recorded and compared to `main`.
- [ ] `runtime\node\node.exe`, `cli.js`, `puppeteer\` presence recorded.
- [ ] Backend startup env (managed vars present/absent) recorded.
- [ ] Exact HTTP status of the failed render recorded.
- [ ] RC identified: RC-1 / RC-2 / RC-3 / RC-4.

---

## Phase 2 — Fix: make the backend see provisioning + give actionable errors

Targets **RC-1** (primary) and hardens RC-2/RC-4 observability. Do these regardless of RC,
because the staleness bug is real even when provisioning succeeds.

### 2a. Restart the backend after on-demand provisioning (core fix)
After `hyperframes:provision` completes successfully (`electron/main.js:451-457`), the backend
must be re-spawned so `python-manager.js:175-184` re-evaluates `isNodeRuntimeReady()` /
`isHyperframesReady()` and injects the env.

- Add a `restart()` to the Python manager (stop the child, then `start()`), or reuse an existing
  stop+start. Follow the existing spawn/teardown in `electron/python-manager.js`.
- Call it at the end of the `hyperframes:provision` handler, after
  `ensureHyperframesRuntime` resolves, and emit a final progress event so the UI knows the
  backend is reloading.
- **Anti-pattern guard:** do **not** try to mutate the running backend's env in place — it
  cannot pick that up. Restart is the contract.

### 2b. First-run should provision HyperFrames too (or render must drive it)
Today first-run installs Node only (`main.js:316`), so a fresh install always lands in the
"CLI missing" state. Choose one (decide in Phase 1 review):
- **Option A:** also call `ensureHyperframesRuntime` during first-run (after `ensureNodeRuntime`),
  still best-effort. Heavier first-run (~150–300 MB) but render "just works."
- **Option B (recommended):** keep first-run light; when the user clicks **Render** with the
  HyperFrames engine and the runtime isn't ready, drive the existing `hyperframes:provision`
  flow (with progress UI) **then** restart the backend (2a) **then** render.

### 2c. Surface provisioning failures (kill the silent degrade)
`electron/main.js:319` swallows Node-provisioning failures into `console.warn`. Send a
user-visible signal (the setup window already streams `setup:progress`; add a non-fatal
`setup:warning` or include it in `setup:done` payload) so a failed download is visible, not
silently degraded to "needs Node."

### 2d. Add a backend HyperFrames status endpoint (observability + gating)
Add `GET /api/hyperframes/status` in `backend/main.py` returning the resolution outcome:
```json
{ "resolved": true|false, "mode": "managed"|"npx"|"none",
  "node_bin": "...|null", "cli": "...|null", "npx": "...|null" }
```
Implement by reading the same env/`shutil.which` logic — reuse `node_runtime.py`; do **not**
duplicate the resolution rules (add a small `describe()` helper in `node_runtime.py` and call it
from both `hyperframes_argv()` and the endpoint). The renderer can call this to decide whether
to render directly or provision first (2b Option B), and it makes Phase 4 verifiable.

### 2e. Make the "Node not found" error actionable in the UI
When `hyperframes_argv()` is `None`, the toast currently says "install Node." Since CapForge
*bundles* Node, the message should instead point at the in-app provisioning. Map the
`HyperframesRenderError` "Node not found" case to a hint like "Set up HyperFrames rendering"
with a button that triggers `hyperframes:provision`. Keep the wording in the backend message and
let `api.ts` surface `{title,hint}` (existing path, `api.ts:181-195`).

**Phase 2 verification checklist:**
- [ ] After clicking the HyperFrames provision button, the backend restarts and a subsequent
      render finds Node (no "Node not found").
- [ ] `GET /api/hyperframes/status` reports `mode:"managed"` once provisioned.
- [ ] A simulated provisioning failure shows a user-visible warning (not just console).
- [ ] Resolution rules live in ONE place (`node_runtime.py`), used by both render + status.
- [ ] No in-place env mutation of a running backend anywhere.

---

## Phase 3 — Fix: render-browser readiness (the next failure after Node resolves)

Once Node+CLI resolve, the **next** Windows failure is a render exit-code error because
chrome-headless-shell isn't present (first-run never runs `browser ensure`). Pre-empt **RC-5**.

- Ensure `ensureHyperframesRuntime` (which runs `hyperframes browser ensure`,
  `hyperframes-provision.js:93-98`) has actually populated `PUPPETEER_CACHE_DIR`
  (`<userData>/runtime/puppeteer`) and that `python-manager.js:180` injected
  `PUPPETEER_CACHE_DIR` into the (restarted) backend env.
- Extend `GET /api/hyperframes/status` (2d) to also report whether a browser is present
  (e.g. via `hyperframes doctor --json` parsed result, or a cache-dir probe).
- If `browser ensure` failed (network/CDN/disk), surface it the same way as 2c rather than
  letting render die with a raw non-zero exit tail.

**Anti-pattern guard:** don't assume Puppeteer falls back to `~/.cache/puppeteer` — the backend
forces `PUPPETEER_CACHE_DIR` to the app-managed dir; if that env didn't reach the backend
(staleness, Phase 2), the browser "isn't there" even when it was downloaded.

**Phase 3 verification checklist:**
- [ ] `runtime\puppeteer\` contains a chrome-headless-shell build after provisioning.
- [ ] Backend (post-restart) env has `PUPPETEER_CACHE_DIR` pointing there.
- [ ] `GET /api/hyperframes/status` reports browser present.
- [ ] A full HyperFrames render produces an output file (exit 0 + file at `--output`).

---

## Phase 4 — End-to-end verification (Windows)

Run on a **clean Windows profile** (or wiped `%APPDATA%\CapForge\runtime\`) from a build of
current `main` (or the branch under test):

1. Fresh install → first-run completes; note whether Node (and per 2b, HyperFrames) provisioned.
2. Open HyperFrames studio with Claude → still works (regression check).
3. If render-runtime not yet provisioned: click Render → app drives provisioning w/ progress →
   backend restarts → render proceeds (no "Node not found").
4. Render completes → output video exists and plays.
5. `GET /api/hyperframes/status` → `{ resolved:true, mode:"managed", browser:present }`.
6. Restart the app and render again with no re-provisioning → still works (markers short-circuit;
   env injected at startup because runtime is now ready).
7. Re-run with network disabled mid-provision → user sees a clear, actionable failure (not a
   silent degrade or a raw 503/exit-code tail).

**Anti-pattern grep before done:**
- [ ] `grep -rn "console.warn" electron/main.js` around provisioning — confirm failures are also
      surfaced to the UI, not only logged.
- [ ] Confirm only ONE definition of the Node/CLI resolution rules (`node_runtime.py`); no
      duplicated `shutil.which("npx")` / env logic added elsewhere.
- [ ] Confirm no `shell=True` was added to the Python render subprocess as a "fix" — the managed
      `[node, cli.js]` contract is the correct path; `.cmd` shims stay banned.

---

## Out of scope / deferred
- Shipping Node in the installer (currently downloaded first-run) — separate decision.
- Bundling chrome-headless-shell in the installer — separate decision.
- macOS parity is unaffected (this bug is the Windows env/ordering asymmetry), but the
  restart-after-provision fix (2a) benefits both platforms.
