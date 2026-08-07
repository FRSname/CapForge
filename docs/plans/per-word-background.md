# Per-word background (the BG function, scoped to one word)

**Goal:** take the existing **Background** studio card — BG opacity, BG radius, BG width +,
BG height +, Margin H, Margin V — and make it settable on an **individual word**, so a single
word can carry its own background box instead of only the whole caption group having one.

**Status:** planned, not started.

---

## What this is (and what it is not)

Today the background box is **per-group**: one rounded rect sized to the whole caption block,
drawn once behind all the words (`bg_opacity`, `bg_color`, `bg_corner_radius`, `bg_padding_h/v`,
`bg_width_extra`, `bg_height_extra`). This plan adds a **per-word** instance of that same
function: a box sized to one word's measured extents, using the same fields, the same geometry
family, and the same draw layer.

**Inheritance rule (this is the core design decision):** every per-word field falls back to the
matching **global** background value when unset — exactly how `highlight_*` / `underline_*`
overrides already fall back to their global counterparts. The single field that *enables* the
box is **`word_bg_opacity`**: `> 0` draws it, absent or `0` does not. So "give this word a
background at 70%" is one field; everything else inherits the look the user already configured.

**Not in scope:**
- Changing the group box. The group background keeps working exactly as it does; a word box
  draws *on top of* it. (If the user later wants "word box instead of group box", that is a
  suppression flag, not a redesign — one extra key.)
- Align H / Align V / Offset X / Offset Y from the Background card's "Text in BG box" section.
  Those position *text inside the group box* and are meaningless for a box sized to one word.
  The word box gets its own `word_bg_offset_x/y` instead, for nudging the box off the word.
- Presets. Per-word overrides live in **project data, not presets**
  (`CLAUDE.md` → Key Conventions → Shareable presets). Do **not** touch `lib/presets.ts`.
- Per-word highlight-pill color. Related but separate — see the appendix.

---

## Phase 0 — Documentation discovery (COMPLETE — findings below)

This is the "Allowed APIs" list. Every later phase cites it. Do **not** re-derive it; do **not**
invent fields that are not listed here.

### 0.1 The global background fields, end to end

| Studio card control | `StudioSettings` (`StudioPanel.tsx:31-107`) | default | `render.ts` mapping (~86-97) | `VideoRenderConfig` (`schemas.py:147-162`) |
|---|---|---|---|---|
| BG opacity | `bgOpacity` | `0` | `bg_opacity: bgOpacity / 100` | `bg_opacity: float = 0.9` (0–1) |
| BG radius | `bgRadius` | `16` | `bg_corner_radius` | `bg_corner_radius: int = 16` |
| BG width + | `bgWidthExtra` | `0` | `bg_width_extra` | `bg_width_extra: int = 0` |
| BG height + | `bgHeightExtra` | `0` | `bg_height_extra` | `bg_height_extra: int = 0` |
| Margin H | `marginH` | `8` | `bg_padding_h` | `bg_padding_h: int = 40` |
| Margin V | `marginV` | `8` | `bg_padding_v: marginV ?? DEFAULT_PAD_V` | `bg_padding_v: int = 16` |
| (color, other card) | `bgColor` | — | `bg_color` | `bg_color: str = "#D4952A"` |

UI source: `src/renderer/src/components/studio/sections/BackgroundCard.tsx:22-156`.
Control pattern: `<Row label=…><StudioRow label value min max unit def onChange/></Row>`.

⚠️ **Unit trap:** `bgOpacity` is **0–100** in `StudioSettings` and divided by 100 in
`buildRenderBody()`. Per-word keys are passed through **verbatim** (see §0.3) — there is no
divide-by-100 site for them. So `word_bg_opacity` must be stored **0–1** even though the popup
displays a 0–100 % slider. Convert in the popup, not in `render.ts`.

### 0.2 The per-word override contract has FOUR synchronized definitions

Adding an override key means editing all four, or the contract test fails:

1. **`WordOverrides`** — `src/renderer/src/types/app.ts:8-33`. TypeScript interface, already in
   **snake_case** (the one place `render.ts` does not rename).
