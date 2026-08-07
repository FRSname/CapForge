# MCP Batch Control — user presets + video import + classic render

**Goal.** Let a Claude agent drive CapForge over MCP end-to-end for a batch of videos:
load a video → transcribe → clean up subtitles → apply a *user-saved* preset → render the final file.

**Mode (decided).** *Attended* — the CapForge app is open and visible throughout. The
renderer stays the source of truth for style, presets and fonts, so nothing in
`render.ts`'s casing bridge gets duplicated in Python.

**Engine (decided).** Classic Pillow render via `POST /api/render-video`. No human-approval
gate, no Node/HyperFrames dependency. The existing `render_hyperframes` tool is left alone.

---

## Phase 0 — Documentation Discovery (COMPLETE — read this before any phase)

This phase has already been executed. The findings below are the **Allowed APIs** list.
Do not invent surface beyond it; if you need something not listed, go read the cited file
first and add it here.

### 0.1 The critical enabler

`App.tsx:117-132` already mirrors to the backend, debounced 300 ms:

```ts
api.putUiState({
  settings,                                             // camelCase StudioSettings
  groups,
  presets: builtinPresetNames(),                        // builtin NAMES only
  render: buildRenderBody(settings, groups, groupsEdited), // <-- resolved snake_case body
})
```

`render` is the **fully-resolved `VideoRenderConfig` request body**, produced by the one
and only casing bridge. It lands in `current_ui_state` (`backend/main.py:171`) and is
already readable by the agent through `GET /api/agent/ui-state` (`backend/main.py:675`).

**Consequence:** exposing presets to MCP requires *zero* Python knowledge of presets.
The renderer resolves a preset name → `StudioSettings` → `buildRenderBody` → mirror.
The agent reads the mirror. Any plan that ports `vanillaToStudio`/`buildRenderBody` to
Python is wrong and violates the single-bridge invariant in `CLAUDE.md`.

### 0.2 Allowed APIs — renderer

| Symbol | Location | Notes |
|---|---|---|
| `applySettingsCommand(settings, cmd)` | `src/renderer/src/lib/agentCommands.ts:22-48` | Pure. Returns new `StudioSettings` or `null`. |
| `builtinPresetNames()` | `src/renderer/src/lib/agentCommands.ts:51-53` | |
| `BUILTIN_PRESETS` | `src/renderer/src/lib/presets.ts:275-441` | 7 entries, `{name, settings: VanillaPreset}` |
| `applyPreset(settings, vanilla)` | `src/renderer/src/lib/presets.ts:450-453` | |
| `vanillaToStudio(vanilla, base)` | `src/renderer/src/lib/presets.ts:114-206` | Sparse apply; skips `wpg` (:143) + render keys (:193-194) |
| `studioToVanilla(settings)` | `src/renderer/src/lib/presets.ts:213-265` | The 49 style keys |
| `buildRenderBody(settings, groups, groupsEdited, overrides?, outputDir?)` | `src/renderer/src/lib/render.ts:70-189` | **The only casing bridge** |
| `api.putUiState(state: unknown)` | `src/renderer/src/lib/api.ts:366` | Untyped payload — adding fields is free |
| `api.connectControl(handlers)` / `disconnectControl()` | `src/renderer/src/lib/api.ts:504` / `:561` | Opens `/ws/progress`, **not** `/ws/control` |
| `ControlHandlers` | `src/renderer/src/lib/api.ts:176-184` | `onResultUpdated`, `onCommand`, `onRenderApprovalRequest`, `onRenderApprovalResolved` |
| `AgentCommand` | `src/renderer/src/lib/api.ts:152-155` | `{op: string; payload?: Record<string, unknown>}` — `op` is unconstrained |
| `window.subforge.listPresets()` / `loadPreset(name)` | `electron/preload.js:46-55` | Existing IPC. **No new IPC channel is needed by this plan.** |
| `StudioSettings` / `STUDIO_DEFAULTS` | `components/studio/StudioPanel.tsx:30-106` / `:110-168`, exported `:183` | 57 fields |

### 0.3 Allowed APIs — backend

