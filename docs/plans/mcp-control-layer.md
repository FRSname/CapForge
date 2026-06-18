# Plan: CapForge MCP Control Layer (GUI-first)

**Goal:** While CapForge is open, the user starts a transcription, then asks a Claude agent to
clean up the transcript, auto-emphasize keywords, and run vision-based design QA — **seeing every
change apply live in the UI**. CapForge stays a *finishing* tool: **no video trimming/cutting**.

**Locked decisions (from user):**
1. **GUI-first.** Agent operates the *running* app's open project; edits appear live in the UI.
2. **Vision QA leads with source-compositing (old 4b).** Platform safe zones are **advisory only**
   — the user considers them too restrictive and intentionally goes over them sometimes. Real design
   problems (text over the speaker's face, low contrast) are caught by looking at composited frames.
3. **Edit-conflict = soft lock.** While the user is actively editing the transcript, an incoming agent
   `result_updated` is *not* applied destructively — it is queued and surfaced ("Agent updated — apply?").
4. **Auth = per-session token.** Backend writes `{port, token}` to a discovery file; agent mutations go
   through a token-guarded `/api/agent/*` namespace. Renderer keeps its existing tokenless REST calls.

**Status:** Planning. Execute milestone-by-milestone in fresh contexts (pairs with `claude-mem:do`).

---

## Phase 0 — Discovery findings (DONE — evidence)

### Backend surface (`backend/main.py`) — FastAPI on `127.0.0.1`, singleton state, one job at a time
- `current_result` (`main.py:53`), `current_status` (`main.py:54`), `broadcast_progress()` (`main.py:89`).

| Endpoint | Line | Shape |
|---|---|---|
| `GET /api/status` | `main.py:135` | `ProgressUpdate` |
| `POST /api/transcribe` | `main.py:218` | blocks until DONE, sets `current_result` |
| `GET /api/result` | `main.py:273` | → `TranscriptionResult` |
| `PUT /api/result` | `main.py:281` | overwrites `current_result` |
| `POST /api/export` | `main.py:289` | `ExportRequest{formats, output_dir}` |
| `POST /api/render-video` | `main.py:322` | `VideoRenderRequest{config, output_dir, custom_groups?}` |
| `GET /api/video-info?path=` | `main.py:165` | `{width,height,fps}` |
| `WS /ws/progress` | `main.py:302` | one-directional `ProgressUpdate` stream |

### ⚠️ Architecture-defining facts
- **Renderer owns the UI state**, not the backend (`App.tsx:21-28`): `result`, `settings`
  (`StudioSettings`), `groups`, `groupsEdited`. After transcription the renderer fetches once
  (`App.tsx:67 setResult(data)`).
- **Settings / groups / per-word emphasis never reach the backend** except as a `VideoRenderConfig` at
  render time (`lib/render.ts buildRenderBody`, CLAUDE.md "snake_case ↔ camelCase bridge").
- **WS is one-directional** today — client at `lib/api.ts:161-176`.
- **Port is not discoverable by an external process** — Electron picks a free port and passes it to the
  renderer via IPC `backend:port` only (`python-manager.js:27,135`); "isn't hardcoded anywhere else."

### Data contracts (`backend/models/schemas.py`)
`WordSegment` (`:77`), `Segment` (`:85`), `TranscriptionResult` (`:93`), `VideoRenderConfig` (`:118`),
`CustomGroup{text,start,end,words: list[dict]}` (`:181`), `VideoRenderRequest` (`:189`).

### Per-word emphasis already works (no new render code)
`_render_frame` reads `overrides` per word (`video_render.py:453-469`): `font_size_scale`,
`word_transition`, `active_word_color`, `pos_offset_x/y`, `scale_factor`, underline_*, highlight_*.

### Single-frame render primitive (vision-QA foundation)
`_render_frame(config, font, group, t) -> RGBA Image` (`video_render.py:609`); `_get_font(...)`;
call pattern + golden harness in `test_render_golden.py:137-148`. **Overlay only** — compositing over the
source video frame is required for face/contrast checks and is new work.

### Safe zones — frontend-only, advisory by design (`lib/safeZones.ts`)
Constants `tiktok/reels/shorts {top,bottom,right}` (`:29-33`); comment "treat the boundary as guidance"
and "never reach the backend." Per decision 2 these stay **advisory**.

---

## Allowed APIs / Anti-patterns

**Use:** the endpoints above; import `VideoRenderConfig`/`TranscriptionResult`/`Segment`/`WordSegment`
from `backend.models.schemas` as tool schemas; `_render_frame`/`_get_font`; Python `mcp`/`FastMCP`.
**Phase A must confirm the FastMCP tool decorator + image-return + WS-client APIs against the installed
SDK version before coding — do not assume.**

**Avoid:** ❌ inventing endpoints ❌ re-spelling config/result fields by hand ❌ assuming the backend
holds settings/groups (it doesn't) ❌ enforcing safe zones as hard pass/fail ❌ any trim/cut capability.

---

## Architecture: backend as a relay between agent and UI

```
Claude (MCP client) ── stdio ──> MCP server ──HTTP/WS──> CapForge backend ──WS /ws/control──> Renderer
                                   (reads port file)        (relay + current_result)        (applies to React state = source of truth for style)
```

- **Transcript data** → backend is the hub: agent `PUT /api/result`; backend broadcasts "result changed";
  renderer re-fetches and `setResult` → user sees it.
- **Style / emphasis / groups** → renderer is the hub: agent issues a command; backend relays it over a new
  `/ws/control` channel; renderer applies it to `settings`/`groups` state (so the user sees it) and mirrors
  its current UI state back so the agent can read what to change.
- **Port discovery** → backend writes its chosen port to a known file on startup
  (e.g. app-data/temp `capforge-backend.json`); MCP server reads it. CapForge must be running.

---

## Milestone A — Live transcript editing (the headline use case) — ✅ IMPLEMENTED

> "Open CapForge, transcribe, ask the agent to check spelling — watch it update live."

**Done (2026-06-18).** Backend + MCP server automated-verified end to end (discovery file,
token gate 401/404/200, `result_updated` broadcast, `get_transcript`→`update_words`→
`remove_filler_words` round-trip reflected in `current_result`). Renderer live-apply +
soft-lock banner are wired and typecheck-clean; **the live UI update still needs manual
verification in the running Electron app** (GUI behavior can't be unit-tested headlessly).
Files: `backend/agent_bridge.py`, `backend/main.py` (`/api/agent/*`, broadcast, discovery),
`electron/python-manager.js` (`CAPFORGE_PORT`), `mcp_server/*`, `src/renderer/src/lib/api.ts`
(control channel + `normalizeResult`), `components/AgentLiveSync.tsx`, `ResultsScreen.tsx`
(`applyAgentResult`), `App.tsx`. Not committed yet.

**What to implement:**
1. **Port discovery:** backend writes `{port}` to a known file on startup (small addition near
   `python-manager.js` spawn / backend boot). MCP server reads it; clear error if CapForge isn't running.
2. **MCP server skeleton** (`mcp_server/`): confirm FastMCP API; `client.py` (httpx, mirrors `lib/api.ts`);
   passthrough tools `get_transcript`, `get_status`, `transcribe`, `export`.
3. **Backend: broadcast result change.** On `PUT /api/result` (`main.py:281`), broadcast a
   `result_updated` event to WS clients (extend `/ws/progress` payload or add an event type).
4. **Renderer: live re-fetch.** Extend the WS handler (`lib/api.ts:176`) so a `result_updated` event makes
   App re-`getResult()` and `setResult(...)` — guarding the user's in-progress text edits / undo stack.
5. **Cleanup tools** (data only): `apply_transcript(result)` (spelling, homophones, casing, brand
   consistency) and `remove_fillers(words)` (drop fillers, re-close timing gaps).

**Verification:**
- [ ] With CapForge open on a transcribed clip, an agent spelling fix appears in the UI without reload.
- [ ] `remove_fillers` unit test: gaps closed, durations monotonic, no overlap.
- [ ] User's local unsaved edits aren't clobbered by an incoming `result_updated`.

---

## Milestone A.5 — One-click "Connect to Claude" — ✅ IMPLEMENTED

> Make the MCP server trivial to install for non-technical customers (both clients).

**Done (2026-06-18).** Customer flow: **Settings → Claude AI integration → Connect Desktop /
Connect Code → restart Claude.** No terminal, pip, or manual JSON.
- Bundled runtime: `mcp`+`httpx` added to `runtime-setup.js` `BACKEND_PACKAGES` (RUNTIME_VERSION 9→10);
  `mcp_server/**` added to package.json `files` + `asarUnpack`.
- `electron/claude-connect.js`: builds the stdio entry (bundled python + `-m mcp_server.server`,
  `cwd` + `env.PYTHONPATH` to cover mac PYTHONPATH and Windows `._pth`), immutably merges a `capforge`
  entry into `claude_desktop_config.json` / `~/.claude.json`; `detectClients` + manual-config fallback.
- IPC `claude:*` in `main.js`, `window.subforge.claude.*` in preload, UI section in `SettingsPanel.tsx`.
- Verified: 6 node:test (merge/entry/paths), both tsc projects clean, `-m mcp_server.server` resolves
  via PYTHONPATH from a foreign cwd and lists all 6 tools. **Live click-through still needs manual
  verification in the packaged/first-run app** (needs the bundled runtime present). Not committed yet.

## Milestone B — Live style & keyword emphasis — ✅ IMPLEMENTED (regroup deferred)

**Done (2026-06-18).** Two-way control bus: renderer mirrors `{settings, groups, presets}` to the
backend (`PUT /api/ui-state`, debounced in `App.tsx`); agent reads `GET /api/agent/ui-state` and
relays commands via `POST /api/agent/command` → broadcast `agent_command` over the control WS →
applied live in the renderer. Ops: `set_settings`, `apply_preset` (builtin, via `lib/agentCommands.ts`),
`set_word_overrides` (emphasis → `ResultsScreen.applyWordOverrides`). Per-word `overrides` are already
snake_case (consumed verbatim by Canvas preview + backend), so emphasis needs no translation. MCP
tools: `get_ui_state`, `set_style`, `apply_preset`, `emphasize`. Verified: 108 vitest (new
agentCommands), control-bus integration (ui-state 404→mirror→read; command 400/401 gates + broadcast).
**Live application in the renderer needs manual Electron verification.** Not committed yet.
**Deferred:** semantic regrouping (`set_groups`) — interacts with the fragile groups-derivation effect.

## Milestone B (original detail) — Live style & keyword emphasis

> Needs the full control bus, because settings/groups live in the renderer (`App.tsx:22,27`).

**What to implement:**
1. **Control bus:** backend `/ws/control` + `POST /api/agent/command`; backend relays commands to the
   renderer. Renderer subscribes, applies patches to `settings`/`groups`/per-word overrides (routing
   through `applySettings`/undo where appropriate, `App.tsx:48-54`), and mirrors current UI state back so
   the agent can read it (e.g. cached `GET /api/ui-state`).
2. **Emphasis tools:** `emphasize(strategy)` — agent picks important words (numbers, names, CTAs; optional
   stress inferred from long word-duration vs char count) and sets per-word `overrides`
   (`font_size_scale`, `word_transition`, `active_word_color`) — keys from `video_render.py:453-469`.
3. **Style tools:** `set_style(patch)` / `apply_preset(name)` → applied live to renderer `settings`.
4. **Semantic regrouping:** `regroup_semantic(target_len)` — break at phrase boundaries (never orphan a
   preposition / split a proper noun), applied to renderer `groups` so the preview updates.

**Verification:**
- [ ] Agent emphasizes a word → its size/animation visibly changes in the live preview.
- [ ] Agent style/preset change reflects in the UI and survives a render.
- [ ] Overrides use only keys the renderer reads (grep `ov.get(` in `video_render.py`).

---

## Milestone C — Vision-based design QA (compositing first) — ✅ IMPLEMENTED

**Done (2026-06-18).** The agent can SEE its output and run the render→look→fix loop.
- `backend/exporters/frame_qa.py`: `render_overlay` / `render_qa_frame_png` (reuse `_render_frame`,
  `_get_font`, `_build_groups`; ffmpeg grab + alpha-composite over the source frame) and
  `analyze_layout` (caption bbox, frame-edge contact, advisory safe zones ported from `safeZones.ts`).
- Backend `POST /api/render-frame` (PNG via `Response`) + `POST /api/agent/check-layout`, both token-guarded;
  they use the renderer-mirrored snake_case config so frames match the live look (App now mirrors
  `render: buildRenderBody(...)` in the ui-state).
- MCP tools `render_frame(t, composite)` → returns an `Image` the agent views; `check_layout(t, platform)`.
- Verified: overlay PNG, composite over a real test video (opaque pixels behind captions), layout +
  advisory safe-zone violation, token gate; 61 pytest / 108 vitest / 6 node all green.
- **Live composite-in-app needs manual verification** (real media + Claude). Not committed yet.

## Milestone C (original detail) — Vision-based design QA (compositing first)

> Decision 2: lead with real visual judgment; safe zones advisory only.

**What to implement:**
1. **Backend (new) `POST /api/render-frame`** — `{config, t, custom_groups?}` → PNG. Reuse `_get_font`
   + `_render_frame` (`video_render.py:609`).
2. **Composite over source (primary):** grab the source video frame at `t` via ffmpeg, alpha-composite the
   overlay, return PNG. Enables **text-over-face** and **contrast** critique.
3. **MCP tool `render_frame(t, composite=True)`** → returns PNG as MCP image content so the agent *sees* it.
4. **Hard check:** text rendered literally **off-frame** (past `resolution_w/h`) is always flagged.
5. **Advisory check:** `check_safe_zones(platform)` — port `safeZones.ts:29-33` constants; report overlap as
   *guidance, not failure* (per user).
6. **The loop:** render_frame → critique → adjust `overrides`/`settings` live (Milestone B) → re-render
   until it passes the agent's rubric.

**Verification:**
- [ ] Composited frame shows subtitles over the real video at the correct timestamp.
- [ ] Overlay-only `render_frame` matches a golden for a frozen config (reuse `test_render_golden`).
- [ ] `check_safe_zones` reports overlaps without blocking; off-frame text is flagged hard.

---

## Milestone D — Verification (final)

1. End-to-end with CapForge open: transcribe → live spelling cleanup → semantic regroup → emphasize →
   vision QA loop → render → export — all visible in the UI.
2. Grep guards: override keys exist in `video_render.py`; no invented endpoints; schemas imported.
3. `pytest` (`.venv-dev/bin/python -m pytest backend/tests`) green (goldens + new unit tests).
4. Confirm no trim/cut capability leaked in; safe zones never hard-block.

---

## Risks / open details (non-blocking)

- **Edit-conflict policy:** what wins when the user is mid-edit and an agent `result_updated` arrives
  (last-write-wins vs merge vs lock). Decide in Milestone A.
- **Port file location & lifecycle:** cleanup on backend exit; stale-file handling.
- **Control-bus auth:** loopback-only; consider a per-session token in the port file so only the local
  MCP server can drive the UI.
- **ffmpeg frame-grab perf** for the QA loop (cache decoded frames by `t`).