2. **Pillow reads** — `backend/exporters/video_render.py`, in `_draw_word_list()` under the
   comment marker `# --- per-word overrides ---` (~line 541), plus the highlight-pill block
   (~462-468, `active_ov.get(...)`). That comment says outright:
   *"Add/remove an `ov[...]` read here → update BOTH of those."*
3. **`_WORD_OVERRIDE_KEYS`** — `backend/exporters/hyperframes_caption_html.py:125-136`
   (19 keys today). Filters the HTML payload's per-word `"o"` object (~line 143).
4. **`PILLOW_HONORED_OVERRIDE_KEYS`** — `backend/tests/test_caption_cfg_contract.py:152-174`
   (21-key frozenset), with `HTML_EXCLUDED_OVERRIDE_KEYS = {"custom_font_path"}` below it.

Existing keys (do not duplicate/rename): `text_color`, `active_word_color`, `font_size_scale`,
`bold`, `font_family`, `custom_font_path`, `word_transition`, `pos_offset_x`, `pos_offset_y`,
`highlight_radius`, `highlight_padding_x`, `highlight_padding_y`, `highlight_opacity`,
`highlight_offset_x`, `highlight_offset_y`, `underline_thickness`, `underline_color`,
`underline_offset_y`, `underline_width`, `bounce_strength`, `scale_factor`.

### 0.3 No backend model changes are needed

`WordSegment` (`schemas.py:78-84`) is `word / start / end / score / speaker`; overrides ride as
an untyped dict on each word inside `custom_groups`. `render.ts` (~156-168) passes them through:

```ts
words: g.words.map((w) => ({ ...w })),
```

**Consequence: this feature requires ZERO changes to `render.ts`, `schemas.py`, and the
snake_case bridge.** The keys travel automatically once they exist on the TS interface.
Do not add a `WordOverrides` Pydantic model — the contract is enforced by tests, not schema.

### 0.4 Two existing boxes to copy from — take geometry from the pill, fields from the group box

The **group background box** owns the field semantics (§0.1). The **highlight pill** owns the
per-word geometry: it is already a per-word rounded rect that all three renderers agree on.
Copy the pill's rect, then widen it with the group box's padding/extra fields.

| Renderer | Group box | Highlight pill (per-word rect to copy) |
|---|---|---|
| Canvas (`useSubtitleOverlay.ts`) | 293-300, geometry via `computeBgBox()` (`lib/overlayGeometry.ts:149-164`) | 316-374 — `roundRect(x + offX - padX, y + offY - h/2 - padY, w + padX*2, h + padY*2, r)` |
| Pillow (`video_render.py`) | 900-905, `bg_w/bg_h` at 835-836 | 459-532, drawn onto `pill_layer` — `(x - padX, cy - h/2 - padY + offY, x + w + padX, cy + h/2 + padY + offY)` |
| HTML (`hyperframes_caption_html.py`) | 400-412, `.cbubble-bg` div | `mkPill()` ~452-474 — `left = x + ox - padX + offX; top = cyc + oy - textH/2 - padY + offY; width = w + padX*2; height = textH + padY*2` |

Group-box formula to mirror for the extras (`overlayGeometry.ts:149-164`, and identically
`video_render.py:835-836` / the HTML runtime ~382-384):

```
bgW = contentW + padH*2 + strokePad*2 + widthExtra
bgH = contentH + padV*2 + strokePad*2 + heightExtra
```

For a word box, `contentW` = that word's measured width, `contentH` = that word's **scaled**
text height — `wordScaledTextH(ov)` (Canvas ~204) / `_resolve_scaled_font()`
(`video_render.py:438-452`), so a `font_size_scale` word gets a box that hugs it.

Invariants the pill already enforces — **replicate all three**:
- **Min-pad clamp** `max(pad, stroke_width + 2)` in all three renderers, so the text outline is
  never clipped. Canvas `Math.max(ov?.highlight_padding_x ?? hlPadX, sStroke + 2)`;
  Pillow `max(w_hl_pad_x, outline_sw + 2)`; HTML `Math.max(..., sStroke + 2)`.
