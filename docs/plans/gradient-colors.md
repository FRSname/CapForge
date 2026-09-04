# Gradient colour options for captions

**Question:** would it be possible to implement gradient options for colors?

**Answer: yes, and the architecture already has the right shape for it** — but it is a
three-renderer parity change, not a UI change. The cost is ~4 focused sessions, and the
single biggest risk is not the drawing code, it is picking an encoding that does not
force a seven-file pipeline change per colour field.

---

## Feasibility verdict (grounded in the audit, not assumed)

| Renderer | Can it fill with a gradient? | Mechanism that already exists |
|---|---|---|
| **Pillow** (source of truth, `backend/exporters/video_render.py`) | ✅ Yes, cheaply | `ImageDraw.text(fill=)` takes only a flat RGBA tuple — but `_render_frame` already draws every glyph into a dedicated full-frame RGBA `text_layer` (`video_render.py:1241`) and `alpha_composite`s it at `:1298`. A gradient image masked through `text_layer.getchannel("A")` is a **layer-level** operation — no per-glyph rewrite. |
| **Canvas preview** (`hooks/useSubtitleOverlay.ts`) | ✅ Yes, natively | `ctx.fillStyle` accepts a `CanvasGradient`. The file already builds one (`useSubtitleOverlay.ts:863`, the RSVP edge fade) and already uses `globalCompositeOperation` (`:867`, `:875`), so the offscreen-mask idiom is idiomatic here. |
| **HTML/GSAP** (`backend/exporters/hyperframes_caption_html.py`) | ✅ Yes, natively | Words are **DOM `<span>`s**, not canvas draws (`:498` `m.el.style.color = …`). `background-image: linear-gradient(...)` + `background-clip: text` + `-webkit-text-fill-color: transparent` is the standard path. Boxes are plain `div`s (`:467` `bg.style.background = CFG.bgColor`) — a gradient string is a **verbatim pass-through** there. |

Pillow 11.3.0 is pinned; nothing in the plan needs a newer Pillow or a new dependency.

**Confirmed non-blocker:** the drop shadow is built from `text_layer`'s alpha *before* any
recolour (`video_render.py:1273-1295`). A gradient changes RGB, never alpha, so the shadow
is untouched by construction. Do not "fix" the shadow for gradients.

---

## The two encoding options, and the recommendation

### Option A — extend the existing colour string (RECOMMENDED)

Keep `text_color: str`. A value is *either* `#RRGGBB` (today, unchanged fast path) *or* a
restricted CSS-subset gradient string:

```
linear-gradient(135deg, #FF0080 0%, #7928CA 100%)
```

**Why this wins — it rides the pass-through seams that already exist:**

| Seam | Evidence it is pass-through |
|---|---|
| Presets | `lib/presets.ts:137,246` — `textColor` is copied verbatim in both directions, no allowlist |
| Projects | `lib/project.ts:24` — `studioSettings: StudioSettings` stored wholesale |
| Per-word overrides | `_WORD_OVERRIDE_KEYS` (`hyperframes_caption_html.py:142-157`) already contains `text_color`, `word_bg_color`, `active_word_color` — **no new keys** |
| `caption_cfg` contract test | `test_caption_cfg_contract.py:66` already files `text_color` in `EXPECTED_IN_CAP_CFG` — **no new partition entry** |
| MCP `set_style` | `mcp_server/server.py:259-288` forwards arbitrary camelCase keys |
| Backend schema | `text_color: str` (`schemas.py:148`) already accepts it |

The seven-file pipeline collapses to **two** files for the value itself (the UI control and
the sanitizer), plus one new setting for the on/off UX if you want one.

### Option B — parallel typed fields (`text_color_gradient: GradientSpec | None`)

Pydantic-validated and self-documenting, but it multiplies: a new field, a new
`_WORD_OVERRIDE_KEYS` entry, a new `EXPECTED_IN_CAP_CFG` line, a new `SETTINGS_REGISTRY`
entry and a new precedence rule ("which wins?") **per colour**, ×7 colours. Reject unless
review disagrees.

**Decision: Option A.** The cost it buys instead is a **parse step that is a trust
boundary in three languages** — which Phase 1 exists to make safe and identical.

---

## Scope for v1 (and what is deliberately deferred)

**In scope**

- `linear-gradient` only. Angle + 2..N hex stops with explicit percentages.
- Two colours: **`text_color`** (the caption text fill) and **`bg_color`** (the group
  background box). These two carry the visual payoff and neither is touched by the
  colour-interpolating transitions.
