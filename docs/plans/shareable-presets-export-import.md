# Plan: Shareable Presets — Export / Import to File

**Feature:** Let a user export a saved style preset to a single `.cfpreset` file and import one
on another machine. Custom font files travel *inside* the export (base64); bundled fonts are
referenced by name and re-resolved locally.

**Locked decisions**
- **Font portability:** embed custom (user-uploaded) font bytes as base64; bundled CapForge fonts
  are referenced by name only and re-resolved against the local bundled `Fonts/` dir on import.
- **Granularity:** one preset per file. Per-row **Export** button + one **Import** button in
  `PresetPicker`. (No "export all", no exporting unsaved current settings — out of scope.)
- **Format:** JSON, extension `.cfpreset`, with a `type` tag and integer `version` for forward-compat.

**Three-layer reminder (dual-preload gotcha):** every new `window.subforge.*` method must be added
to BOTH `electron/preload.js` (vanilla, runtime) AND `src/preload/index.ts` (typed). Main-process
handlers go in `electron/main.js`.

---

## Phase 0 — Discovery output (DONE — read before coding)

### Allowed APIs / patterns to COPY (with sources)

**Preset model & (de)serialization** — `src/renderer/src/lib/presets.ts`
- `VanillaPreset` interface — **presets.ts:13–50**. All values are `string | number | boolean | undefined`
  (incl. `resolution` as `"WxH"` string). Relevant fields: `font?` (family name), `customFontPath?`
  (ABSOLUTE local path — the portability breakpoint), plus all style/render fields.
- `studioToVanilla(s): VanillaPreset` — **presets.ts:122–153**. Writes `customFontPath: s.fontPath`.
- `vanillaToStudio(p): Partial<StudioSettings>` — **presets.ts:59–119**. Reads `out.fontPath = p.customFontPath`.
- `applyPreset(current, preset)` — **presets.ts:366–369** (shallow merge over current settings).
- **No `version`/schema marker exists today** — we introduce one only in the *export file*, not in `presets.json`.

**Preset persistence** — `electron/main.js`
- File: `path.join(app.getPath('userData'), 'presets.json')` — **main.js:585**. Flat object keyed by name:
  `{ "<name>": <VanillaPreset>, ... }`.
- Helpers `readPresets()` / `writePresets(data)` — **main.js:587–598** (silently return `{}` on error;
  write with 2-space indent).
- IPC handlers `presets:list|load|save|delete` — **main.js:600–622**.

**File dialog + fs templates to COPY** — `electron/main.js`
- Save: `project:save` — **main.js:625–636**: `dialog.showSaveDialog(mainWindow, {title, defaultPath,
  filters:[{name,extensions}]})` → `fs.writeFileSync(path, JSON.stringify(data,null,2), 'utf-8')` →
  `appState.set('lastProjectPath', path)` → return path | null.
- Open: `project:open` — **main.js:639–653**: `dialog.showOpenDialog(mainWindow, {..., properties:['openFile']})`
  → `fs.readFileSync(path,'utf-8')` → `JSON.parse` → return data | null.

**Font I/O** — `electron/main.js`
- `fonts:save(fileName, dataBuffer)` — **main.js:536–545**: writes `path.join(userData,'fonts', path.basename(fileName))`,
  `mkdir -p` first, returns absolute dest path. **Copy this exact write pattern for importing embedded bytes.**
- `fonts:read(path)` / `window.subforge.readFont` — **main.js:577–581** (returns `null` if missing).
- `fonts:list` (custom) — **main.js:549–555**; `fonts:listBundled` — **main.js:558–564**.
- Bundled dir: `app.isPackaged ? path.join(process.resourcesPath,'Fonts') : path.join(__dirname,'..','Fonts')`
  — **main.js:558–560**. Repo bundles 15 fonts in `/Fonts/`.

**Preload bridge** — `electron/preload.js` & `src/preload/index.ts`
- Vanilla methods (e.g. `savePreset`, `saveProject`, `openProject`) — **preload.js:43–58**.
- Typed `SubforgeApi` interface — **index.ts:17–47**; mirror impl `satisfies SubforgeApi` — **index.ts:105–149**
  (preset methods at **117–121**, project at **122–123**). `PresetSettings` type — **index.ts:13–15**.

