# Plan: HyperFrames render output location — next to original, or a chosen folder

## Problem (user report)

> "Now it renders, but when rendered with HyperFrames it saves the video to an
> output folder somewhere under CapForge files. I don't know that path at all and
> it's not user-friendly. It should render the file next to the original — or to a
> folder I specify — before the render."

## Goal

1. **Default:** the rendered HyperFrames video lands **next to the original** source file.
2. **Override:** the user can pick a **destination folder before rendering**, in the HyperFrames card itself.
3. **Discoverability:** after a render, the user **sees the output path** and can **Reveal in Finder/Explorer**.
4. **Tidiness:** the messy intermediate HyperFrames *project scaffold* no longer pollutes the user's folder on the render-to-file path.

---

## Phase 0 — Verified facts (Documentation Discovery)

All facts below were read directly from the working tree at `HEAD = 35e0180` (clean tree). Cite these; do **not** re-derive from assumptions.

### Backend — where the output path is decided
- **`backend/models/schemas.py:75, 115, 195, 216`** — every request model defaults `output_dir: str = "output"`. This is a **bare relative path**. `HyperframesRenderRequest.output_dir` is line **216**.
- **`backend/main.py:574-671`** — `export_hyperframes_endpoint(request: HyperframesRenderRequest)`.
  - **`:621-630`** scaffolds the project: `export_hyperframes_project(current_result, config, request.output_dir, source_video_path=current_result.audio_path, ...)`.
  - **`:633-635`** builds the final video path: `stem = Path(current_result.audio_path).stem; ext = ".webm" if webm else ".mp4"; out_path = str(Path(request.output_dir) / f"{stem}_hyperframes{ext}")`.
  - **`:636-641`** renders: `render_hyperframes_project(project_dir, out_path, quality=..., video_format=..., on_progress=...)`.
  - **`:649`** returns `{"status": "ok", "project": project_dir, "file": file}` (or `"file": None` when `render: false`).
- **`backend/exporters/hyperframes_project.py:594-658`** — `export_hyperframes_project(...)`.
  - **`:616-618`** `stem = Path(result.audio_path).stem or "capforge"; project_dir = Path(output_dir) / f"{stem}-hyperframes"; project_dir.mkdir(parents=True, exist_ok=True)`.
  - **`:621-625`** copies the source video **into** the project dir (`source{ext}`).
  - Writes `index.html`, `transcript.json`, `README.txt`, `assets/`, `fonts/` into the project dir.
- **`backend/exporters/hyperframes_render.py:73-152`** — `render_hyperframes_project(project_dir, output_path, ...)`.
  - **`:87`** `out.parent.mkdir(parents=True, exist_ok=True)`.
  - **`:89-94`** runs CLI with `--output str(out)`.
  - **`:132-138`** `_discover_output` + `shutil.move` relocate from the CLI's default `renders/` dir when a CLI version ignores `--output`. **It writes wherever `output_path` says — the path is decided upstream, in `main.py`.**

### `audio_path` is the user's real original path (not an internal copy)
- **`backend/main.py:315-316`** — transcribe validates `Path(request.audio_path).is_file()`; the backend reads the file **in place** (no copy).
- **`src/renderer/src/hooks/useTranscription.ts:57`** sends `audio_path: filePath` (the dropped/selected absolute path).
- **`src/renderer/src/App.tsx:355`** passes `audioPath={result?.audioPath ?? filePath ?? ''}` down through `StudioPanel` → `HyperFramesPanel`.
- ⇒ `dirname(audioPath)` genuinely resolves to the folder **next to the original**.

### Frontend — current HyperFrames render plumbing
- **`src/renderer/src/components/studio/HyperFramesPanel.tsx:46`** — `const effectiveOutputDir = outputDir || dirname(audioPath)`.
- **`HyperFramesPanel.tsx:100`** — `startRender({}, effectiveOutputDir, 'hyperframes')` (forwarding **is** committed — landed in `7ec5ab0`).
- **`HyperFramesPanel.tsx:141`** — `openStudio(effectiveOutputDir)`.
- **`HyperFramesPanel.tsx:25-33`** props: `{ effects, onEffectsChange, captionStyle, onCaptionStyleChange, audioPath, outputDir, render }` — **no `onOutputDir`** (so the card can display a dir but cannot set one yet).
- **`src/renderer/src/lib/render.ts:13-18`** `dirname()`; **`:35`** `RenderBody.output_dir?`; **`:142`** `if (outputDir) body.output_dir = outputDir` (omitted when falsy → backend default `"output"` is used).
- **`src/renderer/src/hooks/useRender.ts:115-130`** — `startRender` calls `await api.exportHyperframes(body)` at **`:118`** and **discards the response** → the returned `file` path is never surfaced.
- **`useRender.ts:147-165`** — `openStudio` *does* read `res.project` (proves the response carries usable paths).