- **Row-awareness:** use `wordYPos[i]` / `m.cyc` per word, so each word box lands on its own row
  in a wrapped group.

### 0.5 Layer ordering (established — do not restructure)

| Renderer | Order |
|---|---|
| Canvas | group bg (293-300) → highlight pill (316) → words |
| Pillow | group bg (900-905) → `pill_layer` composited (`img.alpha_composite(pill_layer)`, 918) → shadow layer (951) → `text_layer` (954) |
| HTML | `.cbubble-bg` `insertBefore(bubble.firstChild)` (400-412) → `.cw-pill` `insertBefore(bubble.querySelector('.cw'))` (~472) → `.cw` spans |

**The word box goes on the pill layer, drawn *before* the pill** → stacking is
group bg → word box → highlight pill → words.

### 0.6 Animation alpha convention

Canvas and Pillow multiply by the group's `animAlpha` / `anim_alpha` explicitly
(`ctx.globalAlpha = bgOpacity * animAlpha`; `_hex_to_rgba(bg_color, bg_opacity * anim_alpha)`).
The HTML layer sets a plain CSS `opacity` and lets GSAP animate the parent `.cgroup`.
That asymmetry is the documented, accepted parity delta for translucent overlapping pixels on
entry/exit frames (`CLAUDE.md` → Accepted deltas). Follow the same convention; **do not** "fix"
it by multiplying alpha in the HTML runtime.

### 0.7 Anti-patterns (look right, are wrong)

- ❌ Storing `word_bg_opacity` as 0–100. It is passed through unconverted (§0.1 unit trap).
- ❌ Reusing the bare names `bg_opacity` / `bg_radius` as override keys — those already mean the
  **group** box in `VideoRenderConfig` and in the HTML `CFG` payload (`bgColor`, `bgOpacity`,
  `bgRadius`). Use the `word_bg_` prefix.
- ❌ Hardcoded fallbacks (e.g. `?? 16` for radius). Unset fields inherit the **global config
  value**, not a literal — that is the whole point of the inheritance rule.
- ❌ Adding the keys to `lib/presets.ts`, `render.ts`, or `schemas.py` (§0.3, scope).
- ❌ Adding a Pydantic `WordOverrides` model (§0.3).
- ❌ Gating the word box on `effectiveTransition`. It is transition-independent, unlike the
  `highlight_*` / `underline_*` / `bounce_*` override groups.
- ❌ Drawing it on the text layer, or after the words, in any renderer (§0.5).
- ❌ GSAP `power2.*` anywhere — the shared quadratic `1-(1-t)²` is `power1.out`
  (`CLAUDE.md` → GSAP ease naming trap).

---

## The new keys (single source of truth for Phases 1–5)

```ts
// src/renderer/src/types/app.ts — appended to WordOverrides
//
// Per-word background box — the Background card's BG function scoped to one
// word. Every field falls back to the matching GLOBAL bg_* config value when
// unset; word_bg_opacity > 0 is what enables the box at all.
// See docs/plans/per-word-background.md.
word_bg_opacity?: number       // 0–1 (NOT 0–100). > 0 enables. Global: bg_opacity
word_bg_color?: string         // hex. Global: bg_color
word_bg_radius?: number        // px. Global: bg_corner_radius
word_bg_padding_h?: number     // px, clamped to >= stroke_width + 2. Global: bg_padding_h
word_bg_padding_v?: number     // px, clamped to >= stroke_width + 2. Global: bg_padding_v
word_bg_width_extra?: number   // px. Global: bg_width_extra
word_bg_height_extra?: number  // px. Global: bg_height_extra
word_bg_offset_x?: number      // px, default 0 — no global equivalent
word_bg_offset_y?: number      // px, default 0 — no global equivalent
```

Effective-value rule, identical in all three renderers:

```
// ⚠️ ENABLE GATE — corrected during execution. opacity does NOT inherit.
//    Draw the box only when word_bg_opacity is PRESENT and > 0:
//        if (ov.word_bg_opacity == null) skip
//        if (ov.word_bg_opacity <= 0)    skip
//    (The original table read `opacity = ov.word_bg_opacity ?? cfg.bg_opacity`,
//     which contradicts this plan's own opening line — "absent or 0 does not
//     draw" — and would give EVERY word in EVERY existing project a redundant
//     box over the group box the moment the global bg is on. All three
//     renderers gate on presence.)
opacity   = ov.word_bg_opacity                            // present && > 0, no fallback
color     = ov.word_bg_color     ?? cfg.bg_color
radius    = ov.word_bg_radius    ?? cfg.bg_corner_radius
padH      = max(ov.word_bg_padding_h ?? cfg.bg_padding_h, stroke + 2)
padV      = max(ov.word_bg_padding_v ?? cfg.bg_padding_v, stroke + 2)
wExtra    = ov.word_bg_width_extra  ?? cfg.bg_width_extra
hExtra    = ov.word_bg_height_extra ?? cfg.bg_height_extra
offX/offY = ov.word_bg_offset_x/y   ?? 0
```

⚠️ **Enable-gate subtlety (clarified during execution):** `word_bg_opacity` is the *enable flag*,
so it is the one field that must **not** inherit. If it did, a word with only `word_bg_color` set
— and, worse, every word with **no overrides at all** — would resolve to the global `bg_opacity`
and silently gain a box. The gate is therefore **presence AND value**:

```
if (ov.word_bg_opacity == null) skip   // not enabled for this word
if (ov.word_bg_opacity <= 0)    skip   // explicitly disabled
```

Presence alone is not enough (an explicit `0` must not draw), and value alone is not enough
(an absent key must not draw). This is why the popup writes an explicit `word_bg_opacity` the
moment the user enables the word background (Phase 5b). The other eight fields *do* inherit
normally — they only ever matter once the gate has already passed.

⚠️ **Degenerate-rect clamp (added during execution) — required in all three renderers.**
`bgWidthExtra` / `bgHeightExtra` are user-settable down to `-50` (`BackgroundCard.tsx:51,63`) and
are inherited by default. The *group* box is immune because its content width is a whole row; a
**single word** is not — a 20px word with `padH=8`, `bg_width_extra=-50` gives
`boxW = 20 + 16 + 0 - 50 = -14`. Canvas silently fills an inverted path, but **PIL's
`rounded_rectangle` raises `ValueError` when `x1 < x0`** — i.e. this is a hard render crash in
Phase 3, not a cosmetic glitch. Every renderer must skip the box when the computed width or
height is `<= 0`, and skip zero-width words (an empty/whitespace word would otherwise paint a
free-floating blob, since this loop covers all words, unlike the pill).

⚠️ **Stroke allowance is deliberately double-counted.** The box applies both the min-pad clamp
(`pad >= stroke + 2`) *and* `strokePad*2` from the group-box formula, so with an outline set the
word box is `2 × stroke_width` larger than the highlight pill's tighter rect. That is what the
group box does, and it is intentional — **copy it verbatim into Pillow and the HTML runtime**
rather than "fixing" it, or Phase 5a parity breaks.

---

## Phase 1 — Type + contract declaration (no rendering yet)

**Implement**
1. Append the 9 keys above to `WordOverrides` (`src/renderer/src/types/app.ts:8-33`) with the
   comment block as written.
2. Add all 9 to `_WORD_OVERRIDE_KEYS` (`hyperframes_caption_html.py:125-136`) — none are paths,
   so none are excluded.
3. Add all 9 to `PILLOW_HONORED_OVERRIDE_KEYS` (`test_caption_cfg_contract.py:152-174`).
4. If `_SENTINELS` in that test needs an entry per key, add distinct non-default values — read
   the comment at ~line 185 first: each sentinel must be unique so a wrong-field read fails.

**Doc references:** §0.2, §"The new keys".

**Verification**
- `grep -o 'word_bg_[a-z_]*' <file> | sort -u | wc -l` → 9 in each. (⚠️ **corrected during
  execution**: `grep -c` counts *lines*, not occurrences, so it reports the wrong number for both
  the packed key list and the comment blocks. Use the `grep -o` form everywhere in this plan.)