- `reading_mode: 'wrap'` and `'rsvp'` context/normal words.
- The gradient is anchored to **the box the fill covers**: text → the caption block box
  (the rect all three already compute for the bg box), bg box → its own rect.

**Deferred, with the reason (state these in the PR, do not silently skip)**

| Deferred | Why |
|---|---|
| `active_word_color`, `highlight_text_color` | `crossfade` interpolates two flat RGBA tuples through `_lerp_color` (`video_render.py:483-489`, called at `:829`). Two gradients cannot lerp; the fix is drawing the fill twice at complementary layer alphas, which is its own change. |
| `karaoke` transition | Fills a word partially by clipping (`hyperframes_caption_html.py:605`, `useSubtitleOverlay.ts:811,818`). Interacts with `background-clip: text`. |
| `underline_color`, `shadow_color`, `rsvp_focus_color` | Thin 1-D marks; a gradient is invisible on them, and `rsvp_focus_color` is a single glyph. |
| `radial-gradient`, per-word gradient scope | Additive later; the Phase 1 core is written so a second gradient kind is a new branch, not a rewrite. |
| RSVP `rsvp_context_opacity` dimming of a gradient | `_dim_alpha` (`rsvp_layout.py:566-579`) scales a flat tuple's alpha. Gradient context words must dim via layer alpha instead — spelled out in Phase 3, verify or defer explicitly. |

---

## Phase 0 — Allowed APIs (already discovered; do not re-derive, do not extend by guessing)

Every API below was read out of the repo or is a documented platform API. **Anything not on
this list must be verified against a source before use.**

**Python / Pillow 11.3.0**
- `_hex_to_rgba(hex, opacity) -> (r,g,b,a)` — `backend/exporters/caption_draw.py:24-28`. The *only* hex parser; every colour goes through it (callers at `video_render.py:533,534,535,669,775,805,858,929,1175,1221`, `rsvp_layout.py:700,721,722,729`).
- `_lerp_color(c1,c2,t)` — `video_render.py:483-489`. Flat RGBA only.
- `_draw_single_word(draw, text, x, y, font, color, tracking, outline_sw, stroke_rgba)` — `caption_draw.py:60-88`. `color` is an RGBA tuple; **`fill=` accepts nothing else.**
- `_draw_rounded_rect(draw, xy, radius, fill)` — `video_render.py:472-480`. `fill` is an RGBA tuple.
- Layer stack in `_render_frame`: `pill_layer` (`:1236`), `guide_layer` (`:1238`), `text_layer` (`:1241`), composite order `pill → guide → shadow → text` (`:1260-1298`).
- Pillow APIs the gradient needs: `Image.new("RGBA"|"L", size, …)`, `Image.linear_gradient("L")`, `Image.putalpha`, `Image.getchannel("A")`, `Image.alpha_composite`, `Image.rotate`, `Image.resize`. **`ImageDraw` has no gradient API — do not look for one.**

**Canvas 2D**
- `ctx.createLinearGradient(x0,y0,x1,y1)` + `grad.addColorStop(offset, cssColor)` — precedent at `useSubtitleOverlay.ts:863-866`.
- `ctx.globalCompositeOperation` — precedent at `:867` (`destination-in`) and `:875` (`destination-over`).
- **Trap:** gradient coordinates live in the *current transform*. The hook wraps draws in `ctx.save(); ctx.translate/scale(...)` at `:474-477` (group pop-in) and `:799-801` (per-word scale). A gradient built outside the transform and used inside it is scaled with the text and diverges from Pillow.

**CSS / DOM (HTML layer)**
- `background-image: linear-gradient(...)`, `background-clip: text` + `-webkit-background-clip: text`, `-webkit-text-fill-color: transparent`, `background-size`, `background-position`.
- Existing hooks: `caption_css()` (`hyperframes_caption_html.py:189-232`), `.cw { color: … }` (`:222`), `__capHexToRgb`/`__capRgb` (`:264-265`), `bg.style.background` (`:467`), `m.el.style.color` (`:498`), GSAP `tl.set/fromTo(w, {color: …})` (`:667-740`).
- **Do not** assume `background-clip: text` composes with `-webkit-text-stroke` or `text-shadow` the way Pillow does — Phase 4 verifies it against a rendered frame.