| Symbol | Location | Notes |
|---|---|---|
| `AGENT_COMMAND_OPS` | `backend/main.py:174` | `{"set_settings","apply_preset","set_word_overrides"}`; unknown op → 400 at `:691-692` |
| `POST /api/agent/command` | `backend/main.py:683-694` | Fire-and-forget relay; op-agnostic broadcast at `:693` |
| `GET /api/agent/ui-state` | `backend/main.py:675` | Returns `current_ui_state` verbatim; 404 if never mirrored |
| `PUT /api/ui-state` | `backend/main.py:667-672` | Ungated (loopback renderer) |
| `POST /api/render-video` | `backend/main.py:817-871` | `require_local_token` (accepts agent token). Body `VideoRenderRequest` |
| `VideoRenderRequest` | `backend/models/schemas.py:215` | `{config: VideoRenderConfig, output_dir: str = "output", custom_groups?: list[CustomGroup]}` |
| `VideoRenderConfig` | `backend/models/schemas.py:136-200` | ~55 flat fields |
| `resolve_output_dir(output_dir, source_path)` | `backend/exporters/hyperframes_project.py:313-326` | Relative/empty → folder next to source media |
| `require_agent_token` | `backend/main.py:301-307` | |
| `broadcast_event(payload)` | `backend/main.py:245-262` | |

### 0.4 Allowed APIs — MCP

| Symbol | Location |
|---|---|
| `CapForgeClient._request(method, path, *, json=None, timeout=_SHORT_TIMEOUT, _retry=True)` | `mcp_server/client.py:47` |
| `send_command(op, payload)` | `mcp_server/client.py:97` |
| `get_ui_state()` | `mcp_server/client.py:94` |
| `_LONG_TIMEOUT` / `_SHORT_TIMEOUT` | `mcp_server/client.py:20-21` |
| Read-only tool template | `mcp_server/server.py:55-58` (`get_status`) |
| Mutating command-relay tool template | `mcp_server/server.py:193-202` (`set_style`) |
| Pydantic input-model template | `mcp_server/server.py:26-37` (`WordEdit`) |

### 0.5 Known gaps this plan closes

1. `apply_preset` searches **only** `BUILTIN_PRESETS` (`agentCommands.ts:43`) — user presets are unreachable.
2. The mirror sends `presets: builtinPresetNames()` (`App.tsx:124`) — user presets are invisible to the agent.
3. Agent commands are **fire-and-forget with no ack** (`AgentLiveSync.tsx:106-123`, backend `:686-689`). Combined with the 300 ms mirror debounce this is a race: the agent cannot know a preset applied before it renders.
4. **No MCP tool calls `/api/render-video`.** Classic render is entirely unreachable from MCP.
5. **No MCP tool loads a video.** `transcribe` hits the backend directly, leaving the open renderer on the drop screen with no idea a result exists.
6. **Blocker:** `AgentLiveSync` is `active={screen === 'results'}` (`App.tsx:414`) and `connectControl` is skipped when inactive (`AgentLiveSync.tsx:87`). On the `'file'` screen there is **no control socket**, so a `load_video` command reaches nobody. The ui-state mirror (`App.tsx:118`) and `registerResync` (`App.tsx:138-140`) early-return the same way.

### 0.6 Anti-patterns — do NOT do these

- ❌ Port `buildRenderBody` or `vanillaToStudio` to Python. One bridge, in `render.ts`.
- ❌ Teach the backend to read `presets.json`. The backend has no preset concept and keeps none.
- ❌ Add a `/ws/control` endpoint. It does not exist; comments at `backend/main.py:173,685` are stale. Control rides `/ws/progress`.
- ❌ Add a new IPC channel for presets. `listPresets`/`loadPreset` already exist — and a new channel would need editing **both** preloads (`electron/preload.js` *and* `src/preload/index.ts`), a documented drift trap.
- ❌ Bypass or auto-approve `_await_render_approval` (`backend/main.py:697-729`). Not touched by this plan — classic render has no approval gate.
- ❌ Assume `screen === 'results'`. Every new agent-reachable behaviour must state which screens it works on.

---

## Phase 1 — Lift the control socket and user presets into `App`

**Why first:** gap 6 blocks Phases 2 and 3. Nothing agent-driven works off the results screen today.

### What to implement

1. **New hook `src/renderer/src/hooks/useUserPresets.ts`.**
   Copy `refresh()` verbatim from `components/studio/PresetPicker.tsx:42-59` — it has zero
   component-state dependencies, only `window.subforge` IPC. Export
   `{ userPresets: UserPreset[], refresh: () => Promise<void> }`. Move the `UserPreset`
   interface out of `PresetPicker.tsx:26-29` into this hook and re-export it.
   Keep the `if (!window.subforge?.listPresets) return` guard — it is what keeps
   non-Electron test contexts working.

