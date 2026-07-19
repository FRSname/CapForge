# Plan: Make Registry Caption Style Changes Visible (Kinetic Slam "nothing happened" fix)

**Date:** 2026-07-19
**Status:** IMPLEMENTED 2026-07-19 on branch `feat/caption-style-visibility`
(4 commits: 9301c8d P2, 8f441cc P3, c59f177 P3.5, a2d0c6e P5). All gates green:
backend+mcp pytest 383 passed / 20 skipped, typecheck clean, frontend 283 passed;
Phase 4 sweep PASS (grep guards, behavioral spot-check of
`detect_coauthor_caption_mismatch`). Phase 1 was VERIFIED live earlier the same
day: user exited co-author mode and re-rendered; Kinetic Slam captions appeared
correctly. Open: merge to main, manual in-app QA (hint text, warning toast,
agent install→wire→Studio-refresh workflow).
**Trigger:** User asked a co-author agent to apply the "Kinetic Slam" caption style via
CapForge MCP. The agent called `set_caption_style("caption-kinetic-slam")`, the
HyperFrames dropdown updated — and nothing else visibly happened. User perceived it
as broken.

---

## Phase 0: Documentation Discovery (COMPLETE — findings consolidated below)

Three parallel code scouts traced the full path. **Verdict: not a bug — a UX/ergonomics
gap.** The style was set correctly and WILL apply on the next HyperFrames
scaffold/render; nothing in the app or the tool response tells the user (or the
calling agent) that a preview/render step is required to see anything.

### Verified mechanism (Allowed APIs — cite these, do not invent others)

| Step | Where | What it does |
|---|---|---|
| MCP tool `set_caption_style(name)` | `mcp_server/server.py:335-344` | Sends `send_command("set_settings", {"patch": {"captionStyle": name}})`; returns bare `{"status": "ok"}` |
| Backend relay | `backend/main.py:669-680` (`/api/agent/command`) | Fire-and-forget WebSocket broadcast to renderer; backend persists nothing |
| Renderer applies patch | `src/renderer/src/components/AgentLiveSync.tsx:106-125` → `lib/agentCommands.ts:25-36` | Updates React `StudioSettings.captionStyle`; dropdown in `HyperFramesPanel.tsx:356-368` reflects it |
| Live Canvas preview | `src/renderer/src/hooks/useSubtitleOverlay.ts` | **Zero references to captionStyle** — always draws the classic style. No visual change is EXPECTED |
| Style takes effect | `backend/exporters/hyperframes_project.py:566-632` (`_prepare_caption_style`) | Only during HyperFrames scaffold/render: `npx hyperframes add <style>` → transcript injection → embedded via `data-composition-src` |
| Cache invalidation | `hyperframes_project.py:145-214` (`_scaffold_fingerprint`) | `caption_style` is inside `config.model_dump_json()` → fingerprint miss → re-scaffold. **Cache staleness is NOT the problem** |
| Ways to see it | `HyperFramesPanel.tsx:257` (Open Studio), `:269` (Render), MCP `preview_hyperframes_frame` → `backend/main.py:1146-1211` | The only three paths that materialize a registry style |

### Anti-patterns (things that do NOT exist — do not build against them)

- There is NO automatic preview/snapshot trigger after a style change (confirmed in
  `docs/plans/coauthor-preview-loop-and-caption-parity.md:70-73`).
- The Canvas preview CANNOT render registry styles; do not attempt to "fix" the
  preview to draw Kinetic Slam — registry components are arbitrary HyperFrames HTML.
- `set_caption_style` does not take a `preview` parameter; the backend has no
  "apply-and-preview" endpoint.
- Do not add backend-side persistence of `captionStyle` — the renderer is the
  source of truth for style state by design (`main.py:669-680` docstring).

---

## Phase 0.5: LIVE ROOT CAUSE (2026-07-19, verified on the user's machine)

The user ran "Render with HyperFrames" with Kinetic Slam selected — video rendered
with CLASSIC captions. This is a second, deeper gap than the Phase-0 UX finding:

**The project is in co-author mode.** Marker at
`~/.capforge/studio/5118082d/Test-hyperframes/.capforge-coauthor.json` is
`active: true` (entered 2026-07-18 22:32 UTC, source `/Users/tobbot/Downloads/Test.mp4`).

Verified chain:
1. Render route hits the co-author branch (`backend/main.py:981-1001`): renders the
   **agent-authored `index.html` as-is**, only refreshing companions via
   `sync_companions` — never re-scaffolds (by design; `CoauthorClobberError` contract).
2. `sync_companions` → `_write_companions` → `_prepare_caption_style` DID install the
   style: `compositions/components/caption-kinetic-slam.html` exists in the workspace
   (mtime = render time). The install pipeline works.
3. But the agent's `index.html` carries an **inline classic caption layer**
   (`__capBuild` + `.captions` div, from the seed) and contains **zero references**
   to the installed component. The component sits on disk unreferenced; the render
   shows the inline classic captions.

**Net: in co-author mode, changing caption style in the UI (or via `set_caption_style`)
silently has no effect on the render** — the agent-owned `index.html` decides the
caption layer, and only the agent can rewire it. Nothing warns the user or the agent.

**Immediate unblock options (no code):**
- Ask the co-author agent: "Replace your inline caption layer in index.html with the
  already-installed `compositions/components/caption-kinetic-slam.html` component
  (reference it via `data-composition-src`)." — matches the standalone-HyperFrames
  workflow the user described.
- OR call the `exit_coauthor_mode` MCP tool (`mcp_server/server.py:464`), then
  Render with HyperFrames — the fresh scaffold embeds Kinetic Slam correctly.

---

## Phase 1: Immediate verification — prove Kinetic Slam actually works (no code)

**Goal:** Confirm end-to-end that the already-set style renders, so later phases
build on a working baseline (and to unblock the user right now).

**Tasks:**
1. With the app running and a transcript loaded, ask the co-author agent (or do it
   manually) to call `preview_hyperframes_frame(t)` at a timestamp with visible
   words — this hits `POST /api/agent/preview-hyperframes-frame`
   (`backend/main.py:1146-1211`), which re-scaffolds (fingerprint miss from the
   style change) and snapshots one frame.
2. Alternatively in-app: click **"Open in HyperFrames Studio ⧉"**
   (`HyperFramesPanel.tsx:257`) and confirm the Kinetic Slam component animates.
3. Note the requirement: registry style install needs the bundled Node 22+ /
   HyperFrames CLI (`hyperframes_captions.py:107-145`). If the snapshot fails,
   capture the `HyperframesRenderError.detail` — a missing-Node failure is a
   different (known) problem, see `project_windows_hyperframes_render` memory.

**Verification checklist:**
- [ ] Snapshot PNG (or Studio preview) shows Kinetic Slam styling, not classic
- [ ] `.capforge-scaffold.json` fingerprint updated (re-scaffold actually happened)

---

## Phase 2: MCP tool ergonomics — make the tool tell agents what to do next

**Goal:** A calling agent should never end its turn after `set_caption_style`
believing something visible happened. Fix at the source: the tool's return value
and docstring.

