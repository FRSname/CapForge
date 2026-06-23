# Plan: HyperFrames "Open Co-Author" mode

> **Status (2026-06-23, branch `feat/hyperframes-open-coauthor`, uncommitted):**
> Phases 1–5 + 7 implemented. 210 backend/mcp tests pass (+43), renderer typecheck
> clean, anti-pattern guards green, security-reviewer pass with CRITICAL/HIGH fixes
> applied to the new code. **Phase 6 (renderer/Electron UI) is intentionally not
> done** — paused for a product decision (it isn't needed for the agent-driven
> workflow, and the renderer holds no agent token so it can't call the
> `/api/agent/coauthor` endpoints without a new UI-facing seam). **Pre-existing
> security follow-up** (out of scope here, separate PR): `/api/serve-audio` and
> `/api/video-info` are unauthenticated arbitrary-file-read endpoints; gate them
> behind a path check without breaking the renderer.


**Goal.** Let the connected Claude agent author *arbitrary* HyperFrames content —
build a custom effect/animation from a prompt, or ingest a folder of
instructions + assets + HTML — and have it land in CapForge's own HyperFrames
project, the way a standalone Claude Code session with the hyperframes skills
would. CapForge keeps owning the transcript, the timing, the canvas, and the
render; the agent gets free run of `index.html` and the project folder.

**Origin.** A Claude Desktop session, asked to "create a hyperframes project and
implement the speaker-lower-third effect," correctly read the MCP operating
model (which *forbids* scaffolding/standalone CLI) and then violated it —
because there is no MCP path to apply a custom HTML effect block. This plan
closes that gap by *authorizing and supporting* co-authoring inside the
CapForge-owned workspace.

---

## The core constraint (why this is non-trivial)

CapForge **regenerates `index.html` on every preview and every render**:

- `/api/export-hyperframes` (`backend/main.py:580`) → `_scaffold()`
  (`main.py:634`) → `export_hyperframes_project()` (`hyperframes_project.py:634`),
  which always rewrites `index.html` (`hyperframes_project.py:686`).
- **Render mode** scaffolds into a **throwaway temp dir** and `rmtree`s it
  (`main.py:657-668`) — agent files there are destroyed.
- **Open-in-Studio mode** scaffolds into the stable workspace
  `~/.capforge/studio/<hash>` (`hyperframes_workspace`,
  `hyperframes_project.py:53`) but still *overwrites* `index.html`.
- `/api/agent/preview-hyperframes-frame` (`main.py:858`) re-scaffolds the same
  workspace before each snapshot.

So agent edits cannot survive today. "Open co-author" = introduce a **co-author
mode** in which CapForge stops regenerating `index.html`, targets the stable
workspace for *all* operations (preview AND render), and only refreshes the
files it still owns.

## Ownership model (RECOMMENDED DEFAULT — confirm before Phase 1)

**B2 — captions as a regenerable include.** In co-author mode:

- **CapForge owns** (regenerable, never hand-edited): `transcript.json`,
  `source.<ext>`, and a `compositions/captions.html` sub-composition (it already
  generates this for native caption styles — `_prepare_caption_style`,
  `hyperframes_project.py:565`; referenced via `data-composition-src`,
  `hyperframes_project.py:515`).
- **The agent owns**: `index.html`, everything under `compositions/`, and
  `assets/`. On first entry CapForge writes a *starter* `index.html` (the
  current generated one) so captions + video already work; the agent extends it
  and CapForge never overwrites it again.
- A `sync_captions` action regenerates **only** `compositions/captions.html` so
  caption-style / grouping edits from the CapForge UI still flow in without
  touching the agent's `index.html`.

This gives the agent genuine free run of the root composition while preserving
CapForge's one irreplaceable asset — transcript-accurate captions — as an
*optional* include the agent can use or ignore.

> **Single open decision:** B2 (above) vs **B1 total handoff** (agent owns
> captions too; CapForge only seeds `transcript.json` + `source`, never
> regenerates anything). B1 is a strict subset of the work below (drop the
> caption-sync seam). Default to **B2** unless the user says otherwise.

---

## Phase 0 — Documentation Discovery (Allowed APIs)

Confirmed, real seams to build on (do **not** invent alternatives):