2. **Call the hook in `App.tsx`.** Thread `userPresets` + `refresh` down through
   `StudioPanel` (`App.tsx:401` → `StudioPanel.tsx:269`) to `PresetPicker` as two new props;
   add them to `StudioPanelProps` and `PresetPickerProps` (`PresetPicker.tsx:21-24`).
   `PresetPicker` keeps calling `refresh` after save/delete/import (`:112`, `:128`, `:147`) —
   it just no longer owns the state.

3. **Mount the control socket unconditionally.** Change `AgentLiveSync`'s `active` prop
   (`App.tsx:414`) so the socket connects on all screens, and make each handler
   screen-aware instead of the connection being screen-aware:
   - `onResultUpdated` → keep the current results-screen behaviour (`AgentLiveSync.tsx:90-104`), no-op elsewhere.
   - `onCommand` → dispatch (Phase 2/3 extend this).
   - `onRenderApprovalRequest` → unchanged.
   The editing soft-lock (`editingRef`, `AgentLiveSync.tsx:68-83`) and the Apply/Dismiss
   bar (`:217-243`) stay exactly as they are.

4. **Mirror ui-state on all screens.** Drop the `if (screen !== 'results') return` guard at
   `App.tsx:118`; instead include `screen` in the mirrored payload so the agent can see
   where the app is. Same for the `registerResync` provider (`App.tsx:138-140`) — it must
   tolerate `result === null`.

### Documentation references

- `refresh()` to copy: `PresetPicker.tsx:42-59`
- Connect effect to modify: `AgentLiveSync.tsx:86-149` (early return at `:87`)
- Mirror effect to modify: `App.tsx:117-132`
- Resync effect to modify: `App.tsx:137-163`
- Screen type: `src/renderer/src/types/app.ts:2` — values are `'file' | 'progress' | 'results'` (**not** `'drop'`)

### Verification checklist

- [ ] `npm run build` and `npx tsc --noEmit` clean.
- [ ] Existing tests green: `npx vitest run src/renderer/src/lib/presets.test.ts` (the `ROUND_TRIP_KEYS` pin at `presets.test.ts:28-90` must not change in this phase).
- [ ] With the app on the **drop screen** (no video loaded), `GET /api/agent/ui-state` returns 200 with `screen: "file"` — not 404. This is the phase's real acceptance test.
- [ ] Preset dropdown still lists user presets, and save/delete/import still refresh it.
- [ ] `grep -n "screen !== 'results'" src/renderer/src/App.tsx` → no hits in the mirror or resync effects.

### Anti-pattern guards

- Do **not** add a second `connectControl` call site. There must be exactly one; `grep -c "connectControl" src/renderer/src/` should stay at 2 (definition + call).
- Do **not** make `PresetPicker` fetch presets itself as well as receive them — one owner.

---

## Phase 2 — Expose user presets to the agent (+ apply acknowledgement)

Closes gaps 1, 2 and 3.

### What to implement

1. **Mirror both preset families.** In `App.tsx:121-126`, replace
   `presets: builtinPresetNames()` with a shape that keeps the old key working and adds
   the new one — the agent needs to tell them apart because only user presets can carry a
   `customFontPath`:

   ```ts
   presets: builtinPresetNames(),                 // unchanged, back-compat
   presetsDetail: {
     builtin: builtinPresetNames(),
     user: userPresets.map((p) => p.name),
   },
   appliedPreset,                                  // string | null — see (3)
   ```

