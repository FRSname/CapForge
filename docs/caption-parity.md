# Caption rendering parity contract

> Extracted from `CLAUDE.md`. Read this before changing **any** caption rendering formula.

There are **three** caption renderers that must produce visually identical output, and changing any rendering formula means updating **all three in lockstep**:

1. **Canvas preview** — `src/renderer/src/hooks/useSubtitleOverlay.ts` (what the user sees in-app)
2. **Pillow render** — `backend/exporters/video_render.py` `_render_frame()` (the classic exported video; the source of truth)
3. **HTML/CSS/GSAP caption layer** — `backend/exporters/hyperframes_caption_html.py` (what the HyperFrames engine renders for co-author mode + native captions). It ports the Canvas geometry/animation into a config-driven JS runtime so HyperFrames captions match the panel exactly.

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

## Accepted deltas (documented — do not "fix")

- Stroke join geometry (Canvas `round` vs PIL miter vs CSS).
- The shadow-blur kernel (Pillow `GaussianBlur(radius=blur/2)` matches the CSS/canvas spec sigma).
- Mid-entry frames of animations over a translucent bg box — the browser flattens group opacity while Canvas/Pillow stack per-element alpha, so overlapping translucent pixels legitimately differ for the few entry/exit frames.

## Tests

- **Golden frames**: `backend/tests/test_render_golden.py` pins `_render_frame()` pixel output against PNGs in `backend/tests/golden/` (tolerance-based diff). Regenerate after an intentional formula change with `.venv-dev/bin/python -m backend.tests.gen_golden`, then review the PNGs visually before committing — they define what "correct" looks like.
- **Caption parity**: `backend/tests/test_caption_parity.py` diffs the Pillow render against the live HyperFrames snapshot for every word mode + stroke/shadow/multi-line, plus per-word overrides, highlight slide, mid-entry group ease, and 1080p/portrait resolutions. Each comparison also asserts the caption **bounding-box extents** agree within 3px per edge (catches few-px drift the loose mean/notable tolerances hide). Opt-in (needs Node 22 + ffmpeg):

  ```bash
  CAPFORGE_PARITY=1 .venv-dev/bin/python -m pytest backend/tests/test_caption_parity.py
  ```

- **HyperFrames snapshots**: the CLI (≥ 0.7.25) saves extra unrequested frames (auto end-of-timeline). `snapshot_hyperframes_project()` picks the PNG whose `frame-NN-at-<t>s.png` filename time is closest to the requested `t` — never "newest file". See [hyperframes-integration.md](hyperframes-integration.md).