**PresetPicker UI** — `src/renderer/src/components/studio/PresetPicker.tsx`
- Props `{ settings, onChange }` — **PresetPicker.tsx:19–22**; `UserPreset = {name, settings}` — **24–27**.
- `refresh()` (defensive `window.subforge?.x` + try/catch) — **39–56**; `handleSaveConfirm()` — **96–116**;
  `handleDelete()` — **118–129**. User-preset rows with delete button — **204–220** (add Export button here).
- Toast: use `useToast()` per CLAUDE.md ("wrap errors in toast calls"). Confirm import path before use.

**Font flow on the rendering side (why local path must be rewritten on import)**
- `StudioSettings.fontName` + `fontName.fontPath` — **StudioPanel.tsx:31–105**.
- Canvas: `registerFont(name, path)` — `src/renderer/src/lib/fonts.ts:25–45` reads via `readFont`,
  builds `FontFace`, adds to `document.fonts`. **Silent fallback** to system font if path unreadable.
- Backend: `custom_font_path` set in `src/renderer/src/lib/render.ts:69`; schema `schemas.py:153`;
  `_get_font()` falls back silently if path missing (`backend/exporters/video_render.py:183–209`).
- **Conclusion:** after import we MUST rewrite the stored preset's `customFontPath` to the *new local*
  path (re-written custom font, or re-resolved bundled font), or both Canvas and backend silently
  render the wrong font with no user signal.

### Anti-patterns to AVOID (do NOT do these)
- ❌ Do NOT export the raw absolute `customFontPath` and import it verbatim — it won't exist elsewhere.
- ❌ Do NOT trust the import file: it is external data. Guard against `__proto__`/`constructor`
  pollution, path traversal in `fileName`, oversized payloads, and a `version` newer than we support.
- ❌ Do NOT add a `window.subforge` method to only one preload file (dual-preload gotcha).
- ❌ Do NOT invent dialog APIs — copy `showSaveDialog`/`showOpenDialog` option shapes from `project:*`.
- ❌ Do NOT change existing preset semantics in `presets.json` or the `studioToVanilla`/`vanillaToStudio`
  contract. The export *file* is a new wrapper around an existing `VanillaPreset`.
- ❌ Do NOT mutate objects in place in the TS/renderer code (immutability rule) — build new objects.

---

## File format spec (the `.cfpreset` file)

```jsonc
{
  "type": "capforge-preset",   // exact tag, validated on import
  "version": 1,                 // integer; reject if > CURRENT_VERSION
  "name": "My Style",          // non-empty string
  "settings": { /* VanillaPreset, with customFontPath blanked out */ },
  "font": {                     // null when preset has no custom font
    "family": "BarberChop",    // mirrors settings.font
    "fileName": "BarberChop.otf",
    "bundled": false,           // true => name-only, re-resolved locally
    "dataB64": "AAEAAAASAQ..."  // present only when bundled=false AND bytes were readable
    // "missing": true          // present when custom font bytes could not be read at export time
  }
}
```

Constants (define once, in `electron/preset-io.js`):
`PRESET_FILE_TYPE = 'capforge-preset'`, `PRESET_FILE_VERSION = 1`,
`PRESET_FILE_EXT = 'cfpreset'`, `MAX_FONT_BYTES = 10 * 1024 * 1024`.

---

## Phase 1 — Format helpers + main-process I/O (no UI)

**Goal:** two IPC handlers that do all dialog + fs + font embedding/restoring in the main process,
plus a pure, testable helper module.

### 1a. New file `electron/preset-io.js` (pure functions, CommonJS, no Electron imports)
Export:
- Constants above.
- `classifyFont({ fontFamily, customFontPath, bundledFontsDir, fs, path })` → `'none' | 'system' | 'bundled' | 'custom' | 'missing'`.
  - `none` if `customFontPath` falsy.
  - `bundled` if `fs.existsSync(path.join(bundledFontsDir, path.basename(customFontPath)))`.
  - `custom` if the file at `customFontPath` is readable.
  - else `missing`. (Edge case: a custom font sharing a bundled basename is treated as bundled —
    acceptable; re-resolves locally without embedding. Document in code comment.)