| Capability | Real anchor | Use it for |
|---|---|---|
| MCP tool → backend HTTP, token-gated | `mcp_server/server.py` `@mcp.tool`, `mcp_server/client.py` `_request`, `require_agent_token` (`main.py`) | every new agent tool follows tool→client method→`/api/agent/*` endpoint |
| Stable per-source workspace | `hyperframes_workspace()` `hyperframes_project.py:53` → `~/.capforge/studio/<hash>` | the one folder the agent co-authors |
| Scaffold | `export_hyperframes_project()` `hyperframes_project.py:634`; `_scaffold()` `main.py:634` | seed starter project; sync companions |
| Caption sub-composition (the pattern to mirror) | `_prepare_caption_style` `:565`, `write_custom_caption`/`inject_transcript`/`fit_caption_component` in `hyperframes_captions.py`, `set_custom_caption` endpoint `main.py:831` | regenerable captions include; trust-boundary validation precedent |
| Render / snapshot on a project dir | `render_hyperframes_project()` / `snapshot_hyperframes_project()` `hyperframes_render.py:73,155` | render/preview the agent's own `index.html` |
| Node + CLI provisioning (NOT system node) | `hyperframes_argv()` / `hyperframes_env()` `node_runtime.py:42,76` | run any CLI subcommand through the app-managed runtime |
| Studio preview server (singleton, serves one dir) | `electron/hyperframes-studio.js` `HyperframesStudio` | agent edits surface on Studio refresh |
| Import trust-boundary discipline to copy | `electron/preset-io.js` `parsePresetImport` (basename-only, extension allowlist, size cap, proto-pollution strip) — see CLAUDE.md | `import_into_workspace` |

**Anti-patterns (forbidden — grep guards in Phase 7):**

- ❌ `hyperframes init` / scaffolding a project *outside* the CapForge workspace.
- ❌ Shelling the CLI from the **MCP server process** — it has no Node env. CLI
  runs go through a backend endpoint using `hyperframes_argv()`+`hyperframes_env()`.
- ❌ Regenerating `index.html` while co-author mode is on.
- ❌ Writing/reading **outside** the workspace root (path-traversal).
- ❌ Allowing networked/stateful CLI subcommands (`init`, `publish`, `auth`,
  `cloud`, `lambda`, `tts`, `transcribe`, `remove-background`).

---

## Phase 1 — Co-author mode state + companion sync

**Implement (backend):**

1. Module-level state in `main.py` mirroring `current_custom_caption_html`
   (`main.py:93`): `current_coauthor: bool = False`.
2. In `hyperframes_project.py`, add `sync_companions(project_dir, result, config,
   groups, caption_html)` that writes **only** `transcript.json`, `source.<ext>`,
   and (B2) regenerates `compositions/captions.html` via the existing
   `_prepare_caption_style` path — and **never** writes `index.html`.
3. Add `seed_coauthor_project(...)` = a normal `export_hyperframes_project` call
   that produces the starter `index.html`, used once on entry.

**Verify:** new `backend/tests/test_coauthor.py`: seed then `sync_companions`
leaves an agent-modified `index.html` byte-identical; `captions.html` refreshes.

**Guard:** `sync_companions` must have no code path that writes `index.html`.

## Phase 2 — Workspace filesystem tools (the trust boundary)

**Implement (backend endpoints, all `require_agent_token`):**

- `GET /api/agent/workspace` → `{ path, tree }` (the resolved workspace +
  shallow file listing). Resolve via `hyperframes_workspace(current_result.audio_path)`.
- `GET /api/agent/workspace/file?path=...` → file text.
- `PUT /api/agent/workspace/file` `{ path, content }` → write text.
- `POST /api/agent/workspace/import` `{ src }` → copy an external file/folder in.

**Sandbox helper** `resolve_in_workspace(root, relpath)`: reject absolute paths,
`..`, and symlink escapes (`Path.resolve()` must stay under `root.resolve()`).
Import: extension allowlist (`.html .css .js .json .png .jpg .jpeg .svg .webp
.woff2 .ttf .otf .mp4 .webm .mov`), per-file size cap, basename-only writes into
`compositions/` or `assets/` — mirror `parsePresetImport` discipline.

**Client + MCP tools** (`client.py`, `server.py`): `get_workspace`,
`read_workspace_file`, `write_workspace_file`, `import_into_workspace`.

**Verify:** `test_coauthor.py` — traversal attempts (`../../etc/passwd`,
absolute, symlink) raise; oversized/duplicate-extension imports rejected; a
valid `compositions/code-block.html` write round-trips.

**Guard (CRITICAL / security-reviewer):** this adds filesystem write + external
copy from an agent. No path escapes; no overwrite outside workspace.

## Phase 3 — CLI orchestration tool