**Test harness**
- Goldens: `backend/tests/test_render_golden.py`, images in `backend/tests/golden/` (13 today). Regenerate **only after an intentional formula change**: `.venv-dev/bin/python -m backend.tests.gen_golden`. Tolerance: mean abs diff < 2/255 AND max channel diff < 40.
- Parity: `backend/tests/test_caption_parity.py`, opt-in via `CAPFORGE_PARITY=1`; spawns headless Chromium, compares Pillow vs HTML (mean abs diff < 8.0, notable pixels < 5%, bbox ±3px). ~17 tests today.
- Cross-language scalar fixtures: `backend/tests/fixtures/rsvp_*_cases.json` (6 files) read by `test_rsvp_core.py`, `lib/rsvp.test.ts`, `lib/rsvp.embedded.test.ts`. **This is the pattern Phase 1 copies.**

---

## Phase 1 — The shared gradient core (3 implementations, 1 fixture)

**What to implement — copy the RSVP core pattern, do not invent a new one.** RSVP already
solved "one scalar formula, three languages" and the plumbing is proven. Read
`docs/caption-parity.md` → "RSVP reading mode" → the table of three cores, then mirror it:

| Renderer | New core file | Mirrors |
|---|---|---|
| Pillow | `backend/exporters/gradient.py` | `backend/exporters/rsvp.py` |
| Canvas | `src/renderer/src/lib/gradient.ts` | `src/renderer/src/lib/rsvp.ts` |
| HTML/GSAP | `GRADIENT_RUNTIME_JS` in `backend/exporters/hyperframes_gradient_runtime.py` | `RSVP_RUNTIME_JS` in `hyperframes_rsvp_runtime.py` |

Each core exposes exactly two functions:

1. `parse_gradient(value) -> GradientSpec | None` — returns `None` for a plain hex (the
   caller keeps its existing flat path untouched) and `None` for anything malformed.
   **This is a trust boundary**: a preset file, a `.cfproj`, and an MCP `set_style` all
   reach it. Reject rather than repair; never `eval`, never regex-substitute into CSS.
2. `gradient_line(spec, box) -> (x0, y0, x1, y1)` — the CSS gradient-line formula:
   `0deg` points **to top**, angle increases **clockwise**, and the line length is
   `|W·sin a| + |H·cos a|` centred on the box (the "magic corner" rule, so the first and
   last stops land exactly on the corners). Getting this wrong is invisible at 90° and
   wrong at every other angle — which is why it is fixture-pinned and not hand-written per
   renderer.

**Fixture:** `backend/tests/fixtures/gradient_cases.json`, listing input strings (valid and
malformed) → expected parse result, and `(spec, box)` → expected endpoints. Read by a new
`backend/tests/test_gradient_core.py`, `lib/gradient.test.ts`, and
`lib/gradient.embedded.test.ts` (the embedded test evaluates `GRADIENT_RUNTIME_JS`, exactly
as `lib/rsvp.embedded.test.ts` does for RSVP).

**Verification checklist**
- [ ] `npx vitest run src/renderer/src/lib/gradient` — 3 suites green off the one fixture
- [ ] `.venv-dev/bin/python -m pytest backend/tests/test_gradient_core.py`
- [ ] `grep -rn "gradient_line\|gradientLine" --include=*.py --include=*.ts backend src | grep -v test` returns exactly 3 definition sites
- [ ] Malformed inputs (`linear-gradient(red)`, `url(x)`, `#GGGGGG`, 400-char string, `linear-gradient(90deg,#fff 0%,#000 100%);background:url(evil)`) all return `None` in all three

**Anti-pattern guards**
- ❌ Do NOT hand-write an expected endpoint value in one language — add it to the fixture (this is the standing rule in `docs/caption-parity.md`).
- ❌ Do NOT accept arbitrary CSS colour syntax (`red`, `rgb()`, `hsl()`) — Pillow only has `_hex_to_rgba`, so the subset is `#RRGGBB`/`#RGB` and nothing else.
- ❌ Do NOT reuse `_hex_to_rgba`'s `str.lstrip("#")` on the whole gradient string.

---

## Phase 2 — Pillow: the source of truth

**What to implement.** In `_render_frame` (`video_render.py`), after `text_layer` is fully
drawn and **before** the shadow block at `:1264`:

1. `spec = parse_gradient(config.text_color)`. If `None`, change nothing — the existing
   flat path at `:533` stays byte-identical.
2. If not `None`: draw the text as today (any solid colour — the RGB is discarded), then
   build the gradient image over the caption-block box, `putalpha(text_layer.getchannel("A"))`,
   and use that as the new `text_layer`.