- `npm run typecheck` passes.
- `.venv-dev/bin/python -m pytest backend/tests/test_caption_cfg_contract.py` → ⚠️ **the plan
  originally predicted FAIL here; that was wrong and is corrected as follows.** This test
  **PASSES** after Phase 1 and cannot do otherwise: `PILLOW_HONORED_OVERRIDE_KEYS` is a
  hand-maintained frozenset *inside the test file*, and the only assertion diffs it against
  `_WORD_OVERRIDE_KEYS`. The test never introspects `video_render.py`. Steps 2 and 3 update both
  sides of that comparison, so it is green by construction. **There is no RED step in Phase 1**,
  and a green contract test is *not* evidence that any renderer honors the keys.

**Anti-pattern guards:** no bare `bg_*` key names; nothing added to `presets.ts` / `render.ts` /
`schemas.py`.

---

## Phase 2 — Canvas preview (`useSubtitleOverlay.ts`)

Fastest feedback loop, so it goes first.

**Implement**
Insert a "per-word background boxes" block **immediately before** the
`// ── Highlight pill (drawn BEFORE words) ──` block at line 316.

- Loop over **all** words in the group (the pill loops only the active one).
- Resolve the effective values per §"The new keys"; `continue` when resolved opacity `<= 0`.
- Rect = pill rect (§0.4 Canvas column) widened by the group-box extras:
  `w + padH*2 + strokePad*2 + wExtra` × `h + padV*2 + strokePad*2 + hExtra`, where `h` is
  `wordScaledTextH(ov)`.
- Draw with `ctx.save()` → `ctx.globalAlpha = opacity * animAlpha` → `ctx.fillStyle = color` →
  `roundRect(...)` → `fill()` → `ctx.restore()`, mirroring the group-bg block at 293-300.
- **No** slide/lerp. The slide lerp belongs to the highlight pill alone.

**Doc references:** §0.4, §0.5, §0.6, §"The new keys".

**Verification**
- `npm run typecheck`.
- `npm run dev:react` (⚠️ `npm run dev` does **not** start Vite — see the Dev commands memory).
  Set a `word_bg_opacity` by hand and confirm: box renders behind the word and above the group
  box; sits *under* the highlight pill when that word is active; follows the word onto row 2 of
  a wrapped group; grows with a `font_size_scale` word; unset fields visibly track changes to
  the global Background card sliders.

**Anti-pattern guards:** the loop must not read `effectiveTransition`; must not mutate
`wordXPos` or any layout state (the box is decoration, never affects flow).

---

## Phase 3 — Pillow render (`video_render.py`) — source of truth

**Implement**
In `_draw_word_list()`, add a word-box pass onto the existing `pill_layer` (911-918), placed
**before** the highlight-pill block at ~459.

- Extend the `# --- per-word overrides ---` read site (~541) with the 9 `word_bg_*` reads, and
  update its cross-reference comment to also name this plan.
- Effective values per §"The new keys"; skip when resolved opacity `<= 0`.
- Rect = pill rect (§0.4 Pillow column) widened by `wExtra`/`hExtra` and `stroke_pad`, matching
  the group-box formula at 835-836. Height from `_resolve_scaled_font()` (438-452).
- `_hex_to_rgba(color, opacity * anim_alpha)`, drawn with `_draw_rounded_rect(pill_draw, …)` —
  the same helper the pill and the group box already use.

**Doc references:** §0.2 item 2, §0.4, §0.5, §0.6.

**Verification**
- `.venv-dev/bin/python -m pytest backend/tests/test_caption_cfg_contract.py` → passes, but
  ⚠️ **this proves nothing about Phase 3**. It was already green after Phase 1 (see the corrected
  Phase 1 verification): it only diffs two hand-maintained key sets and never reads
  `video_render.py`. The real guards that Pillow honors the keys are the `word_bg_box` golden
  case below and the Phase 5a parity test. Do **not** treat this test as the phase gate.
  Also remove the `PENDING:` marker added above the `word_bg_*` block in
  `test_caption_cfg_contract.py` once the Pillow reads actually land — it stops being true here.
