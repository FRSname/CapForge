# Plan: Presets must not carry resolution + preset schema repair

**Problem (user report):** Applying a preset saved with a 9:16 resolution onto a 16:9 video silently
changes the Custom Render resolution, and captions preview/render wrong unless the user notices.
Presets should not save (or apply) resolution. Presets are also stale relative to the current
StudioSettings surface and need a schema audit/repair.

---

## Phase 0 — Findings (verified against source, 2026-07-13)

### Where presets live

| Surface | File | Notes |
|---|---|---|
| Schema + converters | `src/renderer/src/lib/presets.ts` | `VanillaPreset` (flat string schema), `vanillaToStudio()`, `studioToVanilla()`, `applyPreset()`, `BUILTIN_PRESETS` |
| Picker UI (save/apply/import/export) | `src/renderer/src/components/studio/PresetPicker.tsx` | save = `studioToVanilla(settings)` → IPC `presets:save`; apply = `applyPreset(settings, p.settings)` |
| Disk storage | `electron/main.js:593` | `<userData>/presets.json`, handlers at `main.js:608-618` — stores whatever the renderer sends, verbatim |
| `.cfpreset` export/import | `electron/preset-io.js` | `buildPresetExport()` passes stored settings through (only blanks `customFontPath`); `parsePresetImport()`/`sanitizeSettings()` strips proto-pollution keys but keeps arbitrary fields like `resolution` |
| MCP agent apply | `src/renderer/src/lib/agentCommands.ts:38-41` | `apply_preset` goes through the same `applyPreset()` — fixed automatically by Phase 1 |
| Tests | `src/renderer/src/lib/presets.test.ts` (150 lines) | extend here |

### Root cause

- `studioToVanilla()` (save path) has **never** written `resolution`/`fps` in the React era
  (verified with `git log -L 120,155:src/renderer/src/lib/presets.ts` — no commit ever wrote it).
- The offenders are **vanilla-era presets already in `presets.json`** and **imported `.cfpreset`
  files**, whose stored settings still carry `resolution: "WxH"`.
- `vanillaToStudio()` at `presets.ts:95-99` applies it: sets `out.resolution = [w, h]` and
  `out.resolutionIsSource = false`, clobbering the auto-detected source resolution. It also applies
  `fps` (line 100), `format`, `renderMode`, `bitrate` (lines 101-107) — the same
  "silent export-settings change" hazard class.

### Schema rot (VanillaPreset vs current StudioSettings in `StudioPanel.tsx:33-104`)

- **Declared but never mapped (silently dropped on apply):** `tracking` (builtins set it!),
  `shadowEnabled`, `wordSpacing`, `padH`, `padV` (the last three have no StudioSettings equivalent —
  dead vanilla fields).
- **Current style fields with NO preset coverage:** `lineHeight`, `maxWidth`, `marginH`, `marginV`,
  `captionStyle`, `highlightRadius`, `highlightPadX`, `highlightPadY`, `highlightOpacity`,
  `highlightAnim`, `highlightTextColor`, `underlineThickness`, `underlineColor`,
  `underlineOffsetY`, `underlineWidth`, `bounceStrength`, `scaleFactor`, `shadowColor`,
  `shadowOpacity`, `shadowBlur`, `shadowOffsetX`, `shadowOffsetY`.
- **Vestigial:** `bold` ↔ `fontWeight`. The Canvas overlay hardcodes `fontWeight = 'normal'`
  (`useSubtitleOverlay.ts:107`) and the backend has no bold synthesis (CLAUDE.md: bold = font
  variant). `bold` is effectively inert for rendering.
- **Builtins:** all 7 use `font: 'Arial'`, `bold: true`, `tracking`, `padH/padV` — several of these
  keys do nothing today.

### Decisions (defaults chosen; flag at execution if you disagree)

- **D1 — scope of "render settings" to exclude:** Presets become **pure style**. Stop applying
  *and* saving `resolution`, `fps`, `format`, `renderMode`, `bitrate`. Rationale: all five share
  the reported failure mode (silently repointing export config); `fps` is the worst sibling — we
  just shipped the fps-passthrough fix (`c3b6d40`) and a preset-carried fps would reintroduce
  timing drift. `safeZone` stays (preview-only guide, deliberately added in `ddf4939`).
- **D2 — repair strategy for on-disk presets:** Do **not** migrate/rewrite `presets.json`.
  Ignoring the fields at apply time is the durable fix (also covers future `.cfpreset` imports and
  any hand-edited JSON); re-saving a preset already strips them. No disk writes = no data-loss risk.
- **D3 — legacy keys:** Keep `resolution`, `fps`, `format`, `renderMode`, `bitrate`, `bold`,
  `wordSpacing`, `padH`, `padV` **in the `VanillaPreset` interface** as documented ignored/legacy
  keys so old JSON still parses; converters just stop reading/writing them (except `bold`, see
  Phase 2).

---

## Phase 1 — Stop applying render/export settings from presets

**Files:** `src/renderer/src/lib/presets.ts` only.

1. In `vanillaToStudio()` delete the mappings at lines 95-107: the `resolution` block (95-99),
   `fps` (100), `format` (101-103), `renderMode` (104-106), `bitrate` (107). Never set
   `resolutionIsSource` from a preset.
2. In `studioToVanilla()` delete the `format`, `renderMode`, `bitrate` lines (148-150).
3. Update the `VanillaPreset` doc comments: mark `resolution`, `fps`, `format`, `renderMode`,
   `bitrate` as `/** Legacy (vanilla-era) — parsed but never applied; presets are style-only. */`.