3. Same shape for `bg_color`, applied to the background-box draw at `:1175`/`:1221` —
   there the mask is the rounded rect, so build it with a `"L"` image and
   `_draw_rounded_rect` at `fill=255`.

**Copy from:** the shadow block, `video_render.py:1264-1298`. It is already a
mask-extract → recolour → composite pipeline; the gradient is the same three steps with a
gradient image in place of `Image.new("RGBA", size, (r,g,b,0))`.

**Verification checklist**
- [ ] `.venv-dev/bin/python -m pytest backend/tests/` — **all 13 existing goldens still pass with no regeneration.** A flat hex must produce byte-identical output; if a golden moves, the flat fast path was not preserved.
- [ ] Two new goldens (`gradient_text.png`, `gradient_bg_box.png`) added to `SCENARIOS`, generated with `.venv-dev/bin/python -m backend.tests.gen_golden`, and **visually reviewed** before commit.
- [ ] A gradient + `shadow_enabled: True` frame: the shadow is still flat `shadow_color` (the gradient must not tint it).
- [ ] `test_render_dedup.py` still green — confirm `_frame_state_key` need not change (a gradient is time-independent).

**Anti-pattern guards**
- ❌ Do NOT pass a gradient into `_draw_single_word`/`_draw_rounded_rect`'s `fill=` — Pillow will not error usefully, it will raise deep in the C layer or silently take the first tuple element.
- ❌ Do NOT regenerate goldens to make a failure go away. A moved golden on a flat-hex config is a bug, not a formula change.
- ❌ Do NOT build the gradient per word — one gradient image per frame per colour, or the 900-word RSVP reel benchmark (140→9.7 ms/frame, `docs/caption-parity.md`) regresses.

---

## Phase 3 — Canvas preview

**What to implement.** Mirror Phase 2 structurally rather than reaching for the shortcut.

- **Recommended:** draw caption text into an offscreen canvas, then
  `octx.globalCompositeOperation = 'source-in'` and fill with the gradient, then blit. This
  is the structural twin of Pillow's `text_layer` mask and sidesteps the transform trap
  entirely.
- **The shortcut and its trap:** assigning a `CanvasGradient` to `ctx.fillStyle` per word is
  fewer lines, but the hook is inside `ctx.translate/scale` at `:474-477` and `:799-801`,
  so the gradient scales with the text and drifts from Pillow. If you take this path you
  must build the gradient with transform-compensated coordinates and prove it with a
  `pop_mid_entry`-style scenario at a non-1.0 scale.
- RSVP context words currently dim via a per-word alpha (`rsvp_layout.py:729` /
  `_dim_alpha:566-579`). With a gradient, dim the **layer**, not the colour — or, if that
  is more than this phase, make gradient + RSVP context fall back to flat and say so.

**Copy from:** the RSVP edge-fade block, `useSubtitleOverlay.ts:858-871` — it already
creates a linear gradient, adds stops, and applies it through a composite operation.

**Verification checklist**
- [ ] `npm run typecheck && npx vitest run` — the ~465-test suite green. Note the suite is `node`-environment with `react-dom/server`, so this is a *unit* check of `lib/gradient.ts` and the geometry, not of the canvas paint.
- [ ] The Canvas↔Pillow numeric fixture asserted from both sides gains gradient endpoint cases.
- [ ] Manual: side-by-side screenshot of the in-app preview vs `render_frame` output for the same gradient at 0°, 45°, 90°, 135° — the 45°/135° cases are what catch a wrong gradient-line formula.

**Anti-pattern guards**
- ❌ Do NOT call `createLinearGradient` inside the per-word loop — it allocates per word per frame.
- ❌ Do NOT use `ctx.filter` or CSS gradients on the canvas element.

---

## Phase 4 — HTML/GSAP layer

**What to implement.**

1. `caption_cfg()` (`hyperframes_caption_html.py:49-116`) already forwards
   `"textColor": config.text_color` (`:76`) and the bg colour — **no key changes**; the
   gradient string flows through as-is.
2. Background box (`:467 bg.style.background = CFG.bgColor`) — a `linear-gradient(...)`
   string is a **valid `background` value verbatim**. This is likely a zero-line change;
   confirm by rendering, do not assume.
3. Text spans (`:498 m.el.style.color`, `:222 .cw { color: … }`) — a gradient is not a
   valid `color`. Branch: when `GRADIENT_RUNTIME_JS.parse` returns a spec, set
   `background-image` + `background-clip:text` + `-webkit-text-fill-color:transparent`, and
   compute `background-size`/`background-position` from the span's offset **within the
   caption block** so the gradient is anchored to the block (matching Phase 2), not to each
   span. The runtime already positions every word absolutely, so those offsets exist.