- `.venv-dev/bin/python -m pytest backend/tests/` → no regressions; existing `bg_box.png` golden
  must be **unchanged** (the group box is untouched — if it moved, the word pass leaked into
  group geometry).
- Add a golden case `word_bg_box` to `backend/tests/gen_golden.py` + `test_render_golden.py`:
  a 2-line group where word 2 has `word_bg_opacity` + a non-default radius, word 4 has a box
  with only opacity set (proving inheritance from the global bg fields), and one box on a
  `font_size_scale: 1.4` word. Regenerate via
  `.venv-dev/bin/python -m backend.tests.gen_golden`, then **open the PNGs and look at them**
  before committing — goldens define "correct".

**Anti-pattern guards:** do not draw on `text_layer` / `shadow_layer`; do not draw word boxes
after the pill; do not skip the `anim_alpha` multiply; no literal fallbacks (§0.7).

---

## Phase 4 — HTML/GSAP caption layer (`hyperframes_caption_html.py`)

**Implement**
1. In `CAPTION_RUNTIME_JS`, add `mkWordBg(m)` modeled on `mkPill()` (~452-474): class `cw-bg`,
   left/top/width/height per §0.4 (HTML column) plus the extras, `background`, `borderRadius`,
   `opacity = String(resolvedOpacity)`, min-pad clamp `Math.max(pad, sStroke + 2)`.
   Fallbacks read from `CFG` (`CFG.bgOpacity`, `CFG.bgColor`, `CFG.bgRadius`, `CFG.padH`,
   `CFG.padV`, `CFG.bgWidthExtra`, `CFG.bgHeightExtra`) — all already in the payload
   (`caption_cfg()`, 48-104), so **no new `CFG` fields are required**.
2. Insert with
   `bubble.insertBefore(el, bubble.querySelector('.cw-pill') || bubble.querySelector('.cw'))`
   so boxes land under the pill and under the words (§0.5).
3. Add `.cw-bg { position: absolute; }` to `caption_css()`, next to `.cbubble-bg` (~191).
4. Call `mkWordBg` for every word with resolved opacity `> 0`, inside the build path deferred by
   `__capWhenFontsReady` — boxes are measured from word widths, so they inherit the font-load
   race fix for free. **Do not** move the build outside that deferral.
5. **Bump `SCAFFOLD_VERSION`** in `backend/exporters/hyperframes_project.py`. The caption runtime
   changed shape, so a byte-identical input set must not serve a stale cached scaffold
   (`CLAUDE.md` → Scaffold fingerprint).

**Doc references:** §0.4, §0.5, §0.6, `CLAUDE.md` → HyperFrames Integration.

**Verification**
- `grep -n "SCAFFOLD_VERSION" backend/exporters/hyperframes_project.py` → incremented.
- Static boxes need no timeline entries — confirm no `__timelines` registration was added.
- Real check is Phase 5a.

**Anti-pattern guards:** no `power2.*`; no local paths in the payload; the box build stays inside
the fonts-ready deferral.

---

## Phase 5 — Parity test + UI

### 5a — Parity test

Add `test_word_background_parity(source_video)` to `backend/tests/test_caption_parity.py`,
modeled on `test_word_override_parity` (~327). One composition covering: a word box on an
inactive word; a box on the active word *with* the highlight pill on top (proves stacking
order); a box that sets only `word_bg_opacity` and inherits color/radius/padding from a
non-default global background (proves the inheritance rule matches across renderers); a box on a
`font_size_scale` word; and a box on row 2 of a 2-line group. Assert caption bounding-box extents
agree within 3px per edge, as its neighbours do.

Run: `CAPFORGE_PARITY=1 .venv-dev/bin/python -m pytest backend/tests/test_caption_parity.py`
(needs Node 22 + ffmpeg).

### 5b — WordStylePopup UI

In `src/renderer/src/components/editor/WordStylePopup.tsx`:

- Add `<SubSettings title="Word background">` after the transition sub-settings and before
  `"Position offset"` (~496). It is **NOT** wrapped in an `{effectiveTransition === '…' && …}`
  guard — that is the structural difference from the highlight/underline/bounce/scale blocks
  at 433-493.
