# Plan: Font list cleanup, preset/grouping decoupling, project-restore render fix

Three independent user-reported defects. Phases 1–4 touch disjoint files and can be
executed in any order (or in parallel); Phase 5 gates the whole set.

| # | Symptom (user's words) | Root cause | Files |
|---|---|---|---|
| 1 | "on mac i see alot fonts which starts with dot and they are not working" | macOS private font families are listed verbatim | `backend/engine/system_fonts.py` |
| 2 | "make there simple favorite function … at the top of the list" | Feature does not exist | `FontCombobox.tsx`, `fonts.ts` |
| 3 | "When i change preset than it reset duration of groups" | Presets carry `wordsPerGroup` → forced group rebuild | `lib/presets.ts` |
| 4 | "After restoring project i couldn't render video because of some entity error" | `undefined / 100` → `NaN` → JSON `null` → Pydantic 422 | `App.tsx`, `lib/render.ts` |

---

## Phase 0 — Discovery findings (COMPLETE — do not re-derive)

All facts below were verified against the working tree at `main` (884b7bd) and, where
noted, reproduced empirically. Treat this as the "Allowed APIs" list; do not invent
alternatives.

### 0.1 System font enumeration

- `backend/engine/system_fonts.py:154-160` — `list_system_font_families()` is the **only**
  producer of the system font list. It returns `list[str]` of unique family names.
- `backend/main.py:399-402` — `GET /api/fonts/system` → `{"fonts": [...]}`, local-token gated.
- `system_fonts.py:120-146` — `_scan_font_paths()` reads family names via Pillow
  `ImageFont.truetype(path, 12, index=i).getname()`. Wrapped in
  `@lru_cache(maxsize=1) system_font_faces()` (`:147-150`).
- `system_fonts.py:158-165` — `find_system_font_face(family, bold)` resolves a family
  name back to a concrete face. **This is the render path** — `resolve_font_file()` in
  `video_render.py` depends on it.
- **Measured on this Mac: 380 families total, 73 dot-prefixed** — `.SF NS`-class private
  faces (`.LastResort`, `.Keyboard`, `.Aqua Kana`, `.Arial Hebrew Desk Interface`,
  `.Geeza Pro PUA`, all the `.* PUA` and `.CJK Symbols Fallback *` entries). Apple's
  convention: a leading `.` in the **family name** marks a face as private/system-internal.
- `system_fonts.py:57-64` — the Linux branch scans `Path.home() / ".fonts"`. The
  **directory** starts with a dot; the families inside it do not.

### 0.2 Font picker UI

- `src/renderer/src/components/ui/FontCombobox.tsx:13-296` — props
  `{ fonts: FontInfo[], value, emptyLabel, onChange, disabled?, ariaLabel?, className? }`.
  Exports `filterFonts(fonts, query)` (`:29-36`) and `resolveFontSelection(fonts, value)` (`:38-40`).
  Dropdown is **portal-rendered** (`:244-294`).
- `src/renderer/src/lib/fonts.ts:14-18` — `FontInfo = { name, path, source }`,
  `FontSource = 'system' | 'bundled' | 'custom'`.
- `fonts.ts:94-111` — `loadAllFonts()` fetches all three sources in parallel;
  `mergeFontCatalogs()` (`:70-88`) dedupes with **custom > bundled > system**.
- Two call sites: `FontPicker.tsx:96-104` (global font) and `WordStylePopup.tsx:18`
  (per-word override). Favorites must be shared between them.

### 0.3 Persistence primitive for favorites (reuse — do NOT add a new channel)

- `electron/app-state.js` — single JSON at `app.getPath('userData')/app-state.json`.
  Existing keys documented at `:7-12`.
- `electron/main.js:374-378` — `state:get` / `state:set` handlers.
- **Already exposed in BOTH preloads** — `electron/preload.js:70,73` and
  `src/preload/index.ts:46-47,138-139` expose `getState` / `setState`.
  The [Dual preload gotcha] does **not** apply here. No new IPC surface is needed.

### 0.4 Preset → grouping coupling (defect 3)