- `sanitizeSettings(obj)` → returns a NEW object copying only own-enumerable keys whose value is a
  `string | number | boolean`; explicitly skips `__proto__`, `constructor`, `prototype`. Drops nested
  objects/arrays. (VanillaPreset values are all primitives, incl. `resolution` as a string.)
- `buildPresetExport({ name, settings, font })` → assembles the `.cfpreset` object (sets `type`,
  `version`, blanks `settings.customFontPath` to `""`).
- `parsePresetImport(raw)` → validates & returns `{ name, settings, font }` or throws `Error` with a
  user-facing message. Checks: JSON object; `type === PRESET_FILE_TYPE`; `Number.isInteger(version) &&
  version <= PRESET_FILE_VERSION` (else "made with a newer version of CapForge"); `name` non-empty
  string; `settings` is a plain object → run through `sanitizeSettings`. If `font.dataB64` present,
  validate it base64-decodes and decoded length `<= MAX_FONT_BYTES`.
- `uniquePresetName(existingNames, name)` → if collision, append ` (imported)`, then ` (2)`, ` (3)`…

> **Copy from:** the validation discipline mirrors "validate at system boundaries" (common rules);
> the structure mirrors how `presets.ts` keeps (de)serialization pure and separate from I/O.

### 1b. Handler `presets:export` in `electron/main.js` (copy `project:save` shape — main.js:625–636)
1. `const data = readPresets(); const preset = data[name]` (the VanillaPreset). If absent → return `null`.
2. Compute `bundledFontsDir` exactly as **main.js:558–560**.
3. `const kind = classifyFont({ customFontPath: preset.customFontPath, bundledFontsDir, fs, path })`.
4. Build `font`:
   - `none` → `null`.
   - `bundled` → `{ family: preset.font, fileName: path.basename(preset.customFontPath), bundled: true }`.
   - `custom` → read bytes (cap at `MAX_FONT_BYTES`), `{ family, fileName, bundled:false,
     dataB64: buf.toString('base64') }`.
   - `missing` → `{ family, fileName, bundled:false, missing:true }`.
5. `const out = buildPresetExport({ name, settings: preset, font })`.
6. `dialog.showSaveDialog(mainWindow, { title:'Export Preset', defaultPath:
   appState.get('lastPresetExportPath') ? path.join(dirname,...) : safe(name)+'.cfpreset',
   filters:[{name:'CapForge Preset', extensions:['cfpreset']},{name:'All Files',extensions:['*']}] })`.
7. On confirm: `fs.writeFileSync(filePath, JSON.stringify(out,null,2), 'utf-8')`;
   `appState.set('lastPresetExportPath', filePath)`; return `filePath`. Cancel → `null`.

### 1c. Handler `presets:import` in `electron/main.js` (copy `project:open` shape — main.js:639–653)
1. `dialog.showOpenDialog(mainWindow, { title:'Import Preset', defaultPath:
   appState.get('lastPresetImportPath') || undefined, filters:[{name:'CapForge Preset',
   extensions:['cfpreset']},{name:'All Files',extensions:['*']}], properties:['openFile'] })`.
   Cancel → `null`.
2. `const parsed = parsePresetImport(JSON.parse(fs.readFileSync(filePath,'utf-8')))` (wrap in try/catch;
   throw → return `{ error: <message> }` so the renderer can toast it).
3. Resolve font → set `localFontPath`:
   - `font == null` → `localFontPath = ''`; `fontStatus = 'none'`.
   - `font.bundled` → `const p = path.join(bundledFontsDir, path.basename(font.fileName))`;
     if `fs.existsSync(p)` → `localFontPath = p; fontStatus='bundled'` else `localFontPath=''; fontStatus='missing'`.
   - `font.dataB64` → write bytes to `path.join(userData,'fonts', path.basename(font.fileName))`
     (reuse `fonts:save` write pattern — **main.js:536–545**, `mkdir -p`); `localFontPath = dest;
     fontStatus='embedded'`.
   - `font.missing` → `localFontPath=''; fontStatus='missing'`.