**Implement:** `POST /api/agent/hyperframes-cli` `{ args: [...] }` →
runs `hyperframes_argv() + args` with `cwd=workspace`, `env=hyperframes_env()`,
captured stdout/stderr/exit (mirror `snapshot_hyperframes_project`,
`hyperframes_render.py:155`). **Allowlist subcommands**: `lint`, `inspect`,
`compositions`, `info`, `docs`, `snapshot`. Reject everything else with the
reason. Client method + MCP tool `run_hyperframes_cli(args)`.

**Verify:** fake-CLI test asserts allowlist enforcement + env/cwd plumbing;
`lint` on a seeded project returns exit 0.

**Guard:** subcommand allowlist enforced server-side, not just documented.

## Phase 4 — Gate render/preview on co-author mode

**Implement (`main.py`):**

- `_scaffold` / `_work` in `export_hyperframes_endpoint` (`main.py:634-668`):
  when `current_coauthor`, **both** paths target
  `hyperframes_workspace(current_result.audio_path)` (never the temp scratch),
  run `sync_companions` instead of `export_hyperframes_project`, and render the
  agent's existing `index.html`. (Render-to-file still copies the finished video
  to `out_dir`; it just no longer rmtree's the agent's project.)
- `preview_hyperframes_frame` (`main.py:858`): in co-author mode, `sync_companions`
  then snapshot — do not re-scaffold `index.html`.
- New `POST/GET /api/agent/coauthor` to enter/exit mode (seeds starter project on
  enter) + `sync_captions` op. This is backend behavior, so it's its own endpoint,
  not the renderer-relay `/api/agent/command` (`main.py:422`).
- MCP tools: `enter_coauthor_mode`, `exit_coauthor_mode`, `sync_captions`.

**Verify:** enter mode → agent writes a composition referencing `captions.html`
→ preview frame succeeds → render produces a file AND the workspace `index.html`
is unchanged afterward.

## Phase 5 — Rewrite the operating-model guidance

The doc Desktop read then violated lives in `mcp_server/knowledge/` + the
`hyperframes_guide` root text. Update it so co-author mode is **authorized and
described**:

- Replace "You do NOT scaffold a HyperFrames project or run the CLI" with the
  co-author loop: `enter_coauthor_mode` → `get_workspace` → author files under
  `compositions/`, reference `compositions/captions.html` → `run_hyperframes_cli
  lint/inspect` → `preview_hyperframes_frame` → `render_hyperframes`.
- Explicitly forbid `init`/standalone projects *outside* the workspace.
- Document the B2 ownership split + `sync_captions`.

**Verify:** `mcp_server/tests/test_knowledge.py` — guide no longer asserts the
old prohibition; references the new tools.

## Phase 6 — Renderer/Electron UX surface

- HyperFrames panel: a "Co-author with agent" toggle → calls
  `/api/agent/coauthor`, opens Studio on the workspace (`HyperframesStudio`
  already serves it), shows the path + a "Sync captions" button.
- Optional: Studio auto-refresh when the agent writes (nice-to-have).
- Follow theming rules (CSS vars, no hardcoded colors — CLAUDE.md).

**Verify:** `npm run typecheck` clean; manual toggle round-trip.

## Phase 7 — Verification

1. `.venv-dev/bin/python -m pytest backend/ mcp_server/` green (incl. new
   `test_coauthor.py`).
2. `npm run typecheck` clean.
3. **Anti-pattern grep guards:** no `hyperframes init` in agent paths; no CLI
   subprocess in `mcp_server/`; co-author render path contains no
   `export_hyperframes_project` / `rmtree` of the workspace.
4. E2E smoke: connect agent → `enter_coauthor_mode` → `import_into_workspace`
   the `speaker-lower-third-9x16` folder → reference it in `index.html` →
   `preview_hyperframes_frame` → `render_hyperframes`; confirm output + that the
   agent's `index.html` survived.
5. **security-reviewer** pass on Phases 2–3 (filesystem write + subprocess from
   an agent is a real new attack surface).

---

## Risks

- **Caption re-sync drift (B2):** the agent's `index.html` references
  `compositions/captions.html`; if the agent removes that reference, `sync_captions`
  silently no-ops. Acceptable — agent owns the root by design; surface it in the guide.
- **Windows Node/ffmpeg provisioning:** CLI tools depend on the app-managed
  runtime being ready. Reuse `hyperframes_argv()`/`hyperframes_env()` and the
  existing "run setup first" error (`hyperframes_render.py:40`); gate co-author
  entry on provision status like the render button already does.
- **Concurrent edits:** agent writes vs a UI `sync_captions` racing. Keep
  companion writes scoped to files the agent doesn't own (B2) to avoid clobber.