- `src/renderer/src/lib/presets.ts:136` — `if (p.wpg != null) out.wordsPerGroup = num(...)`.
  Presets **do** carry and apply `wordsPerGroup` on `main` today.
- `presets.ts:220` — `serialize()` writes `wpg: String(s.wordsPerGroup)`.
- `presets.ts:283,307,331,355,383,407,431` — seven builtin presets each hardcode a `wpg`.
- `presets.ts:37` — `wpg?: string | number` on the wire type.
- `ResultsScreen.tsx:133-134` — `wpgChanged = settings.wordsPerGroup !== prevWpg.current`.
- `ResultsScreen.tsx:138` — the "preserve manual edits" guard is
  `if (groupsEdited && !wpgChanged && !segCountChanged)` — **`wpgChanged` bypasses it**.
- `ResultsScreen.tsx:197-214` — the fallback branch calls `buildStudioGroups(...)` and
  carries forward **only `positionOverride`**. `g.end` is re-derived from word timings.
- `ResultsScreen.tsx:215` — `if (wpgChanged) setGroupsEdited(false)`.
- `ResultsScreen.tsx:234-237` — `handleFillGaps()` bakes stretched ends **into `group.end`**
  (there is no `endOverride` field on `Segment`, `types/app.ts:66-76`).
- **Causal chain:** apply preset → `wordsPerGroup` changes → `wpgChanged` → guard bypassed →
  groups rebuilt from word timings → baked/edited ends gone → `groupsEdited` cleared.

### 0.5 Restore → render 422 (defect 4) — REPRODUCED

- `src/renderer/src/App.tsx:218` — `setSettings(file.studioSettings)`, **no merge with
  `STUDIO_DEFAULTS`**. A project saved by an older build is missing any field added since.
- `src/renderer/src/lib/render.ts` — five arithmetic sites divide a settings field:
  - `:87` `bg_opacity: settings.bgOpacity / 100`
  - `:102` `max_width: settings.maxWidth / 100`
  - `:105` `position_x: settings.posX / 100`
  - `:106` `position_y: settings.posY / 100`
  - `:117` `animation_duration: settings.animDuration / 100`
- `render.ts:63` — `const [resW, resH] = overrides.resolution ?? settings.resolution`
  — a **destructure**, not arithmetic. A missing `resolution` throws
  `TypeError: undefined is not iterable` in the renderer before any request is sent.
- **Why only these matter:** `JSON.stringify` **omits** `undefined` properties entirely,
  so a plain missing field silently falls back to the Pydantic default and is harmless.
  But `undefined / 100 === NaN`, and `JSON.stringify(NaN) === "null"` — which Pydantic
  rejects for a non-`Optional[float]` field.
- **Empirical reproduction** (this session, against the live autosave at
  `~/Library/Application Support/CapForge/autosave.json`, driving the real
  `buildRenderBody()` under vitest and validating with the real Pydantic model):
  - Current-shape settings (all 57 `DEFAULTS` keys present) → `VideoRenderRequest(**body)` **OK**.
  - Same settings with recently-added keys deleted (simulating an older project file) →
    **1 error: `('config', 'max_width') float_type -> None`** — i.e. HTTP 422
    Unprocessable Entity, exactly the "entity error" the user saw.
- `backend/models/schemas.py:203-212` — `CustomGroup` requires `text: str`, `start: float`,
  `end: float` with **no defaults**; `position_x`/`position_y` are `float | None`.
  Restored groups do carry all three, so `custom_groups` is **not** implicated.
- `src/renderer/src/lib/api.ts:191-205` — `handleError()` does not unpack FastAPI's
  422 `detail` array, so the user sees a bare status phrase instead of the failing field.
- `App.tsx:203-213` — the restore's `api.updateResult(...)` is followed by
  `.catch(() => {})`, silently swallowing a failed push of the transcript to the backend.

### 0.6 Prior art to copy

- `docs/plans/preset-resolution-and-schema-repair.md` — the **direct precedent for Phase 3**:
  same defect shape (a preset carrying a key it has no business owning), same fix shape
  (stop applying it, stop serializing it, keep parsing it for back-compat). That plan
  removed `resolution`; this one removes `wpg`. Copy its approach rather than inventing one.