4. RSVP (`hyperframes_rsvp_runtime.py:316`, `:328`, three-piece active word at `:331-345`)
   — same branch, per span.

**Verification checklist**
- [ ] `CAPFORGE_PARITY=1 .venv-dev/bin/python -m pytest backend/tests/test_caption_parity.py -v` — all ~17 existing tests still green.
- [ ] New `test_gradient_text_parity` and `test_gradient_bg_parity` inside the existing tolerances (mean abs diff < 8.0, notable < 5%, bbox ±3px). **Do not loosen the tolerances** — `docs/caption-parity.md` records the accepted deltas and a new one needs its own justification in that doc.
- [ ] Explicitly render and eyeball gradient + `stroke_width > 0` and gradient + `shadow_enabled` — `-webkit-text-fill-color: transparent` composing with `-webkit-text-stroke` and `text-shadow` is the assumption most likely to be wrong.
- [ ] **Bump `SCAFFOLD_VERSION`** (per `CLAUDE.md` → HyperFrames Integration) — the embedded caption runtime changed shape, so the fingerprint cache must invalidate.

**Anti-pattern guards**
- ❌ Do NOT interpolate the user's gradient string into CSS without going through `parse_gradient` first — a `.cfpreset` is an import trust boundary (`electron/preset-io.js`) and CSS injection into the render page is the exact class of bug that guards against.
- ❌ Do NOT use `power2` easing anywhere new — the shared quadratic is GSAP `power1.out` (the ease-naming trap in `docs/caption-parity.md`).

---

## Phase 5 — UI, sanitizer, and the pipeline files

**What to implement.**

1. **`ColorSwatch`** (`src/renderer/src/components/ui/ColorSwatch.tsx`, props
   `{ label, value, onChange }`, hex validated at `:44`) gains a Solid/Gradient toggle in
   its popover: two-or-more stop rows reusing `<input type="color">`, an angle control, and
   a live preview strip. It must still round-trip a plain hex unchanged.
2. **`ColorsCard.tsx`** — no structural change; `Text` (`:11`) and `BG` (`:20-22`) pick up
   the new mode for free. Leave `Outline`/`Active`/`Shadow` on the solid-only path.
3. **`lib/settingsSanitize.ts`** — its `HEX_COLOR_RE` (`:120`) and `COLOR_SETTINGS` (`:108`,
   currently `{'rsvpFocusColor'}`) define the repair path. Enrol `textColor` and `bgColor`
   with a validator that accepts hex **or** a `parse_gradient`-valid string. Note the
   file's own comment (`:95-98`): enrolling pre-existing colours changes what an agent's
   `set_settings` may write — that is now a deliberate, in-scope decision, so say so in the
   comment you edit rather than silently widening it.
4. **`lib/settingsSearch.ts`** — no new settings under Option A, so `CARD_SETTINGS`/
   `SETTINGS_REGISTRY` need only a keyword pass (add `'gradient'` to the `Text` and `BG`
   entries at `:143-146` so settings search finds the feature).
5. **`lib/render.ts:100`** — unchanged (`text_color: settings.textColor` already carries it).
6. **`backend/models/schemas.py:148,150`** — the fields stay `str`. Update the `description=`
   text so the schema documents the accepted gradient syntax; that description is what the
   MCP agent reads.
7. **`docs/caption-parity.md`** — add a "Gradient fills" section: the encoding, the
   gradient-line formula, the three core sites, the fixture, and the deferred list above.
   This doc is the contract; a parity feature that is not in it will be broken by the next
   change.

**Verification checklist**
- [ ] `npm run typecheck && npx vitest run && npm run lint`
- [ ] `.venv-dev/bin/python -m pytest backend/tests` **and** `.venv-dev/bin/python -m pytest mcp_server/tests` (a bare `pytest` silently skips the latter — `pyproject.toml` `testpaths`)
- [ ] `test_caption_cfg_contract.py` green with **no new partition entries** — if it demands one, Option A leaked into Option B somewhere.
- [ ] Export a `.cfpreset` with a gradient → import it into a fresh profile → the gradient survives (`electron/preset-io.js` is untouched, so this proves the pass-through claim).
- [ ] Save/reopen a `.cfproj` with a gradient.
- [ ] MCP `set_style({textColor: 'linear-gradient(90deg,#FF0080 0%,#7928CA 100%)'})` applies; `set_style({textColor: 'javascript:alert(1)'})` is rejected without poisoning the mirrored config (the failure mode `docs/plans/font-list-preset-restore-fixes.md` documents).