**What to implement (COPY the existing pattern, don't invent):**
1. In `mcp_server/server.py:335-344`, change `set_caption_style` to return a
   structured hint instead of a bare ok, e.g.:
   `{"status": "ok", "applied": name, "visible_after": "hyperframes_preview_or_render", "hint": "No change appears in the live preview panel — registry styles only render via HyperFrames. Call preview_hyperframes_frame(t) or ask the user to Render with HyperFrames."}`
   — mirror the dict-merge return style already used in `set_custom_caption_style`
   (`server.py:407-420`).
2. Strengthen the docstring the same way (agents read docstrings as docs): state
   explicitly that the live preview panel will NOT change.
3. Apply the same return-hint to `set_custom_caption_style` (`server.py:407-420`),
   which has the identical "visible only after render" property.
4. Update `mcp_server/README.md:91-94` tool table wording: "→ live UI" is
   misleading; change to "→ UI dropdown; visible in preview/render only".

**Verification checklist:**
- [ ] `grep -n "visible_after" mcp_server/server.py` shows both tools
- [ ] Existing mcp_server behavior untouched otherwise (no signature changes —
      return-value additions only, MCP tolerates extra keys)
- [ ] `.venv-dev/bin/python -m pytest backend/tests` still green (no backend change
      in this phase, sanity only)

**Anti-pattern guards:**
- Do NOT make `set_caption_style` trigger a preview itself — previews cost a full
  scaffold + headless browser run and the tool is used mid-conversation; keep it
  cheap and side-effect-free beyond the settings patch.
- Do NOT change `send_command` op names — `AGENT_COMMAND_OPS` allowlist in
  `backend/main.py` gates them.

---

## Phase 3: In-app affordance — tell the *user* the style is pending a render

**Goal:** When `captionStyle !== 'classic'`, the app should say so where the user
is looking (the preview area / HyperFrames panel), instead of silently previewing
classic.

**What to implement:**
1. In `HyperFramesPanel.tsx` (style Select lives at `:356-368`): when the selected
   style is not `classic`, render a small hint line under the Select — copy the
   panel's existing muted-hint styling used elsewhere in the file. Text like:
   "Preview shows the Classic style — <name> appears in HyperFrames Studio or the
   HyperFrames render."
2. Optional (decide during implementation): a one-shot toast via the existing
   `useToast` context when the value *changes* to a registry style through an
   agent command — hook point is `AgentLiveSync.tsx:106-125` where
   `applySettingsCommand` returns the patched settings; only toast when
   `patch.captionStyle` is present and ≠ `classic`. Keep it to agent-initiated
   changes (user-initiated dropdown changes are already self-evident).
3. Follow theming rules: `var(--color-text)` etc., no hardcoded colors
   (CLAUDE.md Theming section).

**Verification checklist:**
- [ ] `npm run typecheck` green
- [ ] Frontend tests (if any touch HyperFramesPanel) green; add a small render test
      asserting the hint appears when `captionStyle='caption-kinetic-slam'` and is
      absent for `classic` (AAA pattern, see testing rules)
- [ ] Manual: select Kinetic Slam → hint visible in both dark and light themes

**Anti-pattern guards:**
- Do NOT flip `groupsEdited` or touch settings-undo plumbing — this is pure
  presentational UI.
- Do NOT attempt to render the registry style on the Canvas preview.

---

## Phase 3.5: Co-author mode — surface (or bridge) the ignored caption style

**Goal:** When co-author mode is active, a caption-style change must either reach the
render or loudly say why it can't. Today it silently does neither (Phase 0.5).

**What to implement (pick during implementation; A is the floor, B is optional):**

**A. Warn (minimum, low risk):**
1. Backend: in the co-author render branch (`backend/main.py:981-1001`), after
   `sync_companions` returns, detect the mismatch: `captions` in the sync result is
   non-None (a sub-composition style is selected) but the agent's `index.html` does
   not contain that `caption_sub_src` string. Include a `warning` field in the
   render response / progress event: "Co-author project controls its own captions —
   the selected style '<name>' is installed at <rel> but not referenced by
   index.html. Ask the agent to wire it, or exit co-author mode."
2. Frontend: surface that warning via the existing `useToast` on render completion.
3. MCP: extend the Phase-2 `set_caption_style` hint — when `_coauthor_status()`
   reports active, say explicitly: "Co-author mode is active: also rewire index.html
   to reference compositions/components/<style>.html, or the style will not appear."
   (The tool can read status via the existing client binding for `/api/coauthor/status`.)

**B. Bridge (optional enhancement, discuss before building):**
- On co-author render, if the mismatch from A is detected, auto-append/swap a
  `data-composition-src` reference in index.html. **Risk:** violates the "never touch
  agent-owned index.html" contract (`sync_companions` docstring,
  `hyperframes_project.py:723-731`) and can double-render captions (inline classic +
  component). If pursued, it must be opt-in and remove/disable the inline layer —
  likely NOT worth it; prefer A + agent instruction.