- `docs/plans/fill-gaps-bake-and-editable-end.md` — the feature whose baked group ends
  Phase 3 exists to protect.

---

## Phase 1 — Exclude private (dot-prefixed) font families

**What to implement.** Filter families whose **name** begins with `.` out of the picker list.

Edit `backend/engine/system_fonts.py`, `list_system_font_families()` (`:154-160`) only:
add a module-level predicate (e.g. `_is_private_family(name: str) -> bool` returning
`name.startswith(".")`) and skip those families when building the returned dict.

**Documentation references.** Copy the existing style of `system_fonts.py` — module-level
constants near `FONT_EXTENSIONS` (`:21-25`), a small pure helper, no new dependencies.

**Anti-pattern guards.**
- ❌ Do **not** filter on `path` in `_system_font_paths()` (`:104-124`). The Linux branch
  scans `~/.fonts` — a path filter would delete every Linux user font.
- ❌ Do **not** filter inside `_scan_font_paths()` or `system_font_faces()`. Those feed
  `find_system_font_face()`, which is the **render** resolution path; a project already
  referencing a private family must keep rendering.
- ❌ Do not extend the filter to `.dfont` files — that is a legitimate extension already
  in `FONT_EXTENSIONS` (`:21`), unrelated to the leading-dot family convention.
- ❌ Do not clear or re-shape the `@lru_cache` on `system_font_faces()`.

**Verification checklist.**
- [ ] New pytest in `backend/tests/` asserting `list_system_font_families()` returns no
      name starting with `.`, and that a fabricated non-dot family still survives.
- [ ] New pytest asserting `find_system_font_face(<a dot family>)` **still resolves**
      (resolution is deliberately unfiltered).
- [ ] Manual: `.venv-dev/bin/python -c "from backend.engine.system_fonts import list_system_font_families as f; print(len(f()))"`
      → expect ~307 on this Mac (380 − 73), and zero dot entries.

---

## Phase 2 — Favorite fonts pinned to the top of the picker

**What to implement.**

1. **Persistence.** New `app-state.json` key `favoriteFonts: string[]` (font `name`s,
   e.g. `{"favoriteFonts": ["Inter", "Montserrat"]}`). Read/write via the **existing**
   `window.subforge.getState('favoriteFonts', [])` / `setState('favoriteFonts', next)`.
   Add the key to the doc comment at `electron/app-state.js:7-12` alongside the others.
2. **Shared state.** A `useFavoriteFonts()` hook in `src/renderer/src/hooks/` owning
   `{ favorites: Set<string>, toggle(name): void }`, hydrated once from `getState` and
   persisted on every toggle. Both `FontPicker.tsx` and `WordStylePopup.tsx` consume it
   so a star set in one place shows in the other.
3. **Ordering.** In `FontCombobox.tsx`, sort the already-filtered list so favorites come
   first (stable, preserving the existing relative order within each bucket). Keep
   `filterFonts()` (`:29-36`) a pure name/source match — do the favorite ordering as a
   separate, separately-testable pure helper (e.g. `sortFavoritesFirst(fonts, favorites)`)
   applied after it.
4. **Affordance.** A star toggle on each dropdown row (`:244-294`), and a divider or
   subtle group label between the favorites bucket and the rest.

**Documentation references.**
- Row markup + `SOURCE_LABELS` badge: `FontCombobox.tsx:23-27, 244-294`.
- Keyboard nav (arrow/Enter/Escape) already exists — the star must not steal it; see the
  existing handlers in `FontCombobox.tsx:168-220`.
- Toast pattern for persistence failures: `useToast` (CLAUDE.md → Toasts).

**Anti-pattern guards.**
- ❌ Do **not** add a new IPC channel. `state:get`/`state:set` already exist in both
  preloads (§0.3) — adding `fonts:favorites` would re-open the [Dual preload gotcha]
  for no benefit.
- ❌ Do not hold favorites in `FontCombobox`'s local state — two mounted instances would
  drift.
