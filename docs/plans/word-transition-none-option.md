# Plan: "None" option for word style animation (`word_transition: none`)

**Status:** planned, not started
**Branch suggestion:** `feat/word-transition-none`
**Orchestration:** each phase is dispatched to the `implementer` agent (never pass a model override — agent pins handle routing). Use `scout` only if a phase hits a fact gap. Phases are self-contained; run them consecutively in fresh contexts.

## Problem

There is no way to turn word animation OFF. The closest mode, `instant`, still recolors the
active word (`active_word_color`) — it is "no motion", not "no treatment". Users want a true
static mode: **all words rendered in base `text_color`, no active-word distinction, no
timeline events**.

## Phase 0 — Documentation Discovery (DONE — consolidated scout findings)

Two scout agents traced the full contract. Sources: `StudioPanel.tsx`, `WordStylePopup.tsx`,
`render.ts`, `useSubtitleOverlay.ts`, `renderConstants.ts`, `presets.ts`, `types/app.ts`,
`schemas.py`, `video_render.py`, `hyperframes_caption_html.py`, `hyperframes_project.py`,
`test_caption_parity.py`, `test_render_golden.py`.

### Allowed APIs / exact touch points

| Concern | Location | Fact |
|---|---|---|
| Setting field | `src/renderer/src/components/studio/StudioPanel.tsx:76` | `wordStyle: string`, default `'highlight'` (line 161) |
| UI option list | `StudioPanel.tsx:758-767` | 8 `<option>`s: instant, crossfade, highlight, underline, bounce, scale, karaoke, reveal |
| TS union | `src/renderer/src/types/app.ts:33-40` | `WordTransition` union — **pre-existing bug: missing `'reveal'`** |
| Per-word override UI | `src/renderer/src/components/editor/WordStylePopup.tsx:49-59` | `TRANSITIONS` array; `''` = "— Global —"; **pre-existing bug: missing `'reveal'`** |
| camel→snake bridge | `src/renderer/src/lib/render.ts:118` | `word_transition: settings.wordStyle` — plain string pass-through, no change needed |
| Canvas renderer | `src/renderer/src/hooks/useSubtitleOverlay.ts:437-506` | switch on mode; `default:` (503-506) = instant behavior (`isActive ? wActiveColor : wTextColor`) |
| Presets | `src/renderer/src/lib/presets.ts:52,135,220` | `wordTransition` round-trips as a string — no schema change needed |
| Backend schema | `backend/models/schemas.py:172` | `word_transition: str = Field("instant", description=...)` — plain `str`, only the description enumerates modes |
| Pillow renderer | `backend/exporters/video_render.py:515-530` (color branches), `538-626` (per-mode animation blocks) | `else` at 529-530 = instant (active word gets `active_word_color`) |
| HTML/GSAP runtime | `backend/exporters/hyperframes_caption_html.py:538-594` | mode branches; **`else` fallback at 591-594 behaves as instant** — an unknown mode does NOT mean "no animation" |
| Per-word override keys | `hyperframes_caption_html.py:128-134` | `_WORD_OVERRIDE_KEYS` already includes `word_transition` — per-word `none` works for free once the mode exists |
| Scaffold cache | `backend/exporters/hyperframes_project.py:50` | `SCAFFOLD_VERSION = 3` — **MUST bump to 4** (runtime JS shape changes) |
| Parity tests | `backend/tests/test_caption_parity.py:158-159` | `@pytest.mark.parametrize("mode", [...8 modes])` — extend list |
| Golden tests | `backend/tests/test_render_golden.py:77,124` | golden cases exist for instant + highlight; new golden optional |

### Anti-patterns (repo-verified — do NOT do these)

- **Do not** reuse/relabel `instant` as "none" — it recolors the active word; two built-in
  presets depend on it (`presets.ts:271,395`).
- **Do not** rely on the HTML runtime's `else` fallback for `none` — the fallback IS instant
  (`hyperframes_caption_html.py:591-594`). `none` needs an explicit branch that registers
  **zero timeline events**, placed before the fallback.
- **Do not** confuse `''` ("— Global —") with `'none'` in WordStylePopup — empty string means
  "inherit global", `'none'` is a real mode value.
- **Do not** convert `word_transition` to a `Literal`/Enum in `schemas.py` — it is
  intentionally a plain `str` (per-word overrides ride the same field); only extend the
  `description`.
- **Do not** forget the `SCAFFOLD_VERSION` bump — byte-identical inputs would serve a stale
  preview runtime without it (CLAUDE.md → HyperFrames Integration).
- **Do not** touch GSAP eases or `CROSSFADE_DUR` — unrelated parity-pinned surfaces.

### Semantics of `none` (the contract all three renderers implement)

Every word is drawn exactly as an inactive word is drawn today: base `text_color`, base
position/scale, visible for the whole group lifetime. No pill, no underline, no karaoke fill,
no color change at word start/end. Group enter/exit animations are **unaffected** (they are a
separate system).

---

## Phase 1 — Backend: add `none` to Pillow + HTML runtime (agent: implementer)

### What to implement

1. `backend/models/schemas.py:172` — append `none` to the `description` string of
   `word_transition` (copy the existing description format; field stays `str`, default stays
   `"instant"`).
2. `backend/exporters/video_render.py` — in the color-branch chain (515-530), add an explicit
   `none` branch **before** the final else: word color is always `text_color`
   (copy the shape of the reveal branch's "others in text_color" handling, minus the
   time-gating). Confirm none of the per-mode animation blocks (538-626) fire for `none`
   (they key on the mode string, so an explicit branch + no block = correct).