2. **Resolve user presets in `applySettingsCommand`.** `agentCommands.ts:39-45` currently
   searches `BUILTIN_PRESETS` only. Change the signature to accept the user list:

   ```ts
   export function applySettingsCommand(
     settings: StudioSettings,
     cmd: AgentCommand,
     userPresets: readonly UserPreset[] = []
   ): StudioSettings | null
   ```

   Look up **user presets first**, then builtins (a user preset named like a builtin is
   allowed today — `PresetPicker` shows both — and the user's own wins). Keep the existing
   case-insensitive trim match at `:40-43`. Keep returning `null` for an unknown name.

3. **Add the acknowledgement.** This is the fix for the batch race. The backend docstring
   (`main.py:686-689`) already prescribes "re-read ui-state to confirm" — make that
   actually confirmable:
   - `App.tsx` holds `appliedPreset: string | null`, set when `apply_preset` succeeds and
     **sticky-until-replaced** (decided): it survives later `set_settings` patches and manual
     edits, and only changes when another preset is applied or the session resets
     (`handleNew` / `load_video`). It means "this preset is the basis of the current style",
     not "the live style is byte-identical to this preset".
     Rationale: the common batch flow is `apply_preset` → small `set_style` tweak → `render`,
     and a strict flag would read `null` there and look like a failure to an agent that
     checks it. The ack in 4.2 only needs to confirm *the apply landed*, which sticky does.
   - It rides the existing mirror. No new endpoint, no new transport.
   - MCP-side, `apply_preset` polls `get_ui_state()` until `appliedPreset` matches, with a
     bounded wait (see Phase 4.2). The 300 ms mirror debounce means a ~2-3 s ceiling is ample.

4. **Toast.** `toastMessageForCommand` (`agentCommands.ts:71-89`) returns a generic
   "Agent applied a preset." — include the name so the attended operator can see which.

### Documentation references

- Preset lookup to modify: `agentCommands.ts:39-45`
- Mirror payload: `App.tsx:121-126`
- Dispatch call site (pass the new third arg): `AgentLiveSync.tsx:113`
- `UserPreset` shape: `PresetPicker.tsx:26-29` (moved to the hook in Phase 1)
- Existing unit-test file to extend: `src/renderer/src/lib/agentCommands.test.ts` if present, else create alongside `presets.test.ts`

### Verification checklist

- [ ] Unit test: `applySettingsCommand` applies a user preset by exact name, by
      differing case, prefers a user preset over a same-named builtin, and returns `null`
      for an unknown name.
- [ ] Unit test: `appliedPreset` clears when a `set_settings` patch follows an `apply_preset`.
- [ ] Manual: save a preset in the UI named `MCP Test`; `get_ui_state()` lists it under
      `presetsDetail.user`; `apply_preset("MCP Test")` visibly changes the canvas preview
      and `appliedPreset` becomes `"MCP Test"` within ~1 s.
- [ ] A user preset carrying a `customFontPath` applies and the mirrored
      `render.config.custom_font_path` is that absolute path.
- [ ] `grep -n "BUILTIN_PRESETS" src/renderer/src/lib/agentCommands.ts` → still present (builtins are a fallback, not removed).

### Anti-pattern guards

- ❌ Do not read `presets.json` from the renderer directly — go through IPC.
- ❌ Do not drop the `presets` key from the mirror; `mcp_server/server.py:183-190` and any
      existing agent prompt depend on it.
- ❌ Do not have the MCP tool sleep a fixed duration instead of polling for `appliedPreset`.
      A fixed sleep is exactly the race this phase exists to remove.

---

## Phase 3 — `load_video`: import a video into the open app

Closes gap 5. Depends on Phase 1 (control socket must be live on the `'file'` screen).

### What to implement

1. **Backend: register the op.** Add `"load_video"` to `AGENT_COMMAND_OPS`
   (`backend/main.py:174`). The relay at `:693` is op-agnostic and needs no change.
   Validate in the endpoint that `payload.path` is a non-empty string **and an existing
   file** before broadcasting — fail loudly with a 400 rather than broadcasting a command
   the renderer will silently drop. Mirror the existing check style at `main.py:522`.

2. **Renderer: handle it.** In the `onCommand` dispatch, add a `load_video` branch that
   performs the `'file' → 'progress'` transition. Per the state machine
   (`App.tsx:71-77`), the minimum is `setFilePath(path)` then `setScreen('progress')` —
   `ProgressScreen` self-starts the transcription from `filePath` (`ProgressScreen.tsx:54-75`)
   and its `onDone` → `handleTranscribeDone` (`App.tsx:79-83`) sets `result`, bumps
   `resultsSessionId` and moves to `'results'`.

   Guard rails:
   - If `screen === 'progress'`, reject (a job is in flight) — surface a toast.
   - If `screen === 'results'` with unsaved work, run the same reset `handleNew` does
     (`App.tsx:85-94`) so no state leaks between batch items. **This is the batch-safety
     requirement** — stale `groups`/`groupsEdited`/`sourceVideoInfo` carrying into the next
     video is the most likely batch bug.
   - Accept an optional `payload.language` / `payload.diarize` and persist them the way
     `SettingsPanel` does (`SettingsPanel.tsx:79-107`) before transitioning, since
     `ProgressScreen` reads them from app-state at `:54-76`.

3. **Progress visibility.** The agent should be able to poll `get_status()`
   (`mcp_server/server.py:56`) → `GET /api/status` and see the job run to
   `JobStatus.DONE`. Confirm no change is needed here; it should already work because
   `broadcast_progress` (`main.py:229`) updates `current_status` regardless of clients.

### Documentation references

- Op allowlist: `backend/main.py:174`; rejection at `:691-692`; file-exists check style at `:522`
- Screen transitions: `App.tsx:71-77` (`handleFileSelected`, `handleStart`), `:79-83` (`handleTranscribeDone`), `:85-94` (`handleNew`)
- ProgressScreen self-start + StrictMode guard: `ProgressScreen.tsx:52`, `:54-76`
- Job-option persistence: `SettingsPanel.tsx:79-107`, `electron/main.js:374-380`

### Verification checklist

- [ ] `POST /api/agent/command {"op":"load_video","payload":{"path":"/nonexistent.mp4"}}` → 400, and nothing is broadcast.
- [ ] With the app on the drop screen, the same call with a real path moves the UI to the progress screen and transcription starts.
- [ ] Called while on `'results'` with a previous video loaded: the new video transcribes and `get_ui_state()` afterwards shows `groups` for the **new** video only, `groupsEdited: false`.
- [ ] Called while `screen === 'progress'` → rejected, existing job unaffected.
- [ ] `get_status()` reaches `done` without the agent holding a websocket.

### Anti-pattern guards

- ❌ Do not have the renderer POST `/api/transcribe` itself from the command handler —
      `ProgressScreen` already owns that, and duplicating it re-introduces the
      double-start bug the `startedRef` guard at `ProgressScreen.tsx:52` exists to prevent.
- ❌ Do not skip the reset when replacing a loaded project.
- ❌ Do not accept a path the backend has not confirmed exists.

---

## Phase 4 — MCP tool surface

Closes gaps 1, 3, 4. Depends on Phases 2 and 3.

### 4.1 `list_presets`

Read-only. Copy the template at `mcp_server/server.py:55-58`.

```python
@mcp.tool()
def list_presets() -> dict:
    """Style presets available in the open app: {"builtin": [...], "user": [...]}."""
```

Read from `get_ui_state()`; fall back to the legacy `presets` key when `presetsDetail`
is absent (an older renderer). Do **not** add a client method for this — `get_ui_state()`
already exists at `client.py:94`.

### 4.2 Extend `apply_preset` with the ack

`mcp_server/server.py:205-213` currently fires and returns `{"status":"ok"}` blind.
Keep `send_command("apply_preset", {"name": name})`, then poll `get_ui_state()` until
`appliedPreset == name`, bounded (~3 s, short interval). Return
`{"status":"ok","applied":name}` on confirmation, or a clear
`{"status":"unconfirmed", "hint": ...}` on timeout — listing the available names, since
the overwhelmingly likely cause is a name that matches neither family. Update the
docstring: it currently says built-in only.

### 4.3 `render` — the missing classic render tool

```python
@mcp.tool()
def render(output_dir: str = "", use_ui_config: bool = True) -> dict:
    """Render the final video with the classic (Pillow) engine. Blocks for minutes."""
```

- Add `render_video(payload: dict)` to `CapForgeClient` alongside `render_hyperframes`
  (`client.py:109-111`) — same shape, `_LONG_TIMEOUT`, `POST /api/render-video`.
  The agent token is accepted by `require_local_token` (`backend/main.py:309-326`).
- With `use_ui_config=True` (default): read `get_ui_state()`, take the mirrored
  `render` body **verbatim** — it already contains the resolved `config` *and*
  `custom_groups` — override only `output_dir` when the caller supplies one.
  This is the whole reason no Python-side style logic is needed.
- Fail with an actionable message when `current_ui_state` is missing (`ui-state` 404) or
  has no `render` key: "Open a video in CapForge first."
- Return `{"status":"ok","file":"<abs path>"}`; pass through `{"status":"cancelled"}`.
- Leave `output_dir` empty by default so `resolve_output_dir`
  (`hyperframes_project.py:313-326`) puts the output next to the source media.

### 4.4 Batch recipe in the MCP README

Add a worked example to `mcp_server/README.md` showing the intended loop and, critically,
the ordering constraint — **`apply_preset` must be confirmed before `render`**, because
`render` reads the mirror and the mirror is debounced:

```
for each video:
  load_video(path)                     # app moves to progress screen
  poll get_status() until done
  remove_filler_words()
  apply_preset("Mettro")               # returns only once confirmed
  render()                             # reads the mirrored config
```

### Documentation references

- Read-only tool template: `mcp_server/server.py:55-58`
- Command-relay tool template: `mcp_server/server.py:193-202`
- Long-timeout POST client method to copy: `mcp_server/client.py:109-111`
- Error/hint convention to imitate: `mcp_server/server.py:294-325` (`render_hyperframes`)
- Request model: `backend/models/schemas.py:215` (`VideoRenderRequest`)

### Verification checklist

- [ ] `list_presets()` returns a preset saved in the UI moments earlier.
- [ ] `apply_preset("<user preset>")` returns `applied`, not `unconfirmed`.
- [ ] `apply_preset("nope")` returns `unconfirmed` **with the available names in the hint**.
- [ ] `render()` with no args writes an mp4/webm next to the source video and returns its absolute path.
- [ ] `render(output_dir="/tmp/x")` writes there instead.
- [ ] `render()` before any video is loaded returns the actionable "open a video" message, not a raw 404/500.
- [ ] The rendered file visibly reflects the applied preset (font, colours, highlight style).
- [ ] `grep -c "@mcp.tool()" mcp_server/server.py` → 34 (31 today + `list_presets` + `render` + `load_video`; the Phase 3 op needs a tool of its own to be callable).

### Anti-pattern guards

- ❌ Do not build the render config in Python from `settings`. Use the mirrored `render` body.
- ❌ Do not use `_SHORT_TIMEOUT` for `render` — renders take minutes.
- ❌ Do not silently drop `custom_groups` from the mirrored body; manual group edits and
      per-group position overrides ride there (`render.ts:172-186`).

---

## Phase 5 — Verification

1. **Automated.**
   - `npx tsc --noEmit` and `npm run build` clean.
   - `npx vitest run` — all renderer tests, especially `presets.test.ts` (`ROUND_TRIP_KEYS` unchanged) and the new `agentCommands` tests.
   - `.venv-dev/bin/python -m pytest` — backend suite green.
   - `.venv-dev/bin/python -m pytest mcp_server -q` — note `pyproject.toml` `testpaths` excludes `mcp_server`, so this must be run explicitly.

2. **Anti-pattern grep gate.**
   - `grep -rn "buildRenderBody\|vanillaToStudio" backend/ mcp_server/` → **no hits**.
   - `grep -rni "presets" backend/` → only the pre-existing 4 hits (`main.py:174`, `main.py:677`, and two unrelated `-preset medium` in `ffmpeg_encode.py:99,315`).
   - `grep -rn "ws/control" backend/ src/` → no *new* hits (stale comments at `main.py:173,685` may be corrected but not added to).
   - `grep -rn "presets:" electron/preload.js src/preload/index.ts` → the two preloads still agree (no new channel was added; if one was, both files must have it).

3. **End-to-end batch smoke (the real acceptance test).**
   With CapForge open on the drop screen and 3 short test videos, have an agent run the
   Phase 4.4 loop unattended-in-spirit (you watching, not intervening). Confirm:
   - all three render;
   - each output reflects the chosen user preset;
   - no state bleeds between videos — check video 2 and 3 don't inherit video 1's groups,
     resolution or position overrides;
   - the app is left on the results screen for video 3, usable by hand.

4. **Regression sweep on the attended UI.** Because Phase 1 changes when the control
   socket and mirror are live, re-check: preset save/delete/export/import; the agent
   transcript-edit Apply/Dismiss bar; HyperFrames render approval; and Cmd+Z settings undo.

---

## Risks and open items

- **Mirror debounce is load-bearing.** The `appliedPreset` ack makes preset→render safe,
  but any *other* agent write followed immediately by `render()` has the same 300 ms race.
  If more such pairs appear, promote the ack to a general `stateVersion` counter rather
  than adding per-field flags.
- **`presets.json` is written non-atomically** (`electron/main.js:602-604`) and a parse
  failure silently yields `{}` (`:597-599`). A batch run that saves presets concurrently
  could truncate the library. Out of scope here, worth a separate fix.
- **`restoreFromProjectFile` never checks the source file still exists** (`App.tsx:206-239`).
  Not on the batch path, but the same class of bug — a `load_video` for a moved file is
  guarded in Phase 3, project-open is not.
- **Headless mode is deliberately deferred.** If it is ever wanted, the seam is: extract
  "resolve preset name → mirrored render body" as the contract, and give a headless runner
  a way to produce that body — *not* a Python reimplementation of the bridge.