- ❌ Do not hardcode colors for the star. Use `var(--color-*)` / brand `#D4952A`, and
  prefer inline `style={{ color: 'var(--…)' }}` where Tailwind v4 misparses
  `text-[var(--…)]` (CLAUDE.md → Theming).
- ❌ Clicking the star must not select the font or close the portal dropdown
  (`stopPropagation` on the star's click).
- ❌ A favorited font that is later uninstalled must not appear as a phantom row — the
  favorites list is an ordering hint over `fonts`, never a source of rows.

**Verification checklist.**
- [ ] Unit test for `sortFavoritesFirst`: favorites first, non-favorites keep original
      order, unknown favorite names are ignored, empty favorites is a no-op.
- [ ] Unit test that `filterFonts` behavior is unchanged (guard against regression).
- [ ] `npm run typecheck` clean.
- [ ] Manual: star a font in the global picker → reopen the per-word popup → same font
      is starred and pinned to the top; restart the app → still starred.

---

## Phase 3 — Presets no longer touch grouping

**Decision (user-selected):** drop `wordsPerGroup` from presets entirely. Presets become
purely visual style; words-per-group stays a per-project setting. This continues the
"presets are style-only" direction established in
`docs/plans/preset-resolution-and-schema-repair.md` — **copy that plan's approach**.

**What to implement.** In `src/renderer/src/lib/presets.ts`:

1. Delete the apply line `:136` (`if (p.wpg != null) out.wordsPerGroup = …`).
2. Delete `wpg: String(s.wordsPerGroup)` from `serialize()` (`:220`) — new presets stop
   writing the key.
3. Delete the now-dead `wpg` entries from all seven builtins
   (`:283, 307, 331, 355, 383, 407, 431`).
4. **Keep `wpg?: string | number` on the wire type at `:37`**, with a comment marking it
   accepted-but-ignored, so old `presets.json` entries and old `.cfpreset` imports still
   parse instead of tripping validation.

**Anti-pattern guards.**
- ❌ Do **not** remove `wpg` from the parse type or add a rejection for it —
  `electron/preset-io.js` is a trust boundary for `.cfpreset` import; an unknown-key
  hard failure would break every previously exported preset.
- ❌ Do not touch `ResultsScreen.tsx`'s rebuild logic in this phase. With `wpg` gone from
  presets, `wpgChanged` no longer fires on preset apply, so the guard at `:138` already
  does the right thing. Changing the rebuild is out of scope and risks the undo/redo and
  Strict-Mode invariants documented in the comments at `:145-152`.
- ❌ Do not migrate/rewrite the user's existing `presets.json` on disk.

**Verification checklist.**
- [ ] `presets.test.ts`: applying a preset leaves `wordsPerGroup` at its prior value.
- [ ] `presets.test.ts`: a legacy preset object containing `wpg` still parses and applies
      its style keys (no throw).
- [ ] `presets.test.ts`: `serialize()` output has no `wpg` key.
- [ ] `grep -rn "wpg" src/renderer/src/lib/presets.ts` → only the type declaration at `:37`.
- [ ] Manual: bake group ends via "Fill gaps", then switch presets → durations survive and
      the Groups editor still shows the edited state.

---

## Phase 4 — Project restore no longer breaks rendering

**What to implement.** Defense in depth — the merge fixes the class of bug, the guards
stop it recurring for any future field.

1. **Merge on restore.** `App.tsx:218` →
   `setSettings({ ...STUDIO_DEFAULTS, ...file.studioSettings })`.
   `STUDIO_DEFAULTS` is already imported at `App.tsx:13`. Apply the same merge to the
   crash-recovery path if it sets settings independently.
2. **Guard the NaN sites.** In `lib/render.ts`, give each of the five arithmetic sites a
   default fallback before dividing: `:87`, `:102`, `:105`, `:106`, `:117`. Match the
   existing style already used at `:77` (`tracking: settings.tracking ?? 0`), `:89`,
   `:100`, `:130-131`, `:134-135`.
3. **Guard the destructure.** `render.ts:63` — fall back to the default resolution tuple
   rather than destructuring a possibly-`undefined` value.
4. **Surface the real error.** `api.ts:191-205` — unpack FastAPI's 422 `detail` array
   (`[{loc, msg, type}, …]`) into a readable message naming the failing field, so the next
   occurrence reads "config.max_width: expected number, got null" instead of "entity error".
5. **Stop swallowing the restore push.** `App.tsx:203-213` — replace `.catch(() => {})`
   with a toast; a failed `updateResult` leaves the backend without the transcript and
   every later render/export fails for an unrelated-looking reason.

**Documentation references.**
- Pydantic contract: `backend/models/schemas.py:136-201` (`VideoRenderConfig`), `:203-212`
  (`CustomGroup`), `:215-219` (`VideoRenderRequest`).
- snake_case ↔ camelCase bridge lives **only** in `render.ts` `buildRenderBody()`
  (CLAUDE.md → Key Conventions). Do not add coercion on the Python side.

**Anti-pattern guards.**
- ❌ Do **not** "fix" this by loosening the Pydantic model (making fields `Optional` or
  adding validators that coerce `null`). The schema is the contract; the renderer is what
  is sending garbage.
- ❌ Do not fix `max_width` alone. All five arithmetic sites plus the `resolution`
  destructure share one failure mode; a partial fix just moves the next 422 to a
  different field.
- ❌ Do not deep-merge. A shallow spread is correct — every `StudioSettings` field is a
  flat scalar or tuple (CLAUDE.md → StudioSettings: "single flat interface").
- ❌ Do not let the merge silently mask a genuinely corrupt project file; the added toast
  in (5) is what keeps failures visible.

**Verification checklist.**
- [ ] **Regression test (high value — promote this session's throwaway probe into the
      suite):** a `render.test.ts` case that builds a body from a settings object with
      recently-added keys deleted and asserts every numeric config field is a finite
      number (`Number.isFinite`), never `NaN`/`null`.
- [ ] A companion backend test that feeds that same body through
      `VideoRenderRequest(**body)` and asserts it validates.
- [ ] Test that `{ ...STUDIO_DEFAULTS, ...partialSettings }` yields all 57 keys.
- [ ] `npm run typecheck` clean.
- [ ] Manual: open a project saved by an older build → Render → completes; and confirm a
      deliberately corrupted project now shows a field-level error toast.

---

## Phase 5 — Verification

Run everything; nothing below may regress.

1. `npm run typecheck` — clean.
2. `npx vitest run` — all renderer tests green, including the new Phase 2/3/4 cases.
3. `.venv-dev/bin/python -m pytest backend/tests/` — green (355+ baseline).
4. Golden frames — `backend/tests/test_render_golden.py` must pass **unchanged**. None of
   these phases touches a rendering formula; a golden diff means something leaked into the
   render path (most likely a bad Phase 1 filter reaching `find_system_font_face`).
5. Caption parity — only required if Phase 1 is suspected of affecting font resolution:
   `CAPFORGE_PARITY=1 .venv-dev/bin/python -m pytest backend/tests/test_caption_parity.py`.
6. Anti-pattern greps:
   - `grep -rn "wpg" src/renderer/src/lib/presets.ts` → one hit (the type at `:37`).
   - `grep -nE "settings\.[A-Za-z]+ *[-+*/]" src/renderer/src/lib/render.ts` → every hit
     has a `??` fallback.
   - `grep -n "catch(() => {})" src/renderer/src/App.tsx` → no hit on the restore path.
   - No new `ipcMain.handle` for favorites.
7. Manual QA (each maps to one reported symptom):
   - Font dropdown on macOS shows no `.`-prefixed entries.
   - Star a font → it pins to the top, survives restart, shared with the per-word popup.
   - Bake group ends → switch preset → durations intact.
   - Open an older project → render succeeds.

---

## Commit shape

Four isolated commits, one per phase, so any single fix can be reverted alone:

- `fix: exclude private dot-prefixed font families from the system font list`
- `feat: favorite fonts pinned to the top of the font picker`
- `fix: presets no longer override words-per-group`
- `fix: restored projects render again (merge settings defaults, guard NaN config fields)`

Delegate all git writes to the `git-ops` subagent (CLAUDE.md → Git Operations); branch
first, never commit to `main` directly.
