# Plan: Co-Author Preview Loop + Caption-Style Parity

**Status:** IMPLEMENTED on branch `feat/coauthor-preview-loop-and-parity` (2026-06-23).
Decisions taken: (1) parity mechanism **C** (faithful editable HTML); (2) **both** gates
(tool contract + in-app approval dialog); (3) all word modes ported. Caption parity
verified by `backend/tests/test_caption_parity.py` (Pillow vs live HyperFrames snapshot,
all modes + stroke/shadow/multi-line; mean diff ≤ ~4/255). Approval gate's backend hold +
modal need a manual smoke test (lives in `main.py`, not unit-testable without whisperx).
**Author:** orchestrated via /claude-mem:make-plan
**Date:** 2026-06-23

## Goal (in the user's words)

Two behavioral changes to how the local Claude MCP agent works with CapForge's HyperFrames co-author mode:

1. **Preview-first, render-on-approval.** The agent must iterate with the user using *cheap single-frame previews* to dial in the desired effect/animation **first**, and only kick off the **full final video render after the user explicitly approves**.
2. **Caption-style parity by default.** When the agent enters co-author mode, the seeded composition must reproduce the **exact caption style/effect the user configured in CapForge's panel (StudioSettings / active preset)**. HyperFrames-specific restyling/animation changes happen **only when the user explicitly asks for them** — they are an opt-in divergence, not the starting point.

---

## Phase 0 — Discovery Findings (consolidated; cite before coding)

> These are verified facts from reading the source on 2026-06-23. Every implementation phase references back here. Do **not** assume APIs beyond this list.

### A. Tool surface & control flow (the agent's action space)

MCP server: `mcp_server/server.py` (FastMCP over stdio, 35 tools). HTTP client: `mcp_server/client.py`. Backend: `backend/main.py`.

Relevant tools that already exist:

| Tool | Backend endpoint | Purpose | Gated? |
|------|------------------|---------|--------|
| `preview_hyperframes_frame(t)` | `POST /api/agent/preview-hyperframes-frame` (main.py:899) | Single PNG of the **HyperFrames** composition at time `t` via `npx hyperframes snapshot --at <t>` (`snapshot_hyperframes_project`, hyperframes_render.py:155) | token only |
| `render_frame(t, composite)` | `POST /api/render-frame` (main.py:463) | Single PNG of the **classic Pillow** renderer at `t` (`render_qa_frame_png`, frame_qa.py:81). This is the parity source-of-truth image. | token only |
| `check_layout(t, platform)` | `POST /api/agent/check-layout` (main.py:483) | Mechanical bbox / safe-zone analysis (no image) | token only |
| `render_hyperframes(quality, video_format)` | `POST /api/export-hyperframes` (main.py:592) | **Full final render** → `render_hyperframes_project` → `npx hyperframes render`. **No approval gate today.** | token only |
| `enter_coauthor_mode()` / `exit_coauthor_mode()` | `POST /api/agent/coauthor` (main.py:1085) | Flip `current_coauthor`; entering seeds `index.html` once | token only |
| `sync_captions()` | `POST /api/agent/coauthor/sync-captions` (main.py:1093) | Refresh transcript + caption companion WITHOUT touching `index.html` | token only |

**Critical fact:** `render_hyperframes` triggers the render immediately with no user-in-the-loop confirmation anywhere in the path (verified main.py:592–711). The only gate is the agent token, which the MCP client supplies automatically.

### B. Co-author seed config source — already wired, but lossy

- `_coauthor_enter()` (main.py:1032–1050) calls `_agent_frame_inputs()` (main.py:449) → returns the **live UI config** (the renderer mirrors StudioSettings + groups to the backend via `PUT /api/ui-state`; stored in `current_ui_state`, main.py:110). So the seed **does** receive the user's current settings.
- It then calls `seed_coauthor_project(...)` → `export_hyperframes_project(...)` → `_build_index_html()` (hyperframes_project.py:368–543).
- Memory observation **3440** confirms: *"Co-Author Mode Entry Seeds From Current UI State, But Generates Generic index.html."*

### C. The fidelity gap in `_build_index_html()` (hyperframes_project.py:368–543) — this is the parity bug

