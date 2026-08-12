# Caption rendering parity contract

> Extracted from `CLAUDE.md`. Read this before changing **any** caption rendering formula.

There are **three** caption renderers that must produce visually identical output, and changing any rendering formula means updating **all three in lockstep**:

1. **Canvas preview** — `src/renderer/src/hooks/useSubtitleOverlay.ts` (what the user sees in-app)
2. **Pillow render** — `backend/exporters/video_render.py` `_render_frame()` (the classic exported video; the source of truth)
3. **HTML/CSS/GSAP caption layer** — `backend/exporters/hyperframes_caption_html.py` (what the HyperFrames engine renders for co-author mode + native captions). It ports the Canvas geometry/animation into a config-driven JS runtime so HyperFrames captions match the panel exactly.

There are **two layout modes**, selected by `reading_mode`: the default `'wrap'` (rows of wrapped words, which every `word_transition` decorates) and `'rsvp'` (a single sliding line with the focus glyph pinned to a pivot column). Each renderer implements both — see [RSVP reading mode](#rsvp-reading-mode) below.

## Key equivalences

- Canvas `measureText().width` ↔ PIL `font.getlength()` (NOT `textbbox` — that strips side bearings). The HTML runtime measures with the same canvas `measureText('Ayg')` approach.
- **No bold synthesis**: Pillow cannot fake-bold a regular TTF. The Bold toggle was removed — users pick a font variant directly (e.g. `Inter-Bold.ttf`). All three renderers use `font-weight: normal` / the font file as-is (the HTML layer embeds it via `@font-face`).
- **Font parity for the HTML layer (word-spacing correctness)**: the HTML caption layer has no CSS word spacing — every word is `position:absolute` and placed by a JS cursor (`wx += measureWord() + measureText(' ')`). So spacing is only correct if the render browser measures the *right* font at the *right* time. Two invariants keep it honest: (1) `_font_face_block` (`hyperframes_project.py`) embeds the **exact file Pillow rasterizes** via `resolve_font_file()` (`video_render.py`) — even for bundled/system fonts the user picked by name, which the headless render machine otherwise lacks; (2) `__capWhenFontsReady` (`hyperframes_caption_html.py`) **defers `__capBuild` + `__timelines` registration until `document.fonts` loads** (raced against a 3s timeout), because measuring before the `@font-face` decodes bakes fallback-font widths → captions render in the right glyphs but mis-spaced ("connected words"). The CLI polls for `window.__timelines["root"]` and reads frame count from `#root`'s `data-duration`, so deferring registration is safe.
- All three use the same formulas for row gap, background box sizing, word positioning, animation curves, and every `word_transition` mode (highlight/instant/crossfade/karaoke/underline/bounce/scale/reveal/none).
- **Per-word overrides are part of the contract**: the HTML payload carries a per-word `"o"` object (`_WORD_OVERRIDE_KEYS` in `hyperframes_caption_html.py` — exactly the keys Pillow honors; `custom_font_path` deliberately excluded, per-word fonts are embedded server-side via the same `resolve_font_file()` mechanism as the main font). `highlight_animation: 'jump'|'slide'` is implemented in all three; slide lerps the pill from the previous word's rect with `t_ease = 1-(1-clamp(raw_t*2.5))²` and is **row-local** (never slides across a line break).
- **Per-group position overrides are part of the contract too**: a group dict may carry `position_x`/`position_y` (sparse fractions 0–1 on the `CustomGroup` schema; absent/None = use the config's global position) that move that group's caption anchor in all three renderers. The HTML payload carries them as a sparse per-group `"pos"` object alongside the per-word `"o"`. Pinned by the `group_pos_top` golden frame and `test_group_position_parity`.
- **GSAP ease naming trap**: the shared quadratic curve `1-(1-t)²` is GSAP `power1.out` (`power1` = quad, `power2` = cubic). Group enter/exit and the highlight slide all use `power1.*` — "upgrading" them to `power2` reintroduces a real mid-animation divergence the parity suite catches.
- **DOM span vertical placement**: the browser puts a span's baseline at half-leading + FONT ascent (`spanBaseline()` in the runtime), NOT at the ink ascent — using ink ascent renders text ~8px off for fonts whose ascent+descent ≠ 1em (CaviarDreams). Pillow anchors on the font ascender line, so `font_size_scale` override words additionally shift by the scaled-vs-base ascender→ink gap delta — Canvas and the HTML runtime both reproduce that (`gapBase`/`m.gap`).
- Shared magic numbers live in `lib/renderConstants.ts` — the backend receives them via the render config (e.g. `crossfade_duration`), so they stay synced automatically.

## Gap closing (upstream of all three renderers, never inside one)

A group's `end` is stretched to the next group's `start` when the gap is short (`gap <= threshold`, inclusive), and the final group is held past its last word, *before* any renderer sees the groups — `closeGroupGaps` (`lib/groups.ts`) on the frontend, its Python twin `_close_group_gaps` applied inside `_build_groups`.

Deliberately **not** a rendering formula, so the three renderers need no edits. But the **two implementations of the pass are themselves a lockstep pair** — same rule order, same inclusive boundary, same speaker guard (never bridge a diarization change), same non-finite-timing guard — pinned by a shared fixture + literal expected-ends table in `lib/groups.gaps.test.ts` and `backend/tests/test_group_gap_closing.py`.

- **Exactly one application per path**: the `custom_groups` payload is already closed by the frontend before it is sent, so every backend site **must** go through `groups_for_render()` (`video_render.py`), which bypasses the pass for `custom_groups` — the tail hold is *not* idempotent, so a second site double-holds the last caption.
- **Derived, never baked**: writing the closed groups back into group state flips `groupsEdited`, makes `reconcileGroups` Rule 5 carry the held end forward as a manual bound, and compounds the hold once per edit — hence `displayGroups` (a `useMemo` in `ResultsScreen`) while the editors keep the raw groups.
- A group whose `end` the user placed by hand carries `endEdited` (frontend-only, stripped from the render payload by `render.ts`) and is exempt from both dials.

## RSVP reading mode

**A layout axis, not a `word_transition`.** `reading_mode` (`'wrap' | 'rsvp'`, default `'wrap'`) is orthogonal to `word_transition`. All nine `word_transition` modes decorate words *after* layout is fixed; RSVP replaces layout itself, so it is deliberately **not** a `word_transition` value, is **not** per-word overridable, and must never appear in `types/app.ts`'s `WordTransition` union or in `WordStylePopup.tsx`. "Make *this one word* use RSVP" is meaningless — RSVP is a property of the whole line.

The mode draws the group as one unwrapped line that **slides horizontally** so a single letter of the active word — the Spritz Optimal Recognition Point (ORP) — always lands on a fixed pivot column. The eye never moves; the text moves under it.

**Three implementations, one shared scalar core.** The core (ORP table, code-point slicing, eased line offset, the colouring anchor) is duplicated in exactly three places and nowhere else:

| Renderer | Core | Layout / draw |
|---|---|---|
| Pillow (source of truth) | `backend/exporters/rsvp.py` | `backend/exporters/rsvp_layout.py` (+ the `is_rsvp` branches in `video_render.py`) |
| Canvas preview | `src/renderer/src/lib/rsvp.ts` | `lib/overlayGeometry.ts` (`computeRsvpPositions`) + `hooks/useSubtitleOverlay.ts` |
| HTML/GSAP | `RSVP_RUNTIME_JS` in `backend/exporters/hyperframes_rsvp_runtime.py` | `RSVP_BUILD_JS` in the same module, emitted by `hyperframes_caption_html.py` |

The three cores are pinned against **one another** by the five shared JSON fixtures in `backend/tests/fixtures/rsvp_*_cases.json`, read by `backend/tests/test_rsvp_core.py`, `lib/rsvp.test.ts` and `lib/rsvp.embedded.test.ts`. Never hand-write an expected value in one language — add it to the fixture.

### Continuous flow: reels

**The unit of layout is a reel, not a caption group.** A group is a display chunk of `words_per_group` words; laying the line out per group means that at every chunk boundary the line is rebuilt from zero and snaps to its first word (`lineOffsetAt` never eases index 0), the words already read vanish, and the group entry animation fires again. So consecutive groups that are **continuous in time** are merged into one group — a *reel* — before any renderer sees them, and crossing a group boundary becomes one more eased slide.

```
break between groups a, b  iff  a.end or b.start is non-finite      (never join on junk)
                            or  a.end < b.start                     (a real blank gap)
                            or  their position overrides differ     (a reel has one anchor)
```

Rule 2 is deliberately the *existing blanking rule*: a frame between `a.end` and `b.start` has no active group and draws nothing today, so joining exactly the pairs with no such frame adds continuity **without changing when captions appear or disappear**. Gap closing runs upstream and has already pulled `a.end` up to `b.start` for every gap at or below `gap_close_threshold` — so that dial is what decides how long a reel gets, and at 0 the pass is the identity and RSVP behaves exactly as it did per group. A **speaker change is not a break**: gap closing already refuses to bridge one, so any real pause between speakers breaks the reel anyway, and `CustomGroup` carries no `speaker` — a rule on it would fire in the preview and not in the render.

Like gap closing, this is a group-list transform rather than a rendering formula, so it has **two** implementations, not three:

| Side | Where | Applied at |
|---|---|---|
| Pillow **and** HTML/GSAP | `backend/exporters/rsvp_reels.py` | `groups_for_render()` — the one point every render path shares, so the HTML layer is simply handed merged groups and emits one `.cgroup` per reel |
| Canvas preview | `src/renderer/src/lib/rsvpReels.ts` | `useSubtitleOverlay`, over the same gap-closed `displayGroups` |

Both read the same fixture, `backend/tests/fixtures/rsvp_reel_cases.json`, which pins the break rule as index ranges over a normalised group view (each side asserts its own merge output). Everything downstream is unchanged: the active-group lookup, the entry/exit animation (now per reel, which is the point), the background box and the per-word overrides all operate on the reel.

**Culling.** A reel's line is as long as the run of speech it carries, so most of it is nowhere near the frame. Pillow and Canvas therefore skip words outside a visible window; the HTML layer culls nothing, because its edge-fade mask already produces the same pixels. That makes the cull a claim rather than a choice — **it must be pixel-neutral** — so the window is deliberately loose:

```
window = band                when rsvp_edge_fade > 0   (the mask zeroes everything outside)
       = [0, resolution_w)   when it is 0              (an unmasked line may overflow the band)
bleed  = textH × 8 + stroke + shadowBlur + |shadowOffsetX| + max|pos_offset_x|
```

`RSVP_CULL_BLEED_EM = 8` absorbs the decorations whose exact ink extent is not worth reproducing in two languages (per-word box padding and extras, an overhanging face, stroke joins); the three scalars that can move ink an unbounded distance are added exactly. Twins: `rsvp_layout.cull_bleed`/`visible_window`/`visible_range` ↔ `overlayGeometry.rsvpCullBleed`/`rsvpVisibleWindow`/`rsvpVisibleRange`, pinned by the `cull` section of the generated Canvas↔Pillow fixture and asserted from both sides. `backend/tests/test_rsvp_reels_render.py` additionally renders a reel with the cull disabled and diffs the bytes.

**Layout caching.** Measuring every word of a reel per frame is the one cost that grows with the reel, so the time-independent half of the line (`static_layout` / `computeRsvpStatic`: cumulative `wordX`, `focusOffsets`, `max|pos_offset_x|`) is computed once per reel — `_render_frame`'s `precomp` dict on the backend, `layoutRef` in the hook. Measured on a 900-word reel at 1080×1920: **140 ms/frame** naive, **39.6** with the cull, **9.7** with both, against **8.7 ms/frame** for a 3-word group. An optimisation only: both are asserted byte-identical to the uncached, unculled path.

**The frame cache.** `_frame_state_key` keys RSVP frames on `("rsvp", group_index, anchor_index)` and returns `None` (uncacheable) inside a slide window. It must not use the wrap path's per-word Future/Active/Past states: those are constant for the whole time a word is active while `line_x` eases across the first `rsvp_slide_duration` of it, so the first mid-slide frame would be cached and replayed for the rest of the word — the line visibly freezing part-way through every slide. Pinned by the `rsvp*` scenarios in `test_render_dedup.py`.

### The formulas

```
focusOffset(i) = wordX[i] + measure(token[:f]) + measure(token[f]) / 2     where f = orpIndex(token)
lineX(t)       = pivot − focusOffset(anchor)
```

Words are drawn at `wordX[i] + lineX`, so **one scalar carries the whole animation** — which is what makes three-way parity tractable. `lineX` is eased between consecutive words over `rsvpSlideDuration` with the repo's shared quadratic ease-out `1 − (1−p)²` — GSAP **`power1.out`**, *not* `power2` (see the ease naming trap above). The HTML layer applies it as `transform: translateX()` on the `.crsvp-row` container and lets GSAP tween it; it never absolutely re-positions words per frame.

### The Spritz ORP table

| Token length | Focus index (0-based) |
|---|---|
| ≤ 1 | 0 |
| 2 – 5 | 1 |
| 6 – 9 | 2 |
| 10 – 13 | 3 |
| ≥ 14 | 4 |

Confirmed 9/9 against the reference clip. Two contract details:

- **Token length counts punctuation** — Spritz tokenizes on whitespace, so `saccades,` is length 9 → index 2.
- **Indexing is by Unicode code point after NFC normalisation**, never by UTF-16 code unit. `"🎬clap"` is 5 code points but 6 code units (index 1 vs 2), and `'a🎬b'[1]` is a lone surrogate. The Python `str` is the reference; both JS twins go through a `codePoints()` helper (`Array.from(token.normalize('NFC'))`).

### The caption band

Everything RSVP places horizontally — pivot, reticle, edge-fade ramp **and the group background box** — derives from one band, which is deliberately the width concept the wrap path already enforces rather than a new one:

```
band.width = resolution_w × max_width
band.left  = rowCenterX − band.width / 2
pivot      = band.left + rsvpPivotX × band.width
```

`rowCenterX` is the `center_x` `_draw_word_list` is handed (group/global `position_x` anchor + `text_align_h` slack + `text_offset_x`), so band, text, box and guides always sit on the same column. This reproduces the reference clip: a 1320-wide frame at `max_width` 0.9 / `position_x` 0.5 gives a 1188 px band spanning x 66→1254 (measured 66→1260), and the measured pivot of 479 ± 2 px is `413/1188 = 0.3476` of the band — i.e. the `0.35` default to within the dial's rounding.

The background box is derived from `band.width` and centred on the band, **not** clamped from the row (`max_row_w = box_band.width`, never `min(max_row_w, max_w_px)`): the row is unwrapped and can exceed the frame, while a group *narrower* than the band must still get a band-sized box, because its text is placed by the pivot rather than by the row centre.

### The single anchor rule

The coloured word and the line's position both come from **`lastStartedIndex`** — "the last word with `start <= t`" — and deliberately **not** from the `start <= t < end` test the decoration modes use. `draw_line()` does not take an `active_idx` at all, so there is no second rule for the other two renderers to reproduce.

Two reasons, both real failure modes:

- In inter-word silence and in the tail after the last word's `end` there is no `start <= t < end` answer at all, so that test would drop the glyph parked on the pivot to context colour mid-hold instead of holding.
- Where the two rules merely *disagree* — overlapping word timings, or a manually reordered group (which ships `custom_groups[].words` verbatim, so `start` values need not ascend) — `start <= t < end` colours a word that is **not** on the pivot, leaving the reticle marking an empty column. Measured: it drew the focus glyph 100+px off the pivot for a reordered group.

Pinned by `rsvp_last_started_cases.json` and by the `anchorCases` in the Canvas parity fixture, which assert the two rules genuinely disagree so the cases can't go vacuous.

### The tracking gap

The renderers' word-measurement primitive (`_measure_tracked` / `measureTrackedWidth`) counts **`n − 1`** inter-character gaps, so a *prefix* measurement is exactly one `tracking` short of the pen position of the character that follows it. `focusOffset` takes a single `measure` callback and cannot express that, so the one missing gap is added from a shared helper (`_tracking_gap` / `rsvpTrackingGap`) at **both** the layout site and the three-piece pen walk — one helper, so the two cannot drift. With `tracking == 0` (the default) it is 0 and both reduce to a plain prefix measurement. Drop it and the focus glyph misses the pivot by exactly one `tracking`.

### The reticle

A short rule with an inward-pointing notch, above and below the line, centred on the pivot in `rsvpFocusColor`. Every dimension is a multiple of the line's text height so it scales with font size instead of needing a second set of dials: `RETICLE_RULE_LEN_EM = 1.10`, `RETICLE_THICKNESS_EM = 0.055` (floored at 1 px), `RETICLE_GAP_EM = 0.32` clearance from the text box, `RETICLE_NOTCH_LEN_EM = 0.20`.

**Inclusive-vs-exclusive box convention**: `ImageDraw.rectangle` includes *both* endpoints, while Canvas `fillRect(x, y, w, h)` and a CSS box are exclusive at the far edge. Handed to Pillow verbatim, every guide box drew 1 px wider and 1 px taller than the constants say (measured: a floored 1 px thickness drew 2 px; a 66.00 px rule drew 67). So Pillow routes every RSVP guide box through `_fill_box`, which fills the **half-open** `[x0,x1) × [y0,y1)` — the drawn size *is* the EM formula, and Canvas/HTML use the constants unmodified. It also makes each rule and its notch exactly contiguous instead of overlapping by a pixel.

The reticle is **exempt from the edge fade**: it is a fixed guide painted on the frame, not text sliding inside the band, so it must stay crisp wherever the pivot is. Pillow draws it to its own unmasked target; Canvas draws it outside the masked composite.

### Settings RSVP ignores

- `lines` — forced to 1 (one unwrapped row, however wide).
- `alignment` (`text_align_h`) — no longer positions text *inside* the row (the pivot governs), but it is **not inert**: it still feeds `align_shift_x`, which moves `rowCenterX` and therefore the whole band (box, pivot, reticle, fade) whenever `bg_width_extra` opens up slack.
- `word_transition` and its sub-settings (`highlight_*` — there is no pill — `underline_*`, `bounce_strength`, `scale_factor`) — RSVP owns word colouring.

Group entry/exit `animation` **still applies** to the line as a whole. Per-word overrides still honoured: `text_color`, `active_word_color`, the four font keys (the word is measured *and* drawn in its own font, so its focus glyph still lands exactly on the pivot), `pos_offset_x/y`, and the nine `word_bg_*` keys.

### RSVP accepted deltas (documented — do not "fix")

1. **Kerning across the active word's three seams.** The active word is drawn as prefix / focus glyph / suffix so the focus glyph can be coloured and placed exactly, which loses kerning across the two seams. Same class as the karaoke branch's split draw. Context words stay one kerned string in all three renderers.
2. **The base-font word-advance asymmetry** (pre-existing in wrap mode): each word's *line advance* comes from `word_metrics[i]["width"]`, measured with `config.font_family` even when the word overrides `font_family`. This shifts the words *after* a font-overridden word — never the focus glyph, which is solved from the same pieces it is drawn from.
3. **A decomposed token's NFC residual.** The active word is drawn from `focusSlices`, i.e. NFC-composed, while its line advance comes from the raw token and context words are drawn raw; for a decomposed token the two forms can differ by a fraction of a pixel, moving the words after the active one. A combining mark with **no precomposed form** (e.g. `a` + U+0348) still shatters — normalisation cannot compose what Unicode has no composed form for.
4. **Chromium does not apply the GPOS kerning PIL does.** Pre-existing and mode-independent — wrap mode shows the same edge deltas on a kerned pair (measured ~7 px) — so this file's `measureText ≡ getlength` equivalence has a kerning exception. **Reels make it accumulate further**: word advances are summed into `wordX`, so the per-word difference compounds with distance from the anchored word (which is pinned to the pivot in both renderers). It is bounded by the *visible window*, not by the reel length — words beyond it are culled or faded — but a reel legitimately shows more of it than a 3-word group did. Measured on the cross-boundary parity case: a 3px right-edge delta against a 3px budget, versus 0–1px for the single-group cases. It also means the parity gate cannot currently *discriminate* whole-token vs pre-split spans, which is why the HTML layer keeps whole-token spans for context words: that choice stays correct if the gap is ever closed, and costs nothing today.
5. **Canvas-only, from having one canvas instead of Pillow's layer stack.** With the edge fade on: the reticle composites *below* the per-word background boxes instead of above them (one canvas cannot mask a middle slice of the layer stack; both are behind the text either way, and they only overlap when a box's padding reaches past the reticle's 0.32em clearance); the fade is applied *after* the `pop` entry transform rather than before it, so the band stays in frame coordinates while the ink has already shrunk toward its centre; and the fade is a continuous gradient where Pillow steps per column, a sub-quantization difference (< 1/255 alpha) on the ramp.
6. **Tracked measurement iterates UTF-16 code units in JS, code points in Python.** Pre-existing in the shared `measureTrackedWidth` / `_measure_tracked` helpers (the ORP *core* is code-point correct in all three). Reachable only with non-zero `tracking` **and** an astral character in the same token.
7. **`rsvp_pivot_x` is deliberately not clamped away from the fade ramp.** The fade is a property of the band, so a focus column placed inside the ramp genuinely dims the focus glyph — looking through the edge of a window is what that does. At `rsvp_pivot_x = 0` with the default 12 % fade the pivot column's own alpha is 0 by construction, rising only across the glyph's right half (measured: alpha 2 one pixel in, ~17 peak across a 10 px glyph at 640 px wide), i.e. the glyph all but disappears; the reticle would have been dimmed to alpha 76, which is why it is exempt. Silently rewriting the user's value was judged worse than the visible result — the Reading card carries the warning instead.

### Running the RSVP suites

```bash
# Cross-language core (ORP table, slicing, ease, anchor) — the five shared fixtures
.venv-dev/bin/python -m pytest backend/tests/test_rsvp_core.py -q
npm test -- rsvp

# Reels: the break rule (shared fixture, both languages) + what it changes on a frame
.venv-dev/bin/python -m pytest backend/tests/test_rsvp_reels.py \
  backend/tests/test_rsvp_reels_render.py backend/tests/test_render_dedup.py -q
npm test -- rsvpReels

# Pillow layout/draw, reticle geometry, edge fade, per-word boxes, HTML layout
.venv-dev/bin/python -m pytest backend/tests/test_rsvp_layout.py backend/tests/test_rsvp_reticle.py \
  backend/tests/test_rsvp_render.py backend/tests/test_rsvp_background_box.py \
  backend/tests/test_rsvp_html_layout.py -q

# Canvas ↔ Pillow numeric fixture, asserted from BOTH sides
npm test -- overlayGeometry.rsvp
.venv-dev/bin/python -m pytest backend/tests/test_rsvp_canvas_fixture.py -q

# Golden frames (rsvp_mid_word = mid-hold, rsvp_mid_slide = mid-slide) + full parity
.venv-dev/bin/python -m pytest backend/tests/test_render_golden.py -q
CAPFORGE_PARITY=1 .venv-dev/bin/python -m pytest backend/tests/test_caption_parity.py -q
```

`backend/exporters/hyperframes_project.py`'s **`SCAFFOLD_VERSION` must be bumped** whenever the embedded RSVP runtime changes shape, or byte-identical inputs serve a stale cached preview runtime.

## Accepted deltas (documented — do not "fix")

- Stroke join geometry (Canvas `round` vs PIL miter vs CSS).
- The shadow-blur kernel (Pillow `GaussianBlur(radius=blur/2)` matches the CSS/canvas spec sigma).
- Mid-entry frames of animations over a translucent bg box — the browser flattens group opacity while Canvas/Pillow stack per-element alpha, so overlapping translucent pixels legitimately differ for the few entry/exit frames.
- The RSVP-specific deltas are listed in the RSVP section above.

## Tests

- **Golden frames**: `backend/tests/test_render_golden.py` pins `_render_frame()` pixel output against PNGs in `backend/tests/golden/` (tolerance-based diff), including `rsvp_mid_word` (a frame during a hold, where the focus glyph's centre must sit on the pivot column) and `rsvp_mid_slide` (a frame during the slide — the two differ only in `t`). Regenerate after an intentional formula change with `.venv-dev/bin/python -m backend.tests.gen_golden`, then review the PNGs visually before committing — they define what "correct" looks like. Generation is deterministic: two runs into different directories are byte-identical.
- **Canvas ↔ Pillow numeric fixture**: `src/renderer/src/lib/__fixtures__/rsvp_canvas_parity.json` is *generated* by running the Pillow reference (`gen_rsvp_canvas_parity.py`, over a synthetic per-character width table so the numbers are reproducible in JS) and *asserted from both sides* — `lib/overlayGeometry.rsvp.test.ts` checks the Canvas renderer against it, `backend/tests/test_rsvp_canvas_fixture.py` re-derives it from the live reference so a Pillow drift fails the backend suite instead of quietly leaving the frontend pinned to stale numbers.
- **Caption parity**: `backend/tests/test_caption_parity.py` diffs the Pillow render against the live HyperFrames snapshot for every word mode + stroke/shadow/multi-line, plus per-word overrides, highlight slide, mid-entry group ease, 1080p/portrait resolutions, and five RSVP cases (mid-hold boxed, mid-slide box-off, **a frame past a group boundary inside a reel**, per-word overrides, scaled anchor). Each comparison also asserts the caption **bounding-box extents** agree within 3px per edge (catches few-px drift the loose mean/notable tolerances hide). Opt-in (needs Node 22 + ffmpeg):

  ```bash
  CAPFORGE_PARITY=1 .venv-dev/bin/python -m pytest backend/tests/test_caption_parity.py
  ```

- **HyperFrames snapshots**: the CLI (≥ 0.7.25) saves extra unrequested frames (auto end-of-timeline). `snapshot_hyperframes_project()` picks the PNG whose `frame-NN-at-<t>s.png` filename time is closest to the requested `t` — never "newest file". See [hyperframes-integration.md](hyperframes-integration.md).