4. Rewrite the `applyPreset()` docstring (`presets.ts:360-365`) — it currently claims render
   settings are kept "when the preset doesn't specify them"; after this change they are kept
   unconditionally.

**Verify:** `grep -n "out.resolution\|out.fps\|out.format\|out.renderMode\|out.bitrate\|resolutionIsSource" src/renderer/src/lib/presets.ts`
returns nothing. `npm run typecheck` green.

**Anti-pattern guards:** Do NOT touch `preset-io.js` sanitization for this (single source of truth
for what applies = `vanillaToStudio`). Do NOT rewrite `presets.json` on disk.

## Phase 2 — Schema repair: cover the full current style surface

**Files:** `src/renderer/src/lib/presets.ts` (+ a one-line comment fix in
`src/renderer/src/lib/settingsSearch.ts:14`, which claims fontWeight/lineHeight are
"set only via presets").

1. Add to `VanillaPreset` and map in **both** converters (follow the existing sparse pattern —
   `if (p.x != null) out.y = num(p.x, STUDIO_DEFAULTS.y)` — copy the `bgWidthExtra` handling at
   `presets.ts:74` as the template; string-enum fields copy the `textAlignH` guard at 79-84):
   `tracking` (already declared — just wire it), `lineHeight`, `maxWidth`, `marginH`, `marginV`,
   `captionStyle`, `highlightRadius`, `highlightPadX`, `highlightPadY`, `highlightOpacity`,
   `highlightAnim` ('jump' | 'slide' guard), `highlightTextColor`, `underlineThickness`,
   `underlineColor`, `underlineOffsetY`, `underlineWidth`, `bounceStrength`, `scaleFactor`,
   `shadowEnabled` (declared — wire it), `shadowColor`, `shadowOpacity`, `shadowBlur`,
   `shadowOffsetX`, `shadowOffsetY`.
2. `bold`: keep reading it (legacy) → `fontWeight`, but stop writing it in `studioToVanilla()`.
   It is render-inert (`useSubtitleOverlay.ts:107` hardcodes `'normal'`); note this in the
   interface comment.
3. Leave `wordSpacing`/`padH`/`padV` declared-but-unmapped with a legacy comment (they already are
   unmapped; just document it).
4. Sparse semantics stay: old presets without the new keys must not change those settings
   (the `!= null` guard pattern guarantees this — do not "default-fill" missing keys).

**Verify:** field-by-field diff — every `StudioSettings` key from `StudioPanel.tsx:33-104` is
either mapped in both converters or on the explicit exclusion list
(`resolution`, `fps`, `format`, `renderMode`, `bitrate`, `resolutionIsSource`, `fontName`/`fontPath`
handled via `font`/`customFontPath`, `fontWeight` via legacy `bold` read). Typecheck green.

**Anti-pattern guards:** Do NOT add project-scoped data to presets — per-word `custom_font_path`
overrides and per-group `positionOverride` are intentionally project-only (CLAUDE.md). Do NOT
change the on-disk flat string schema (keep `String(...)` writes + `num(...)` reads for
cross-compat with vanilla presets and existing `.cfpreset` files).

## Phase 3 — Refresh BUILTIN_PRESETS

**Files:** `src/renderer/src/lib/presets.ts` (`BUILTIN_PRESETS`, lines 161-358).

1. Remove dead keys from all 7 builtins: `padH`, `padV`, `wordSpacing`; drop `bold` (inert).
2. Keep `tracking` values — they become live via Phase 2.
3. Where a builtin's word style needs the new fields to look intentional under the current
   renderers, set them explicitly (e.g. "Highlight Pill" → `highlightRadius`/`highlightPadX`/
   `highlightPadY`/`highlightOpacity`; "Karaoke Neon" already relies on `wordTransition` only).
   Sanity-check each builtin in the live preview before committing values.
4. Builtins must contain **no** render/export keys (they already don't carry `resolution` —
   keep it that way).

**Verify:** every key used by every builtin is a key `vanillaToStudio()` actually maps
(write a test that asserts this mechanically — see Phase 4.4).

## Phase 4 — Tests + final verification

**Files:** `src/renderer/src/lib/presets.test.ts`.

1. **The reported bug, pinned:** a legacy preset containing
   `{ resolution: '1080x1920', fps: '25', format: 'webm', renderMode: 'baked', bitrate: '4M' }`
   applied via `applyPreset()` onto settings with `resolution: [1920, 1080]`,
   `resolutionIsSource: true` changes **none** of: `resolution`, `resolutionIsSource`, `fps`,
   `format`, `renderMode`, `bitrate` — while its style keys still apply.
2. **Round-trip:** `applyPreset(STUDIO_DEFAULTS, studioToVanilla(custom))` reproduces `custom` for
   every style field added in Phase 2 (shadow, highlight, underline, tracking, lineHeight,
   maxWidth, margins, captionStyle, bounce/scale).
3. **Sparse apply:** a preset missing the new keys leaves current values of those settings intact.
4. **Builtin hygiene (mechanical):** for each `BUILTIN_PRESETS` entry, every own key is consumed by
   `vanillaToStudio()` (no dead keys) and the result contains no render/export fields.
5. Run: `npm run typecheck` && `npx vitest run` (full renderer suite — `agentCommands` tests cover
   the MCP `apply_preset` path). No backend/golden impact expected: presets never reach
   `render.ts`/`VideoRenderConfig` directly, only through StudioSettings.
6. Grep guards from Phases 1-2 rerun clean.

**Out of scope (explicitly):** migrating `presets.json`, changing `.cfpreset`
format/version (import keeps working because apply ignores the fields), preset UI changes,
adding resolution back behind an opt-in "include render settings" toggle (only if requested later).
