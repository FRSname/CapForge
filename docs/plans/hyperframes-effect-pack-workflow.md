# HyperFrames Effect-Pack Workflow (replace effect-template imports)

**Status: PLAN — not started.**
Created 2026-07-14 via /make-plan. Each phase is self-contained and executable in a fresh context.

## Goal

Remove CapForge's persistent **effect-template library** (the "effect imports to
HyperFrames studio over CapForge") and replace the reuse workflow with the
HyperFrames-native pattern: a reusable effect is a **folder of specific files**
(the effect HTML + a README/manifest with usage rules + assets) that gets
imported into the co-author workspace, where the agent reads the rules and
wires the effect itself.

## Scope decisions (confirm before executing)

1. **Remove** the effect-template library end-to-end: `backend/effect_templates.py`,
   its API endpoints, the `~/.capforge/effect-templates.json` store, and the
   EffectsPanel "Apply template… / ★ Save as template" UI. The plain effects
   timeline (`/api/effects`, add/edit effects UI) is **kept** — it is not part
   of the template system.
2. **Keep and refine** `import_into_workspace` (MCP tool + `/api/agent/workspace/import`)
   as the single import mechanism — it already copies a pack folder into
   `compositions/<name>/`. Phase 2 aligns its contract with HyperFrames
   conventions instead of rewriting it.
3. **Optional (Phase 3)**: a CapForge UI entry point ("Import effect pack…")
   so the user can import a pack without asking the agent. Skip if agent-only
   import is enough.

---

## Phase 0: Documentation findings — Allowed APIs & conventions

Consolidated from the installed HyperFrames skills (CLI v0.7.55) and a full
codebase scout. Executors: treat this as the API surface; do not invent beyond it.

### HyperFrames conventions for reusable effects

Sources: `~/.claude/skills/hyperframes-registry/SKILL.md`,
`references/contributing.md`, `references/install-locations.md`,
`references/wiring-blocks.md`, `references/wiring-components.md`,
`references/templates.md` (registry-item.json manifests at lines 316–358;
component snippet template at 372–411), `references/demo-html-pattern.md`,
`examples/add-component.md`, `~/.claude/skills/hyperframes/SKILL.md`
(sub-composition `<template>` wrapper, lines 166–192).

- **Block** = standalone sub-composition (own dimensions/duration/timeline).
  Lower thirds, title cards, VFX, caption styles are blocks
  (contributing.md:15). Installs to `compositions/<name>.html`.
- **Component** = snippet effect with no own dimensions (CSS/overlay/text
  treatment). Installs to `compositions/components/<name>.html`.
- **Wiring a block**: reference from the host `index.html` via
  `<div data-composition-src="compositions/<name>.html" data-composition-id="…"
  data-start data-duration data-track-index data-width data-height>`.
- **Wiring a component**: paste HTML into the composition div, CSS into
  `<style>`, JS before the timeline; merge exposed GSAP timeline calls.
- **Usage rules** are carried by: a `registry-item.json` manifest (name, type,
  title, description, tags, dimensions/duration, files), a **comment header
  inside the snippet** the agent is told to read, and (components only) a
  companion `demo.html`. A plain `README.md` works for local packs but is a
  CapForge convention, not something HyperFrames auto-discovers.
- **ID-prefix rule**: every element ID in an effect gets a 2–3 letter prefix
  to avoid sub-composition collisions (contributing.md:44–52).
- **CLI surface**: `hyperframes catalog` (browse; `--type`, `--tag`, `--json`)
  and `hyperframes add <NAME>` (install from the remote registry) exist but
  target the **remote** GitHub registry only.

### Anti-patterns (things that do NOT exist — do not invent)

- There is **no `hyperframes import`** command and no `hyperframes registry`
  subcommand.
- There is **no documented local/`file://` registry** override in
  `hyperframes.json` — "point the agent at my local folder as a registry" is
  unsupported. Local reuse = place the file at the `paths.blocks`/
  `paths.components` location and wire it manually.
- `hyperframes add` does **not** install examples or `demo.html`.
- No HTML include/partial mechanism exists beyond `data-composition-src`
  (blocks) and manual snippet paste (components).

### Existing CapForge code (scout findings; verify line numbers before editing)

**System A — effect-template library (REMOVE):**

| Piece | Location |
|---|---|
| Backend module | `backend/effect_templates.py` (save/list/apply/delete, assets under `~/.capforge/templates/assets/`) |
| API endpoints | `backend/main.py:1165-1207` (GET/POST/DELETE `/api/effect-templates`, POST `…/apply`) + import at `main.py:91` |
| Schema | `backend/models/schemas.py:245-250` (`SaveTemplateRequest`) |
| MCP client methods | `mcp_server/client.py:123-143` (effect-template wrappers) |
| UI | `src/renderer/src/components/studio/EffectsPanel.tsx:158-180` (Apply template picker), `:353-408` (★ Save as template) |
| Tests | `backend/tests/test_effect_templates.py` (11 tests) |
| Plan doc | `docs/plans/hyperframes-studio-and-templates.md` Phase 2 (lines 88-118) |

**System B — workspace pack import (KEEP + refine):**

| Piece | Location |
|---|---|
| Endpoint | `backend/main.py:1368-1377` — POST `/api/agent/workspace/import` (agent-gated) |
| Sandbox/copy logic | `backend/workspace_fs.py:154-221` — `import_path()` (path validation, extension allowlist, size caps) |
| MCP tool | `mcp_server/server.py:688-698` — `import_into_workspace(src, dest_subdir)` |
| Client | `mcp_server/client.py:169-173` |
| Co-author workflow prompt | `mcp_server/server.py:610-620` |
| Tests | `backend/tests/test_workspace_fs.py:87-144` (6 tests — keep) |