**Verification checklist:**
- [ ] Unit test: co-author project with inline captions + `caption_style='caption-kinetic-slam'`
      → render result carries the warning; classic style → no warning
- [ ] `.venv-dev/bin/python -m pytest backend/tests` green
- [ ] Manual: repeat the user's exact flow → toast appears explaining why nothing changed

**Anti-pattern guards:**
- Do NOT auto-rewrite agent-owned `index.html` without explicit opt-in (contract:
  `CoauthorClobberError`, sync_companions "never index.html").
- Do NOT exit co-author mode implicitly on render.

---

## Phase 5: First-class co-author styling workflow (user's target UX, 2026-07-19)

**The user's intended workflow (treat as the north star for P2/P3.5 wording):**
1. Perfect subtitle text/timing in CapForge (classic pipeline).
2. Enter co-author mode; agent owns the HyperFrames project.
3. User directs conversationally: "make it Kinetic Slam", "move subtitles 20px up",
   "add an effect/intro" — agent edits the project; user watches in Studio.

Steps 2-3 already work for freeform edits. The broken link is REGISTRY STYLES in
co-author mode: the agent's natural tool (`set_caption_style`) is a CapForge-pipeline
knob that co-author renders ignore (Phase 0.5), and the agent cannot install a
registry component itself — `CLI_ALLOWED_SUBCOMMANDS = {lint, inspect, compositions,
info, docs}` excludes `add` (see CLAUDE.md HyperFrames Integration; allowlist in
`backend/main.py`). Tonight the component only landed because a render's
`sync_companions` installed it as a side effect.

**What to implement:**
1. New MCP tool `install_caption_component(style)` (or extend an existing coauthor
   workspace tool): token-gated endpoint that calls the existing
   `install_caption_component()` (`hyperframes_captions.py:107-145`) into the
   co-author workspace. Additive-only (writes `compositions/components/<style>.html`),
   so it does NOT violate the never-touch-index.html contract. Do NOT loosen the CLI
   passthrough allowlist — a dedicated endpoint keeps the allowlist read-only.
2. Return value should include the project-relative path + a wiring hint ("reference
   via data-composition-src; replace/disable any inline caption layer to avoid
   double captions").
3. Docs: `mcp_server/README.md` co-author section gets a "registry styles in
   co-author mode" recipe (install tool → edit index.html → user refreshes Studio).
4. Studio refresh UX (small): after `exit_coauthor_mode`, and after the agent
   reports index.html edits, the hint "refresh the Studio tab to see changes" —
   fold into the P2 tool-return hints.

**Verification checklist:**
- [ ] Agent flow in co-author mode: install tool → edit index.html → Studio refresh
      shows the registry style (manual QA with a live agent)
- [ ] CLI passthrough allowlist unchanged (`grep CLI_ALLOWED_SUBCOMMANDS backend/`)
- [ ] pytest green; new endpoint has auth + workspace-sandbox tests (mirror the
      existing coauthor workspace-tool tests)

**Anti-pattern guards:**
- Do NOT add `add` to `CLI_ALLOWED_SUBCOMMANDS` (networked/stateful command;
  the allowlist is deliberately read-only).
- Do NOT auto-edit index.html from the install endpoint — wiring stays the agent's
  job (it must reconcile with its own layout/animations).

---

## Phase 4: Final verification

1. Re-run the Phase 1 live check with the new build: agent sets Kinetic Slam →
   tool returns the hint → agent (following the hint) calls
   `preview_hyperframes_frame` → user sees a Kinetic Slam frame; in-app hint text
   visible under the style Select.
2. Grep guards:
   - `grep -rn "captionStyle" src/renderer/src/hooks/useSubtitleOverlay.ts` → still
     zero matches (preview untouched)
   - `grep -n "status.*ok\"}$" mcp_server/server.py` → set_caption_style no longer
     returns a bare ok
3. Full gates: `.venv-dev/bin/python -m pytest backend/tests`, `npm run typecheck`,
   frontend test suite.
4. Update `mcp_server/README.md` + this plan's status; memory entry for the
   "registry styles are render-only" gotcha.