3. `backend/exporters/hyperframes_caption_html.py` — in `CAPTION_RUNTIME_JS` (538-594), add
   `else if (m.mode === 'none') { /* static: no timeline events */ }` **before** the
   instant-fallback `else`. Copy the branch style of the adjacent modes.
4. `backend/exporters/hyperframes_project.py:50` — bump `SCAFFOLD_VERSION` 3 → 4 (the
   embedded runtime JS changed shape).

### Documentation references

- Branch shapes to copy: `video_render.py:521-528` (reveal) and
  `hyperframes_caption_html.py:538-540` (instant).
- Parity contract + scaffold rule: `CLAUDE.md` → "Preview ↔ Render Parity" and
  "HyperFrames Integration".

### Verification checklist

- `.venv-dev/bin/python -m pytest backend/tests/ -x -q` — full suite green (355+ tests).
- `grep -n "'none'" backend/exporters/video_render.py backend/exporters/hyperframes_caption_html.py` — both branches present.
- `grep -n "SCAFFOLD_VERSION = 4" backend/exporters/hyperframes_project.py` — bumped.

### Anti-pattern guards

- No new Pydantic Literal/Enum. No timeline events registered for `none` in the JS runtime.
- Do not change the schema default.

---

## Phase 2 — Frontend: type, UI options, Canvas branch (agent: implementer)

### What to implement

1. `src/renderer/src/types/app.ts:33-40` — add `'none'` **and the missing `'reveal'`** to the
   `WordTransition` union (reveal is a pre-existing gap; the global UI already offers it).
2. `src/renderer/src/components/studio/StudioPanel.tsx:758-767` — add
   `<option value="none">None (static)</option>` as the FIRST option (copy the existing
   option element shape). Default stays `'highlight'`.
3. `src/renderer/src/components/editor/WordStylePopup.tsx:49-59` — extend `TRANSITIONS` with
   `['none', 'None (static)']` and the missing `['reveal', 'Reveal']`. Keep `['', '— Global —']`
   first and distinct.
4. `src/renderer/src/hooks/useSubtitleOverlay.ts:437-506` — add `case 'none':` that fills with
   `wTextColor` unconditionally and draws the word (copy the `default:` instant block at
   503-506, dropping the `isActive` ternary). Ensure no pill/underline/karaoke path runs
   (they are inside their own cases — verify by reading 400-506 before editing).
5. `src/renderer/src/lib/render.ts` and `presets.ts` — **no code change**; verify pass-through
   only (`render.ts:118`, `presets.ts:135,220`).

### Documentation references

- Canvas block to copy: `useSubtitleOverlay.ts:503-506`.
- Option element shape: `StudioPanel.tsx:759`.

### Verification checklist

- `npm run typecheck` — clean.
- `grep -n "none" src/renderer/src/types/app.ts src/renderer/src/components/editor/WordStylePopup.tsx src/renderer/src/components/studio/StudioPanel.tsx src/renderer/src/hooks/useSubtitleOverlay.ts` — all four touched.
- `grep -n "reveal" src/renderer/src/types/app.ts src/renderer/src/components/editor/WordStylePopup.tsx` — reveal gap closed.

### Anti-pattern guards

- Do not change `STUDIO_DEFAULTS.wordStyle`. Do not rename `wordStyle`/`word_transition`.
- Do not "fix" the `default:` case to be `none` — default must remain instant for
  backward-compat with saved projects/presets.

---

## Phase 3 — Tests: parity pin + optional golden (agent: implementer)

### What to implement

1. `backend/tests/test_caption_parity.py:158-159` — add `"none"` to the
   `test_word_transition_parity` parametrize list (copy the existing list style).
2. Optional but recommended: add a `word_transition="none"` golden case following the
   highlight case shape at `test_render_golden.py:124`, add the matching config to
   `backend/tests/gen_golden.py`, regenerate with
   `.venv-dev/bin/python -m backend.tests.gen_golden`, and **visually review the new PNG**
   (all words must be base-colored with no highlight) before committing.

### Verification checklist

- `.venv-dev/bin/python -m pytest backend/tests/ -x -q` — green.
- Parity (opt-in, needs Node 22 + ffmpeg):
  `CAPFORGE_PARITY=1 .venv-dev/bin/python -m pytest backend/tests/test_caption_parity.py -q`
  — now 17/17 including `none`.

### Anti-pattern guards

- Never hand-edit golden PNGs; only regenerate via `gen_golden` and eyeball the diff.
- Do not loosen parity tolerances to make `none` pass — a static mode should be the easiest
  parity case in the suite; a failure means a renderer branch is wrong.

---

## Phase 4 — Final Verification (agent: implementer; scout for any gap)

1. Full backend suite: `.venv-dev/bin/python -m pytest backend/tests/ -q`.
2. `npm run typecheck`.
3. Grep sweep for missed enumerations:
   `grep -rn "karaoke" --include="*.py" --include="*.ts" --include="*.tsx" backend src mcp_server | grep -v test` —
   every hit that lists modes must also mention `none` (docstrings in `mcp_server/server.py:47,222`
   are examples, not enumerations — update only if they claim to be exhaustive).
4. Manual QA (user): pick "None (static)" in Studio → preview shows static words; run a
   HyperFrames render → exported video matches preview; per-word override to `none` on a
   single word works; preset save/load round-trips the value.
5. Update `CLAUDE.md` parity section's mode list ("highlight/instant/…/reveal") to include
   `none`.

## Open decision (default chosen, flag if user disagrees)

UI label: **"None (static)"**, placed first in both dropdowns. Alternative: "Off". Cosmetic —
implementer proceeds with the default.