- **Enable toggle.** `buildOverrides()` (230-269) uses "save only if it differs from the global
  default"; that logic cannot express this box, because opacity inherits (§"Enable-gate
  subtlety"). So: an explicit toggle writes `word_bg_opacity` (pre-filled to a visible value —
  the global `bgOpacity/100`, or `0.9` when the global is `0`, which is the STUDIO_DEFAULT).
  Toggle off → drop all 9 keys.
- Controls, mirroring `BackgroundCard.tsx:22-156` labels and ranges so the two surfaces read the
  same: **BG opacity** 0–100 % (⚠️ divide by 100 on write, multiply on read — §0.1 unit trap),
  **BG radius** 0–80 px, **BG width +** −50–200 px, **BG height +** −50–200 px,
  **Margin H** 0–25, **Margin V** 0–50 px, plus **Offset X/Y** −100–100 px.
  Use the popup's own `NumberRow` (548-576) and `ColorRow` (587-610) — do **not** import
  `StudioRow` or hand-roll new markup.
- Sub-fields left untouched must stay **absent** from the overrides object (so they keep
  inheriting), not written at their inherited value.
- Confirm `handleClear()` → `onReset()` (285-288) clears the box too — it drops the whole
  overrides object, so it should; verify, don't assume.

**Verification**
- `npm run typecheck`.
- In `npm run dev:react`: right-click a word in the timeline word lane → enable Word background
  → box appears in the Canvas preview immediately; change the **global** BG radius and confirm a
  word that never set `word_bg_radius` follows it; save the project, reopen, box survives
  (per-word overrides ride `studioGroups`); apply a preset → box **unaffected** (presets are
  style-only); classic-render export matches the preview.

---

## Final phase — Verification sweep

1. **Contract sync (4 definitions, §0.2):**
   ```bash
   for f in src/renderer/src/types/app.ts \
            backend/exporters/hyperframes_caption_html.py \
            backend/tests/test_caption_cfg_contract.py \
            backend/exporters/video_render.py; do
     printf '%s: ' "$f"; grep -o 'word_bg_[a-z_]*' "$f" | sort -u | wc -l
   done
   ```
   All must agree at 9. (Use `grep -o … | sort -u | wc -l`, **not** `grep -c` — the latter counts
   lines, so packed key lists and comment mentions both skew it.)
2. **Anti-pattern grep — no pass-through-layer leak, no preset leak:**
   ```bash
   grep -rn "word_bg" src/renderer/src/lib/presets.ts src/renderer/src/lib/render.ts backend/models/schemas.py
   ```
   → must return **nothing** (§0.3, scope).
3. **Unit trap:** `grep -n "word_bg_opacity" src/renderer/src/components/editor/WordStylePopup.tsx`
   → the only `/ 100` and `* 100` for this key live here, nowhere else.
4. **`SCAFFOLD_VERSION` bumped** (Phase 4 item 5).
5. `npm run typecheck`
6. `.venv-dev/bin/python -m pytest backend/tests/` — including the **unchanged** `bg_box.png`
   golden (proves the group box was not disturbed).
7. `CAPFORGE_PARITY=1 .venv-dev/bin/python -m pytest backend/tests/test_caption_parity.py`
8. **Visual review of every regenerated golden PNG.** A green tolerance diff against a wrong
   golden proves nothing.
9. Manual QA: preview ↔ classic render ↔ HyperFrames render show the same word box; global
   Background slider changes propagate into unset per-word fields in all three; project
   save/reopen round-trips; preset apply leaves word boxes alone.

---

## Appendix — adjacent gap, not part of this plan

The `highlight` pill already draws a background behind the *active* word, but its color is
hardcoded to the global `config.active_word_color` (`video_render.py:521`; `mkPill()` →
`p.style.background = CFG.activeColor`). There is **no** per-word `highlight_color` override.
If per-word pill coloring is wanted, it is one key through the same four contract definitions
plus those three fill sites, and it belongs in the existing transition-gated
`<SubSettings title="Highlight options">` block (433-460) — unlike the Phase 5b block, which is
transition-independent.