### Existing reusable building blocks (copy these — do not invent)
- **Folder picker (already wired end-to-end):** `window.subforge.pickOutputDir()` → `electron/preload.js:18` (`'dialog:openDir'`) → `electron/main.js:498-508` (`dialog.showOpenDialog`, `properties:['openDirectory']`, persists `lastOutputDir`). Type at `src/preload/index.ts:29`.
- **Reveal in OS file browser (already wired end-to-end):** `window.subforge.showInFolder(filePath)` → `electron/preload.js:88` (`'shell:showInFolder'`) → `electron/main.js:408-409` (`shell.showItemInFolder`). Type at `src/preload/index.ts:52`.
- **Destination-picker UI to mirror:** `src/renderer/src/components/studio/ExportPanel.tsx` — `ExportPanelProps { audioPath, render, outputDir, onOutputDir }`, the "Output:" row (label + truncated name + **Browse** → `pickOutputDir()` → `onOutputDir(dir)`, + **✕** reset → `onOutputDir('')`), and `effectiveOutputDir = outputDir || dirname(audioPath)`.
- **Shared state already exists:** `StudioPanel.tsx:262` `const [outputDir, setOutputDir] = useState<string>('')`; passed to `ExportPanel` with both `outputDir`+`onOutputDir` (`:955-959`) but to `HyperFramesPanel` with **`outputDir` only** (`:972-978`).

### Root cause (consolidated)
The final video path is `Path(request.output_dir) / "{stem}_hyperframes.{ext}"` (`main.py:635`). The output lands in an opaque place whenever `request.output_dir` is the bare default `"output"` — which happens for **any** caller that doesn't forward an absolute dir: the MCP/agent `use_ui_config` path, a stale build predating `7ec5ab0`, or any case where `audioPath`/`outputDir` is empty. The backend has **no safety net** of its own. Separately, even on the happy path: (a) the whole `{stem}-hyperframes/` scaffold is dumped next to the user's video, and (b) the frontend throws away the returned `file`, so the user can't find the result. The fix makes the backend self-sufficient and the result discoverable, independent of which UI path triggered the render.

### Anti-patterns to avoid
- ❌ Inventing a new IPC for picking folders or revealing files — `pickOutputDir` and `showInFolder` already exist; reuse them.
- ❌ Adding a *file-save* dialog (`showSaveDialog`) — the app's pattern is a **folder** picker + deterministic filename. Stay consistent.
- ❌ Changing the response shape of `/api/export-hyperframes` — it already returns `{ status, project, file }`.
- ❌ Resolving relative dirs against the Python process CWD — that **is** the bug. Resolve against `current_result.audio_path`'s parent.
- ❌ Touching the Pillow/`render_subtitle_video` parity formulas — out of scope.

---

## Phase 1 — Backend: make the output location self-sufficient & tidy

**What to implement (copy/adapt, cite the lines above):**