The classic-path caption block honors only:
- `bg_color` + `bg_opacity` → pill (`_css_rgba`, line 386, 481)
- `bg_corner_radius`, `bg_padding_h`, `bg_padding_v` (lines 470, 487–488)
- `text_color` (base) + `active_word_color` (lines 399–400, 482, 490)
- `font_family`, `font_size`, `line_height` (lines 483–486)
- `max_width` (line 479), `position_y` (line 457)
- entrance via `_ENTRANCES` map (lines 76–81; fade/slide/pop/none) + fixed `_EXIT_DUR=0.12` fade (line 83)
- active word = **instant color swap only** (`tl.set color` at lines 410–411)

It **drops** (none reproduced — these are the parity holes to close):
- `word_transition` / `wordStyle` modes: `highlight` (colored pill behind active word — *this is the CapForge default*), `karaoke` (left→right clip fill), `underline`, `bounce`, `scale`, `crossfade`, `reveal`. All collapse to the instant color swap.
- All `highlight_*` sub-settings (radius, padding_x/y, opacity, animation, text_color)
- All `underline_*` sub-settings; `bounce_strength`; `scale_factor`
- `stroke_width` / `stroke_color` (text outline) — `font-weight:400` hardcoded, no `-webkit-text-stroke`
- `shadow_*` drop-shadow group (enabled/color/opacity/blur/offset_x/offset_y)
- `tracking` (letter-spacing), `text_offset_x/y`, `text_align_h/v`
- `lines` (multi-row grouping), `position_x`, `bg_width_extra`, `bg_height_extra`

There are **three** caption paths (hyperframes_project.py:377–380, 512–523):
1. **classic** (`caption_style=="classic"`) → hand-rolled block above ← the gap lives here
2. **native registry** (`caption-pill-karaoke`, etc.) → references a sub-composition; intentionally NOT CapForge's look
3. **custom** (`caption_style=="custom"`) → `current_custom_caption_html` (agent-authored full component; starter is `custom_caption_template()`, hyperframes_captions.py:346–423)

### D. The parity source-of-truth renderers (what HTML must match)

CapForge already maintains pixel-parity between two renderers; the HTML caption is effectively a **third** renderer that must match them:
- **Canvas** preview: `src/renderer/src/hooks/useSubtitleOverlay.ts` — full word-transition switch at lines 346–411; animation easing `easeOut(v)=1-(1-v)²` (lines 92–113); shadow (309–315); stroke (318–325).
- **Pillow** render: `backend/exporters/video_render.py` — `_render_frame(config, font, group, current_time)` at line 609 (pure function → `PIL.Image`, RGBA, resolution-sized, no I/O). `_CROSSFADE_DUR=0.06` hardcoded at line 283.
- Shared magic numbers: `src/renderer/src/lib/renderConstants.ts` (`CROSSFADE_DUR=0.06`, `DEFAULT_PAD_V=8`, `DEFAULT_LINE_HEIGHT=1.2`). **Parity risk:** `CROSSFADE_DUR` is duplicated, not passed through config.

### E. The render config contract (the data both sides share)

- camelCase → snake_case bridge: `buildRenderBody()` in `src/renderer/src/lib/render.ts:52–176` (every key listed there).
- Backend model: `VideoRenderConfig` in `backend/models/schemas.py:120–181` (50 style fields).
- Group shape consumed everywhere: `{text, start, end, words:[{word,start,end,score?,speaker?,overrides?}]}` (`_build_groups`, video_render.py).

### F. Single-frame preview is cheap and already exists (the iteration primitive)

- Pillow one-frame: `_render_frame` (video_render.py:609); standalone example: `render_scenario()` in `backend/tests/test_render_golden.py:137`, generator `backend/tests/gen_golden.py` (run: `.venv-dev/bin/python -m backend.tests.gen_golden`).
- HyperFrames one-frame: `snapshot_hyperframes_project(project_dir, t)` (hyperframes_render.py:155) → `npx hyperframes snapshot`.
- Golden-frame parity tests already pin `_render_frame` against PNGs in `backend/tests/golden/` (tolerance diff): `backend/tests/test_render_golden.py`.

### Anti-patterns to guard against