4. `parsed.settings.customFontPath = localFontPath` (rewrite to the local path — the key fix).
5. `const data = readPresets(); const finalName = uniquePresetName(Object.keys(data), parsed.name);
   data[finalName] = parsed.settings; writePresets(data); appState.set('lastPresetImportPath', filePath)`.
6. Return `{ name: finalName, fontStatus }`.

### Phase 1 verification
- [ ] `node -e` smoke test of `electron/preset-io.js`: round-trip `buildPresetExport` →
      `JSON.parse(JSON.stringify(...))` → `parsePresetImport` returns equal `settings`/`name`;
      `parsePresetImport` throws on `type` mismatch, on `version: 99`, and strips a `__proto__` key;
      `uniquePresetName(['A'],'A') === 'A (imported)'`.
- [ ] `grep -n "presets:export\|presets:import" electron/main.js` shows both handlers registered.
- [ ] App still boots (`npm run dev`) with no main-process errors.

### Phase 1 anti-pattern guards
- Font writes use `path.basename(fileName)` only — confirm no `filePath`/`fileName` is joined raw.
- `version` gate present; `dataB64` size cap enforced; `sanitizeSettings` drops `__proto__`.

---

## Phase 2 — Preload bridge (BOTH files)

### 2a. `electron/preload.js` (copy lines 55/58 style)
Add inside the `subforge` object:
```js
exportPreset: (name) => ipcRenderer.invoke('presets:export', name),
importPreset: () => ipcRenderer.invoke('presets:import'),
```

### 2b. `src/preload/index.ts` (copy index.ts:33–34 + 122–123)
Add a result type and the two methods to `SubforgeApi` (interface, ~lines 17–47) AND the
`satisfies SubforgeApi` impl block (~lines 117–123):
```ts
export type ExportPresetResult =
  | { filePath: string; fontStatus: 'embedded' | 'bundled' | 'missing' | 'none' }
  | { error: string }

export type ImportPresetResult =
  | { name: string; fontStatus: 'embedded' | 'bundled' | 'missing' | 'none' }
  | { error: string }

// in SubforgeApi:
exportPreset: (name: string) => Promise<ExportPresetResult | null>
importPreset: () => Promise<ImportPresetResult | null>

// in impl:
exportPreset: (name: string) => ipcRenderer.invoke('presets:export', name),
importPreset: () => ipcRenderer.invoke('presets:import'),
```

### Phase 2 verification
- [ ] `npm run typecheck` passes.
- [ ] `grep -n "exportPreset\|importPreset" electron/preload.js src/preload/index.ts` → 2 hits each file
      (interface + impl in index.ts, one each in preload.js... i.e. ≥1 per requirement).

### Phase 2 anti-pattern guards
- Both preload files updated (dual-preload). Method names/channels identical across files.

---

## Phase 3 — PresetPicker UI

**File:** `src/renderer/src/components/studio/PresetPicker.tsx` (rows at 204–220; `refresh()` at 39–56).

### 3a. Import button
- Add an **Import** button in the "Your presets" header area. Handler:
  ```tsx
  const handleImport = async () => {
    if (!window.subforge?.importPreset) return
    setBusy(true)
    try {
      const res = await window.subforge.importPreset()
      if (!res) return                       // cancelled
      if ('error' in res) { toast(res.error, 'error'); return }
      await refresh()
      const msg = res.fontStatus === 'missing'
        ? `Imported "${res.name}" — its font was missing, using default`
        : `Imported "${res.name}"`
      toast(msg, res.fontStatus === 'missing' ? 'info' : 'success')
    } finally { setBusy(false) }
  }
  ```