**Untouched:** effects timeline endpoints (`backend/main.py:138, 1098-1137`)
and the add/edit effects UI (`EffectsPanel.tsx:1-156`).

---

## Phase 1: Remove the effect-template library

### What to implement

1. Delete `backend/effect_templates.py` and `backend/tests/test_effect_templates.py`.
2. In `backend/main.py`: remove the effect-template endpoints (~1165-1207) and
   the `effect_templates` import (~line 91).
3. In `backend/models/schemas.py`: remove `SaveTemplateRequest` (~245-250).
4. In `mcp_server/client.py`: remove the effect-template client methods (~123-143).
5. In `mcp_server/server.py`: remove any effect-template MCP tools/docstring
   mentions (grep `template` in the file; keep unrelated hits).
6. In `EffectsPanel.tsx`: remove the "Apply template…" picker (~158-180) and
   the "★ Save as template" button block (~353-408) plus their state/handlers
   and now-unused imports. Do NOT touch the add/edit effects UI above line 156.
7. Mark `docs/plans/hyperframes-studio-and-templates.md` Phase 2 as superseded
   by this plan (one-line note, don't rewrite history).

Note: leave `~/.capforge/effect-templates.json` on disk untouched — user data;
it simply becomes unread.

### Verification checklist

- `grep -ri "effect.template\|effect_template\|SaveTemplateRequest" backend/ mcp_server/ src/ --include='*.py' --include='*.ts' --include='*.tsx'` → 0 hits (except this plan/superseded plan).
- `.venv-dev/bin/python -m pytest backend/tests` → green (count drops by 11).
- `npm run typecheck` → clean.
- App builds and EffectsPanel still adds/edits effects.

### Anti-pattern guards

- Do not remove `/api/effects` or `/api/agent/effects` — those are the live
  effects timeline, not templates.
- Do not delete `workspace_fs.py` or `test_workspace_fs.py` — System B stays.

---

## Phase 2: Align pack import with HyperFrames conventions

### What to implement

Define the **effect pack** contract and encode it in the existing import path
(copy the conventions from Phase 0, don't invent new ones):

1. **Pack contract** (document in the `import_into_workspace` docstring and
   `mcp_server/README.md`): a pack is a folder containing exactly one
   top-level `<name>.html` effect file, an optional `README.md` /
   `registry-item.json` with usage rules, and optional assets. Blocks import
   under `compositions/<name>/`; components (if the manifest/README says
   `type: component`) under `compositions/components/<name>/`.
2. In `backend/workspace_fs.py` `import_path()`: add light validation — a
   directory import must contain at least one `.html` file; reject otherwise
   with a clear error. Keep the existing allowlist/size caps unchanged.
3. Update the co-author workflow text (`mcp_server/server.py:610-620`) to spell
   out the loop, copying the wiring pattern from
   `hyperframes-registry/references/wiring-blocks.md`:
   import pack → `read_workspace_file` its README / the snippet's comment
   header → wire via `<div data-composition-src="compositions/<name>/<name>.html"
   data-start data-duration data-track-index data-width data-height>` →
   preview → render. Mention the ID-prefix rule for hand-merged components.
4. Add/extend tests in `backend/tests/test_workspace_fs.py`: pack with README
   imports intact; folder without any `.html` is rejected; components subdir
   destination works.

### Verification checklist

- New tests fail before the change, pass after (TDD).
- `.venv-dev/bin/python -m pytest backend/tests/test_workspace_fs.py` green.
- Manual smoke: in co-author mode, import a sample lower-third pack
  (HTML + README), have the agent wire it, preview a frame.

### Anti-pattern guards

- Do not shell out to `hyperframes add` or invent a local registry — local
  packs are placed by file copy only (Phase 0 anti-patterns).
- Do not parse/validate `registry-item.json` strictly — it is optional
  metadata for the agent to read, not a schema gate.

---

## Phase 3 (optional, confirm first): CapForge UI "Import effect pack…"

### What to implement

A renderer-side entry point so the user can import a pack without prompting
the agent:

1. Electron: folder-picker dialog via IPC (follow the existing dialog pattern
   in `electron/main.js`; remember the **dual preload gotcha** — wire
   `electron/preload.js` AND `src/preload/index.ts`).
2. Renderer calls a new local-token-gated `POST /api/workspace/import`
   (thin wrapper around the same `workspace_fs.import_path()`; gate with
   `require_local_token` like the other local routes in `backend/main.py`) —
   do not reuse the agent-token-gated route from the renderer.
3. Only enabled while a co-author workspace exists (marker check).
4. Toast on success/failure via `useToast`.

### Verification checklist

- `npm run typecheck` clean; import works in a running co-author session;
  route rejects requests without the local token (test alongside the existing
  token tests in `backend/tests`).

---

## Phase 4: Docs

1. `mcp_server/README.md`: tools table + workflow section reflect the pack
   contract; remove effect-template rows.
2. `CLAUDE.md`: if the MCP contract section mentions effect templates, update;
   add one line describing the effect-pack convention under the HyperFrames
   section.

## Phase 5: Final verification

1. Re-run the Phase 1 greps repo-wide → no stale references.
2. Full suite: `.venv-dev/bin/python -m pytest backend/tests` + `npm run typecheck`.
3. Golden/parity untouched (no renderer formula changes expected) — spot-check
   `python -m pytest backend/tests/test_render_golden.py` still green.
4. Manual co-author QA per Phase 2/3 checklists.