- ❌ Inventing a "render approval" param/endpoint that doesn't route through the human. A flag the agent sets itself is not a gate.
- ❌ "Fixing" parity by editing only `_build_index_html` while leaving `custom_caption_template()` and `sync_companions` lossy — all caption-emitting paths must share one generator.
- ❌ Hardcoding new magic numbers in the HTML generator. Pull from `config` / `renderConstants.ts` mirror so the three renderers stay synced (per CLAUDE.md "Preview ↔ Render Parity").
- ❌ Re-scaffolding `index.html` in co-author mode (it would clobber the agent's edits — `_coauthor_project()` deliberately only `sync_companions`, main.py:656–670).
- ❌ Synthetic bold. CapForge convention: pick a bold font *file*; both renderers use `font-weight: normal`. The HTML generator must embed the chosen font via `@font-face` (`_font_face_block`, hyperframes_project.py:546) and never fake-bold.

---

## DECISIONS REQUIRED (resolve before/at start of execution)

### Decision 1 — Parity mechanism (shapes Phase 2 entirely)

| Option | How | Pro | Con |
|---|---|---|---|
| **A. HTML/CSS/GSAP port** | Hand-port CapForge's renderer into the generated caption HTML, config-driven | Captions stay editable HTML → agent can diverge on request | Large parity surface (8 word modes × shadow × stroke × multi-line); a *third* renderer to keep synced forever; never truly pixel-perfect |
| **B. Baked overlay** | Use existing Pillow `_render_frame` to bake a transparent caption layer (PNG sequence / overlay webm); HyperFrames composites it | **Pixel-perfect by construction**, zero drift | Captions become a flat baked layer — agent **cannot** restyle them in HTML, which **violates** "then change style with HyperFrames when desired" |
| **C. (Recommended) Faithful HTML default, opt-in divergence** | Build ONE config-driven HTML caption generator that reproduces CapForge's look at high fidelity, used as the default seed; keep it as editable HTML so the agent diverges only on request | Matches both user requirements directly; single generator feeds classic seed + sync + custom starter | Same parity-surface cost as A (mitigated by phasing word-modes by usage) |

**Recommendation: C.** It is the only option that satisfies *both* "exactly the same by default" *and* "change with HyperFrames when desired." Phase the word-transition modes by real usage (defaults first: `highlight` + `fade`, then `instant`/`karaoke`, then the long tail).

### Decision 2 — Strength of the approval gate (shapes Phase 1)

- **2a (cheap, immediate):** Tool-contract only. Rewrite `render_hyperframes` docstring + add a workflow guidance resource so the agent *always* previews → iterates → renders only after the user says "yes" in chat. Relies on the cooperative agent.
- **2b (recommended add-on):** Real human gate. `render_hyperframes` opens a confirm dialog in the CapForge UI over the existing `/ws/control` channel; the backend holds the render until the user clicks Approve. Belt-and-suspenders against an over-eager agent.

**Recommendation:** Ship 2a in Phase 1 (it directly fixes the reported behavior), add 2b as Phase 1b hardening.

---

## Phase 1 — Preview-first + render-on-approval (agent behavior)

**Outcome:** The agent reliably iterates on single-frame previews and never starts a full render until the user explicitly approves.

### 1.1 Rewrite the render tool contract (Decision 2a)
- **File:** `mcp_server/server.py` — the `render_hyperframes` tool docstring (around line 393).
- **Copy the pattern** from the existing `preview_hyperframes_frame` docstring (same file) which already steers the agent to the preview tool. Add an explicit precondition: *"Do NOT call this until (1) you have shown the user single-frame previews via `preview_hyperframes_frame`, (2) iterated until they confirm the effect/animation, and (3) received explicit approval to render the final video. This starts a slow, full-length render."*
- Add the same preconditions to `render_frame` framing so previews are the default loop, and to a short **workflow resource**: extend the existing `hyperframes://library` resource pattern (`mcp_server/knowledge.py`) with a "co-author working loop" section: enter mode → sync captions → preview frames at representative timestamps (use `find_moments`/`find_semantic_moments` to pick them) → iterate → **ask user to approve** → render.

### 1.2 (Recommended) Human approval gate (Decision 2b)
- **Backend:** in `export_hyperframes_endpoint` (main.py:592), when `request.render` is true, instead of rendering inline, broadcast a `render_request` control message over `/ws/control` (reuse the `AGENT_COMMAND_OPS` mechanism, main.py:113) and await a confirmation. Add `POST /api/agent/confirm-render` (or a renderer-driven `PUT`) that releases it. Time out → reject.
- **Renderer:** add a confirm dialog/toast (use the existing `useToast` + a modal) showing quality/format and a thumbnail from `render_frame`; Approve → hit the release endpoint; Cancel → abort.
- **Anti-pattern guard:** the release endpoint must be triggered by the renderer (the human), never by an agent tool.

### Verification (Phase 1)
- [ ] `grep -n "explicit approval\|previews" mcp_server/server.py` shows the new preconditions on `render_hyperframes`.
- [ ] Manual: drive the agent; confirm it calls `preview_hyperframes_frame` before ever calling `render_hyperframes`, and asks for approval.
- [ ] (2b) Manual: agent's `render_hyperframes` blocks until the app's Approve button is pressed; Cancel aborts cleanly with a clear toast.
- [ ] No regression: existing panel "Render" button path (`use_ui_config` false / frontend effects) still renders without the agent gate.

---

## Phase 2 — Caption-style parity (the core fix)

**Outcome:** Entering co-author mode (and `sync_captions`) produces captions visually identical to the CapForge panel for the user's current StudioSettings/preset — including word-transition mode, shadow, stroke, position, multi-line.

### 2.1 Build ONE config-driven HTML caption generator
- **New module:** `backend/exporters/hyperframes_caption_html.py` exposing e.g. `build_caption_css(config) -> str` and `build_caption_timeline_js(config, groups) -> str`, driven entirely by `VideoRenderConfig` (Phase 0.E) — no hardcoded style constants.
- **Reproduce, mode by mode, the logic in** `useSubtitleOverlay.ts:346–411` (authoritative for visual behavior; mirror to Pillow `video_render.py`). Map each `word_transition`:
  - `highlight` → colored pill behind active word using `active_word_color`, `highlight_radius`, `highlight_padding_x/y`, `highlight_opacity`, active text = `highlight_text_color || bg_color` (Canvas lines 251–274, 346–411).
  - `karaoke` → per-word left→right clip-path fill at word progress; past words `active_word_color`.
  - `instant` / `crossfade` (use `CROSSFADE_DUR=0.06`) / `underline` / `bounce` (`bounce_strength`) / `scale` (`scale_factor`) / `reveal`.
- Emit `-webkit-text-stroke` from `stroke_width`/`stroke_color`; CSS `text-shadow` from the `shadow_*` group; `letter-spacing` from `tracking`; honor `text_align_h/v`, `text_offset_x/y`, `position_x`, `lines`, `bg_width_extra/height_extra`.
- Use GSAP entrances consistent with `_ENTRANCES` (hyperframes_project.py:76–81) but extend to match Canvas `pop` scale (0.85→1.0) and `slide` offset (`resH*0.04`).
- **Determinism (HyperFrames contract, hyperframes_captions.py:428–436):** no `Math.random`/`Date.now`/`repeat:-1`; one group visible at a time; hard `tl.set` kill at each group end; register paused timeline at `window.__timelines[...]`.

### 2.2 Wire all caption-emitting paths to the one generator
- **`_build_index_html()`** (hyperframes_project.py:368–543): replace the inline `caption_setup`/`caption_loop`/`.cbubble`/`.cw` blocks with calls into 2.1.
- **`custom_caption_template()`** (hyperframes_captions.py:346–423): seed the agent's custom starter from the same generator output for the current config, so "custom" begins as a faithful copy the agent then edits.
- **`sync_companions()`** path: ensure the regenerated caption companion (native/custom sub-composition) is produced by the same generator. (Verify `inject_transcript` flow, hyperframes_captions.py:232–254.)
- Keep `font-weight:400` + `@font-face` embed (`_font_face_block`, hyperframes_project.py:546) — no synthetic bold.

### 2.3 Resolve the duplicated `CROSSFADE_DUR`
- Pass crossfade duration through the render config (add to `VideoRenderConfig` + `buildRenderBody`) OR document it as a third pinned constant the generator reads from a shared backend constant mirroring `renderConstants.ts`. Prefer passing through config to eliminate the parity-risk noted in Phase 0.D/E.

### Verification (Phase 2)
- [ ] Unit: generator emits expected CSS/JS for each `word_transition` (snapshot tests on the strings).
- [ ] `grep -n "cbubble\|caption_setup" backend/exporters/hyperframes_project.py` shows the inline block is gone / delegated.
- [ ] Visual: see Phase 3 frame-diff harness.

---

## Phase 3 — Parity verification harness (prove it matches)

**Outcome:** Automated, reviewable proof that the HTML captions match the Pillow source-of-truth, analogous to the existing golden-frame tests.

### 3.1 Cross-renderer frame-diff
- **Copy the structure** of `backend/tests/test_render_golden.py` (`render_scenario`, line 137) and `gen_golden.py`.
- For a set of representative configs (default highlight+fade; karaoke; underline; shadow+stroke; multi-line; non-classic position) and sampled timestamps:
  - Render the **Pillow** frame via `render_qa_frame_png(..., composite=False)` (frame_qa.py:81) → source-of-truth PNG.
  - Render the **HyperFrames** frame via `snapshot_hyperframes_project(project_dir, t)` (hyperframes_render.py:155) on a seeded project for the same config.
  - Tolerance-diff the two (reuse the golden test's diff helper).
- Commit baseline PNGs under `backend/tests/golden_parity/` and review them visually before committing (same discipline as CLAUDE.md golden-frame note).
- **Guard:** snapshot needs Node 22 provisioned (`hyperframes_argv()` returns `None` otherwise — Phase 0.F). Mark these tests `@pytest.mark.requires_node` and skip when Node is unavailable, so CI without Node still passes the rest.

### 3.2 Wire into the agent's QA loop
- Document in the workflow resource (1.1) that after `sync_captions`, the agent should diff `render_frame` (Pillow) vs `preview_hyperframes_frame` (HTML) at one timestamp as a self-check that parity holds before iterating on *new* effects.

### Verification (Phase 3)
- [ ] `.venv-dev/bin/python -m pytest backend/tests/test_caption_parity.py` passes (or skips cleanly without Node).
- [ ] Baseline parity PNGs reviewed and committed.

---

## Final Phase — Verification & regression sweep

1. **Behavior:** Drive the agent end-to-end in co-author mode: enter → captions already match the panel (no manual restyle needed) → preview frames → iterate effects → request approval → render only after approval. Confirm both user asks are met.
2. **Parity:** Run Phase 3 harness; review diffs.
3. **No-regression:**
   - `.venv-dev/bin/python -m pytest backend/tests/` (existing golden frames + co-author tests `backend/tests/test_coauthor.py` still green).
   - `npm run typecheck` (renderer changes from 1.2 / 2.3).
4. **Anti-pattern grep:**
   - `grep -rn "Math.random\|Date.now" backend/exporters/hyperframes_caption_html.py` → none (determinism).
   - Confirm no caption path bypasses the single generator: `grep -rn "cbubble" backend/` localized to the generator only.
5. **Docs:** update `docs/plans/hyperframes-open-coauthor.md` and CLAUDE.md "Preview ↔ Render Parity" to note the third (HTML) renderer and the generator as its source of truth.

---

## Execution order & independence

- **Phase 1.1** (tool contract) is independent and can ship immediately — it directly fixes the reported render-too-early behavior.
- **Phase 2** depends on Decision 1 (recommend C). It is the largest effort; phase word-modes by usage.
- **Phase 3** depends on Phase 2.
- **Phase 1.2** (UI gate) is independent of Phase 2 and can land in parallel.

## Open questions for the user
1. Decision 1 — confirm mechanism **C** (faithful editable HTML) vs B (baked overlay) vs A.
2. Decision 2 — tool-contract only (2a), or also the in-app approval dialog (2b)?
3. For Phase 2 word-mode phasing: is `highlight` (the current default) the priority, or do you primarily use a different mode/preset day-to-day?