### 3b. Per-row Export button (mirror the existing delete button at 204–220)
  ```tsx
  const handleExport = async (p: UserPreset, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!window.subforge?.exportPreset) return
    try {
      const res = await window.subforge.exportPreset(p.name)
      if (!res) { toast('Export cancelled', 'info'); return }
      if ('error' in res) { toast(res.error, 'error'); return }
      const msg = res.fontStatus === 'missing'
        ? `Exported “${p.name}” — its custom font wasn’t included (missing or too large)`
        : `Exported to ${res.filePath}`
      toast(msg, res.fontStatus === 'missing' ? 'info' : 'success')
    } catch { toast('Export failed', 'error') }
  }
  ```
- Render an export icon button next to the delete button in each user-preset row.

### 3c. Wire `useToast`
- Import the toast hook (per CLAUDE.md `useToast` context). Confirm exact import path from an existing
  consumer before writing (`grep -rn "useToast" src/renderer/src`).

### Styling (web rules / theming)
- No hardcoded colors — use `var(--color-...)`; match the existing row delete-button styling.
- Buttons need real hover/focus states; keep them keyboard-reachable (they sit on a clickable row, so
  `stopPropagation` on the inner buttons, as the delete button already does).

### Phase 3 verification
- [ ] `npm run typecheck` passes.
- [ ] Manual: save a preset using a **custom** uploaded font → Export → inspect `.cfpreset`:
      `font.bundled === false` and `dataB64` present.
- [ ] Manual: delete that font from `userData/fonts/`, delete the preset, then **Import** the file →
      preset reappears, `userData/fonts/<file>` is recreated, Canvas preview shows the right font,
      and a test render uses it (no "custom font path not found" warning in backend log).
- [ ] Manual: export a preset using a **bundled** font → `.cfpreset` has `font.bundled === true`,
      no `dataB64`; import resolves it locally.
- [ ] Manual: name collision on import appends ` (imported)`.

### Phase 3 anti-pattern guards
- `grep -n "text-white\|bg-black\|#fff\|#000" PresetPicker.tsx` → none introduced.
- Inner buttons call `e.stopPropagation()` so they don't trigger row apply.

---

## Phase 4 — Final verification & hardening

1. **Security review** (file system + external-data boundary → triggers security-reviewer per rules):
   - [ ] Run `security-reviewer` on `electron/preset-io.js` + the two `main.js` handlers.
   - [ ] Confirm: path traversal blocked (basename-only font writes), `MAX_FONT_BYTES` enforced,
         `version` gate rejects newer files, `__proto__`/`constructor` stripped, malformed JSON →
         user-facing error not a crash.
2. **Round-trip / "second machine" simulation** (the Phase 3 custom-font test, repeated cleanly).
3. **Cross-platform:** verify `path.basename`/`path.join` usage is OS-agnostic; sanitize the
   suggested export filename (strip `/ \ : * ? " < > |`). Note Windows AppData font path differs but
   is resolved by the same `userData` logic.
4. **Anti-pattern grep sweep:**
   - [ ] `grep -rn "customFontPath" electron/ src/` — confirm export blanks it and import rewrites it.
   - [ ] `grep -n "showSaveDialog\|showOpenDialog" electron/main.js` — new dialogs match `project:*` shape.
5. **Docs + memory:**
   - [ ] Add a short "Shareable presets / `.cfpreset` format" note to `CLAUDE.md` (format, new IPC
         channels `presets:export`/`presets:import`, font-embedding behavior).
   - [ ] Update `~/.claude/.../memory` project note if this lands on a branch/PR.
6. **Confirm scope boundaries documented:** per-word `custom_font_path` overrides live in project data,
   not presets, so they are intentionally NOT covered by preset sharing.

### Out of scope (note, don't build)
- Export-all / library bundle. Exporting unsaved current settings. Per-word font override portability.
- A "style only" export that omits render settings (presets carry render settings today; unchanged).

---

## Execution order summary
Phase 1 (format + main I/O, testable in isolation) → Phase 2 (preload, unblocks typed renderer calls)
→ Phase 3 (UI) → Phase 4 (security + manual round-trip + docs). Each phase is self-contained with its
own file:line references above and can run in a fresh context.