1. **Add a path resolver** (new small helper, e.g. in `backend/exporters/hyperframes_project.py` or a shared util):
   ```python
   def resolve_output_dir(output_dir: str | None, source_path: str) -> str:
       """Absolute, user-meaningful output dir. Falls back to the source file's
       folder when output_dir is empty or a bare relative path like the default
       'output' (which would otherwise resolve against the backend CWD)."""
       if output_dir and Path(output_dir).is_absolute():
           return output_dir
       return str(Path(source_path).expanduser().resolve().parent)
   ```
   - Decision baked in: treat **empty OR relative** `output_dir` as "next to source". (A relative `"output"` is never what the user wants; it's the schema default leaking through.)

2. **Apply it in `export_hyperframes_endpoint` (`backend/main.py:621-641`)** before scaffolding and before building `out_path`:
   - `out_dir = resolve_output_dir(request.output_dir, current_result.audio_path)`
   - Use `out_dir` for the final video: `out_path = str(Path(out_dir) / f"{stem}_hyperframes{ext}")`.

3. **Stop polluting the user's folder with the scaffold on the render-to-file path** (`render: true`):
   - Scaffold the project into a **temp/cache dir** (e.g. `tempfile.mkdtemp(prefix="capforge-hf-")` or under the app data dir), render from there, and write only the **final mp4** into `out_dir`.
   - Keep current behavior for **`render: false`** (the *Open in Studio* path) — that project must persist and be openable, so scaffold it next to the source (or a known projects dir) and return it as today.
   - Implementation shape: branch on `request.render` for the scaffold location; the final `out_path` always uses `out_dir`.

**Decision point (recommended default, not blocking):** scaffold render-to-file in a temp dir (cleanest — user only ever sees `{stem}_hyperframes.mp4`). If the user later wants the inspectable project kept beside the video, that's a one-line change to the scaffold location.

**Verification:**
- `grep -n "resolve_output_dir" backend/` shows it applied in the HyperFrames endpoint.
- Unit test (extend `backend/tests/test_hyperframes_render.py` or new `test_output_location.py`): `resolve_output_dir("output", "/Users/x/clip.mp4") == "/Users/x"`; absolute passes through; empty → source parent.
- Run: `.venv-dev/bin/python -m pytest backend/tests/test_hyperframes_render.py -q` (full suite was 143/143 green at `35e0180`).

**Anti-pattern guards:** don't resolve against `os.getcwd()`; don't move the `render:false` scaffold into temp (Studio needs it persistent).

---

## Phase 2 — Frontend: destination chooser visible in the HyperFrames card

**What to implement (mirror `ExportPanel.tsx`):**

1. **`HyperFramesPanel.tsx`** — add `onOutputDir: (dir: string) => void` to `HyperFramesPanelProps` (`:25-33`) and render the same compact "Output:" row used by `ExportPanel` (label + truncated `outputDir` name or "Same as source" + **Browse** → `window.subforge.pickOutputDir()` → `onOutputDir(dir)` + **✕** reset → `onOutputDir('')`). `effectiveOutputDir = outputDir || dirname(audioPath)` already exists (`:46`); keep forwarding it at `:100`.

2. **`StudioPanel.tsx:972-978`** — pass `onOutputDir={setOutputDir}` to `HyperFramesPanel` (it already passes `outputDir`). State is shared with `ExportPanel`, so a folder chosen in either card applies to both — and to the render that follows. This satisfies "specify the folder **before** render."

**Verification:**
- `npm run typecheck` clean.
- The HyperFrames card shows "Same as source" by default and the chosen folder after Browse.

**Anti-pattern guards:** don't add a second independent `outputDir` state — reuse the shared `StudioPanel` state. Watch Tailwind color-token misparse (use inline `style={{ color: 'var(--color-text-2)' }}` per CLAUDE.md theming notes).

---

## Phase 3 — Post-render discoverability ("Reveal" + path)

**What to implement:**

1. **Surface the returned `file`** — in `useRender.ts`, `startRender` currently discards `await api.exportHyperframes(body)` (`:118`). Capture it (`const res = await api.exportHyperframes(body) as { file?: string }`), and expose a `lastOutputFile: string | null` on `RenderController` (set on success, cleared on `reset`). Do the same for the Pillow path if `renderVideo` returns a path (check `api.renderVideo`'s response; if it doesn't return one, scope this to HyperFrames).

2. **Reveal action** — when `render.status === 'done'` and `lastOutputFile` is set, show the filename + a **"Reveal in Finder/Explorer"** button calling `window.subforge.showInFolder(lastOutputFile)`. Place it in the HyperFrames card and/or `ExportFooter` (where the "✓ Render complete" message already renders).

**Verification:**
- After a HyperFrames render, the UI shows the real output path and the Reveal button opens the correct folder with the file selected.
- `npm run typecheck` clean.

**Anti-pattern guards:** don't construct the path on the frontend by string-joining — use the authoritative `file` returned by the backend (it already accounts for ext/format and the `renders/` relocation).

---

## Phase 4 — Verification (final)

1. **Backend:** `.venv-dev/bin/python -m pytest backend/tests -q` → all green (baseline 143).
2. **Types:** `npm run typecheck` → clean.
3. **Grep guards:**
   - `grep -rn "output_dir" backend/main.py` → HyperFrames endpoint uses the resolved dir, not `request.output_dir` directly for `out_path`.
   - `grep -n "showInFolder\|lastOutputFile" src/renderer/src` → reveal wired.
4. **Manual smoke (per `/run` or dev):**
   - Render with HyperFrames, default → `{stem}_hyperframes.mp4` appears **next to the original**; no scaffold folder left behind; Reveal opens it.
   - Pick a folder via Browse, render → file lands in the chosen folder; Reveal opens it.
   - *Open in Studio* still works (scaffold persists and opens).
5. **Confirm the latent same-default bug** in the other endpoints (`schemas.py:75,115,195` for `_do_export`/`render_video`) — apply `resolve_output_dir` there too **only if** quick and low-risk; otherwise note as follow-up. The user's report is HyperFrames-specific.

---

## Files in scope
- `backend/main.py` (HyperFrames endpoint)
- `backend/exporters/hyperframes_project.py` (resolver + scaffold location)
- `backend/exporters/hyperframes_render.py` (no logic change expected; it honors `output_path`)
- `backend/models/schemas.py` (optional: document/leave default; resolver handles it)
- `src/renderer/src/components/studio/HyperFramesPanel.tsx`
- `src/renderer/src/components/studio/StudioPanel.tsx`
- `src/renderer/src/components/studio/ExportFooter.tsx` (reveal button placement)
- `src/renderer/src/hooks/useRender.ts` (capture + expose `file`)
- `backend/tests/` (resolver + output-location tests)

## Out of scope
- Pillow ↔ Canvas render parity formulas.
- Adding a file-save (filename) dialog.
- Changing the `/api/export-hyperframes` response shape.