---

## Phase 6 — Final verification

1. **Documentation match** — re-read `docs/caption-parity.md` and confirm every gradient
   formula in it matches the three implementations, by opening all three, not by memory.
2. **Anti-pattern grep**
   - `grep -rn "linear-gradient" backend src --include=*.py --include=*.ts | grep -v test` — every hit is either the shared core, a validated pass-through, or the UI.
   - `grep -rn "createLinearGradient" src/renderer/src/hooks` — no call inside a per-word loop.
   - `grep -rn "power2" backend/exporters src/renderer/src/hooks` — no new hits.
   - Confirm exactly 3 definitions of the gradient core and 1 fixture.
3. **Full gates**
   - `npm run typecheck && npx vitest run && npm run lint`
   - `.venv-dev/bin/python -m pytest backend/tests && .venv-dev/bin/python -m pytest mcp_server/tests`
   - `CAPFORGE_PARITY=1 .venv-dev/bin/python -m pytest backend/tests/test_caption_parity.py -v`
   - Goldens: all 13 pre-existing pass **unregenerated**; 2 new ones reviewed by eye.
4. **Manual QA in the app** (the gates cannot see pixels): preview vs exported MP4 vs
   HyperFrames render, same gradient, at 0°/45°/90°, wrap and RSVP, with and without
   outline and shadow.
5. **Note the CI blind spot:** `eslint.config.js` ignores `electron/**`, so a green lint
   says nothing about the Electron layer. This change should not touch it — if it does,
   that is a signal Option A leaked.

---

## Effort

| Phase | Session |
|---|---|
| 1 — shared core + fixture | ~1 |
| 2 — Pillow + goldens | ~0.5 |
| 3 — Canvas | ~0.5 |
| 4 — HTML/GSAP + parity | ~1 |
| 5 — UI + sanitizer + docs | ~1 |
| 6 — verification + manual QA | ~0.5 |

Phases 2–4 are independently shippable behind a "flat hex only" fast path — a half-done
gradient feature renders exactly as today rather than breaking, which is the property that
makes this safe to land incrementally.

---

## As built (2026-09-04)

Implemented across all six phases. Where the result differs from the plan above, the
reason:

- **`flat_color` was added to the shared core.** The plan only anticipated `flat_hex`.
  But `highlight_text_color` and a per-word `word_bg_color` both *inherit* `bg_color`, and
  neither can hold a gradient — snapping them to the schema default would be arbitrary, so
  a gradient reads as its **first stop** for every flat-only consumer.
- **Crossfade words are flat in all three renderers**, rather than "gradient at rest".
  The HTML layer animates `color`, which a `background-clip: text` fill hides, so
  "gradient at rest, flat mid-blend" was not expressible there; a three-way-consistent
  rule beat a nicer two-way one.
- **The HTML layer needed two mechanisms, not one.** Wrap mode anchors per span (spans
  never move); RSVP anchors on the static `.crsvp-band`, because its row *slides* and a
  per-span fill would travel with the word while Pillow's stays fixed in frame space.
- **One accepted delta, characterised rather than assumed.** Gradient text + a text
  outline diverges because CSS paints a background-clipped fill *below* the stroke while
  Pillow paints the fill on top. Measured, budgeted per stroke width (2px at the standard
  budget, 4px → 6%, 8px → 11%) and written into `docs/caption-parity.md`. Gradient +
  drop shadow, which the plan flagged as the likelier problem, passed the standard
  tolerance unchanged.
- **`DEFAULT_TEXT_COLOR`/`DEFAULT_BG_COLOR` moved into `lib/renderConstants.ts`.** The
  sanitizer cannot import `StudioPanel` at runtime (a cycle through `presets.ts`), so the
  two defaults now have one home instead of being duplicated.
- **Canvas got a numeric cross-check.** The plan left Canvas to manual QA; instead its
  rasterisation was compared against Pillow's in a real browser (21 probes, worst channel
  delta **3/255**) and the Pillow half is pinned by
  `test_gradient_rasterisation_matches_fixture`.

Still open, as planned: **manual in-app QA** — preview vs exported MP4 vs HyperFrames
render, wrap and RSVP, with and without outline and shadow.
