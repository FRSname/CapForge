# Plan: multi-language caption tracks (language tabs)

**Status:** SHIPPED on `feat/caption-tracks` (Phases 1–6). Sections marked
"**As shipped**" record where the implementation deliberately diverged from the plan; the
plan text around them is left intact as the record of what was intended. The reference
documentation for the shipped feature is [docs/caption-tracks.md](../caption-tracks.md) —
read that first if you are changing the feature rather than auditing this plan.

| Phase | Commit | Scope |
|---|---|---|
| 1 | `6c8cb3a` | pure caption-track core, staleness/timing rules, project file v2 |
| 2 | `8bd9d2f` | App owns a track store; ResultsScreen edits one track per mount |
| 3 | `2c799ca` | language tabs, picker, per-group markers, reflow banner |
| 4 | `38f5cd5` | backend `track_id` mirror selection, layout scan, name suffixes, track command ops |
| 5 | `c7d8943` | MCP track tools — `create_track`, `set_track_text`, `get_track`, `reflow_track` |
| 6 | (this doc + `docs/caption-tracks.md`, `CLAUDE.md`, `mcp_server/README.md`) | verification gates, docs, manual-QA list |

Executable plan derived from the brainstorm in
[multi-language-caption-tracks.md](multi-language-caption-tracks.md), whose decisions
D1–D7 stand except where a **Correction** below says otherwise. The brainstorm stays as
the record of *why*; this document is the record of *what, where, and in which order*.
**Branch:** `feat/caption-tracks` (created from `main` via `git-ops` before Phase 1).
**Orchestration:** each phase is dispatched to the `implementer` agent (never pass a model
override — agent pins handle routing). Use `scout` only if a phase hits a fact gap. All git
writes go through `git-ops`. Phases are self-contained; run them consecutively in fresh
contexts, one commit per phase.
**Provenance:** every `file:line` below was read from source on 2026-09-09. Lines drift —
grep for the symbol, not the number.

---

## The one constraint to defend

`buildRenderBody()` (`src/renderer/src/lib/render.ts:70`) is the choke point: *(settings +
groups + edited flag)* in, snake_case render body out. A track is a named bundle of exactly
those inputs, so **none of the three caption renderers change**: no `useSubtitleOverlay.ts`,
no `video_render.py` drawing code, no `hyperframes_caption_html.py`, no goldens, no
`docs/caption-parity.md`, and — critically — **no new field on `VideoRenderConfig`** (which
would trigger the seven-file settings pipeline and `test_caption_cfg_contract.py`).

Phase 6 turns this into grep gates. Any phase that finds itself editing a renderer formula
has taken a wrong turn; stop and re-read this section.

The one backend file this plan touches below the render boundary is `video_render.py`, and
only to **move** two blocks out of `_render_frame` into module-level functions so the layout
scan can call them (Phase 4). That is a behaviour-neutral extraction pinned by the golden and
parity suites, not a formula change.

---

## Corrections to the brainstorm (verified against source — these override it)

1. **A typo fix keeps its `wid`.** `wordTiming.ts:185-198`: a one-for-one rewrite
   (`"teh" → "the"`) carries `removed[k].wid` forward on purpose, so `reconcileGroups` does
   not read it as delete+insert. The brainstorm's staleness reference ("a corrected word …
   receives a fresh `wid`") is therefore wrong: comparing wid sets alone would **never**
   mark a typo fix stale. The recorded reference must be `{wid, text}` pairs and the
   comparison must include normalized text (§D below).
2. **There is no canonical group state on the backend, and none is added.** Groups reach
   the backend only as the renderer's mirror (`PUT /api/ui-state` → `current_ui_state`,
   `main.py:172,672-677`) and as `custom_groups` on a render/export request.
   `render_frame` and `check_layout` already read `current_ui_state["render"]` through
   `_agent_frame_inputs()` (`main.py:775-811`). Tracks ride exactly that mirror. Agent
   writes stay **fire-and-forget commands** confirmed by polling the mirror — the pattern
   `apply_preset` already uses (`mcp_server/server.py:292-338`). Nothing in Python
   re-implements a track rule; every rule has one TypeScript implementation.
3. **The proportional-by-character timing already exists.** `retimeWords`'s `distribute()`
   (`wordTiming.ts:91-115`) weights each token by `max(length, 1)` above a
   `MIN_WORD_DUR` floor. `retimeWords([], tokens, {start, end})` is precisely D2's
   "derive word timings proportionally by character count across the group span". Do not
   write a second text→timing path; D3's bake *is* a `retimeWords` call.
4. **`reconcileGroups` Rule 4 would delete untranslated groups.** `groups.ts` Rule 4 drops
   groups left with no words. D6 needs word-less placeholder groups (blank caption, own
   timing) to survive a text-view edit on the translated tab. Rule 4 gains one exception
   (Phase 1); and `buildRenderBody` drops word-less groups from the payload so no renderer
   ever sees an empty word list.
5. **`get_ui_state` already returns the full render body** including `custom_groups` with
   words (`server.py:219-232`). Track inventory goes there as a *compact* list; per-track
   bodies live in the mirror but are stripped from what the MCP tool returns.
6. **Three new tools, not two.** `set_track_text` addresses groups by id and cannot change
   the group count, so it cannot express "re-chunk the Polish to the source's new
   boundaries". `reflow_track` (mechanical skeleton rebuild with text carry-over) closes
   that gap; the agent then fills the blanks with `set_track_text`. Without it, "reflowed"
   is a state the agent can see but not repair.
7. **"Reflowed" is a track-level flag, not a per-group state.** A manual merge/split on the
   *Polish* tab is legitimate, and a per-group boundary comparison against the source would
   mark it reflowed forever. Content staleness stays per group and exact; "the source's
   chunking has changed since this track was created/reflowed" is one boolean per track.
   The brainstorm's worked examples still come out right (§D).
8. **`WordStylePopup`/`GroupPositionPopup` really are wired in both `ResultsScreen.tsx`
   (:920-945) and `GroupEditor.tsx` (:731, :743)**, as CLAUDE.md says. Irrelevant here:
   the per-group marker is a chip in the row, not a popup, so only `GroupEditor` changes.

---

## Architecture (the decisions every phase implements)

### A. Ownership: the renderer owns tracks; the backend mirrors; agents command and confirm

| Concern | Owner | Mechanism (all pre-existing) |
|---|---|---|
| Track list, active tab, every track's segments/groups/settings | `App.tsx` state | new `tracks` / `activeTrackId` state; `ResultsScreen` keeps owning the *active* track's editor state, keyed by track id so a tab switch remounts it (`resultsSessionId` precedent, `App.tsx:57-60,456`) |
| What the agent reads | mirror | `PUT /api/ui-state` (`App.tsx:161-187`, 300 ms debounce) gains `tracks[]`, `activeTrackId`, `agent.lastCommand*` |
| What the agent writes | commands | `POST /api/agent/command` → `broadcast_event` → `AgentLiveSync.handleCommand` (`main.py:688-722`, `AgentLiveSync.tsx:137-179`); three new ops in `AGENT_COMMAND_OPS` (`main.py:179`) |
| Confirmation | poll | each write command carries a tool-minted `command_id`; the renderer echoes `{id, status, error?}` in the mirror; the tool polls like `apply_preset` does |
| Rendering/QA of a non-active track | mirror | `_agent_frame_inputs(track_id)` selects `tracks[i].render` instead of the top-level `render` |

Consequences, stated plainly: track tools need the CapForge window open (409 "Open CapForge"
— the `load_video` precedent at `main.py:713-717`); the backend never validates a track rule
it does not own; and there are **no Python/TypeScript twins** in this feature.

### B. Data model

`src/renderer/src/types/app.ts` gains, on the existing types (same pattern as the group-only
`positionOverride`/`endEdited` fields at `:94,:100`):

```ts
/** Translated-track groups only: the source words this text was written from. */
Segment.sourceWords?: Array<{ wid: string; text: string }>
/** Translated-track groups only. Default (absent) = linked to the source span (D4).
 *  Set false when the user drags this group on the translated tab. */
Segment.timingLinked?: boolean
/** Translated-track groups only: the previous translation attached by a reflow, for the
 *  agent's context. Cleared when text is set. */
Segment.previousText?: string
/** true = timing derived from the group span (D3); absent = authoritative/pinned.
 *  Source words never carry it. A timeline drag deletes it. */
Word.timingDerived?: boolean
```

`src/renderer/src/lib/tracks.ts`:

```ts
export interface CaptionTrack {
  id: string; label: string; lang: string; isSource: boolean
  segments: Segment[]          // source: the transcript; translated: the text-view units (1:1 with groups at create)
  groups: Segment[]            // RAW groups (pre-closeGroupGaps), exactly what ResultsScreen holds
  groupsEdited: boolean        // translated tracks: always true (custom_groups always sent)
  segmentsEdited: boolean
  settings: StudioSettings
  appliedPreset: string | null
  /** translated only: the source grouping recorded at create/reflow — wid lists in order */
  sourceSnapshot?: { groupWids: string[][] }
}
export type TrackGroupState = 'clean' | 'stale' | 'untranslated'
```

Project-level metadata (`language`, `duration`, `audioPath`, `alignmentDegraded`) stays on
`App.result`; the source track's `segments` *are* `result.segments`.

### C. Timing model

- **Bake (D3)** = `retimeWords(group.words, tokenize(text), { start, end })`. Every emitted
  word that was not LCS-carried from the previous words is marked `timingDerived: true`;
  carried words keep whatever flag they had (a pinned word stays pinned, D3). A fresh
  translation (no previous words) is therefore exactly proportional-by-character.
- **Link (D4)** = `propagateSourceTiming(track, source)`, run in App whenever the source
  track's segments or groups change. For each translated group with `timingLinked !== false`
  and at least one surviving `sourceWords` wid: the linked span is
  `[first surviving wid's start, last surviving wid's end]`, **except** that when the first
  wid is the first word of its current source group the span takes that group's `start`, and
  when the last wid is the last word of its source group the span takes that group's `end`
  (this is what carries a manual drag or an `endEdited` end across; a source `endEdited` on
  that boundary sets `endEdited` on the translated group too, so gap closing respects it on
  both tabs). If the span changed: `start`/`end` move, pinned words are clamped into the
  span, and derived words are re-distributed proportionally between their pinned
  neighbours (`distribute` semantics). Reference-stable: unchanged input → same array.
- **Pin**: a timeline drag of a translated word deletes `timingDerived`; a drag of a
  translated group sets `timingLinked: false`. Both are edits on the translated tab's own
  state, wired where ResultsScreen already handles `onWordEdge`/`onSegmentEdge`.

### D. Staleness model (corrected per Corrections 1 & 7)

Inputs: the translated track, and `sourceById: Map<wid, {word: Word, groupIdx, isFirstInGroup, isLastInGroup}>` built from the source track's *groups*.

Per translated group:

| Test (in order) | State |
|---|---|
| `text.trim() === ''` | `untranslated` |
| any recorded wid missing from `sourceById`, **or** any recorded `text` ≠ current word text after `normalizeToken` (`wordTiming.ts:33-40`, NFC), **or** a source word whose *predecessor* (source document order) is in this group's recorded set is itself not recorded (the `reconcileGroups` Rule 3 attribution rule — an insertion belongs to the group that owns the word before it) | `stale` |
| otherwise | `clean` |

Per track: `reflowNeeded = !deepEqual(currentSourceGroupWids, track.sourceSnapshot.groupWids)`
(wid lists only — text changes never set it). Identity is all-or-nothing, matching
`groups.ts:373-377`: if any source word lacks a `wid`, every group is reported `stale` and
`reflowNeeded` is true rather than half-classifying.

Worked examples (must be the Phase 1 test table):

| Source edit | Result |
|---|---|
| typo fix (wid carried, text changed) | 1 `stale`, `reflowNeeded=false` |
| `wordsPerGroup` change | 0 `stale`, `reflowNeeded=true` |
| word inserted mid-transcript | 1 `stale` (the predecessor's group), `reflowNeeded=true` |
| `/api/realign` (wids and text preserved) | 0 `stale`, `reflowNeeded=false` |
| agent `set_track_text` on a stale group | that group re-records `sourceWords` from the current source → `clean` |
| manual merge of two Polish groups | `sourceWords` concatenated → still `clean` |

### E. The mirror contract (the seam between Phase 2 and Phases 4–5 — implement both sides against this)

`PUT /api/ui-state` body, a **superset** of today's `{screen, settings, groups, presets, presetsDetail, appliedPreset, render}` (those seven keep describing the *active* track, unchanged, for every existing agent prompt):

```jsonc
{
  "...": "the seven existing keys, unchanged",
  "activeTrackId": "src",
  "tracks": [
    {
      "id": "src", "label": "Original", "lang": "en", "isSource": true,
      "groupCount": 190, "staleCount": 0, "untranslatedCount": 0, "reflowNeeded": false,
      "appliedPreset": null,
      "groups": [ { "id": "s1:0", "start": 0.0, "end": 1.4, "text": "the red car" } ],
      "render": { "config": { "...": "snake_case VideoRenderConfig" }, "custom_groups": null }
    },
    {
      "id": "3f9c…", "label": "Polski", "lang": "pl", "isSource": false,
      "groupCount": 190, "staleCount": 1, "untranslatedCount": 0, "reflowNeeded": false,
      "appliedPreset": null,
      "groups": [ { "id": "3f9c:0", "start": 0.0, "end": 1.4, "text": "czerwony samochód",
                    "state": "stale", "sourceText": "the red cart", "previousText": null } ],
      "render": { "config": { "...": "…" }, "custom_groups": [ "…" ], "output_name_suffix": ".pl" }
    }
  ],
  "agent": { "lastCommandId": "c-01H…", "lastCommandStatus": "ok", "lastCommandError": null }
}
```

- `tracks[].render` is `buildRenderBody(track.settings, displayGroupsFor(track), track.groupsEdited)` — the same body the UI's own render/export uses. `output_name_suffix` is a **body** key (a sibling of `config`, never inside it): omitted on the source, `.${lang}` on translated tracks. A translated track always carries `custom_groups` — `[]` when every group is still a word-less placeholder — so the backend can never fall back to re-chunking the source transcript.
- `tracks[].groups` is compact (no words). `state`/`sourceText`/`previousText` appear on translated tracks only.
- The MCP `get_ui_state` tool returns `tracks` with `groups` and `render` **stripped** (inventory only). `get_track` reads `tracks[i].groups`. The backend serves the mirror verbatim.

### F. Project file: version 2 is additive, and older builds still open it

`ProjectFile` (`lib/project.ts:16-30`) keeps every v1 key with its v1 meaning — they describe
the **source** track — and adds:

```ts
version: 2
tracks?: TranslatedTrackFile[]   // translated tracks only; absent on v1 files
activeTrackId?: string           // absent → source
interface TranslatedTrackFile { id; label; lang; segments; groups; settings; appliedPreset; sourceSnapshot }
```

A v1 file is a v2 file with no `tracks`, so migration is `{...file, version: 2, tracks: file.tracks ?? []}` plus the existing per-track retrofits (`ensureWordIds`, `adoptWordIds`, `adoptEndEdited`) applied per track. Older builds ignore unknown keys and open the source track. `version > PROJECT_VERSION` is refused with a toast (there is no check today — `project:open` in `electron/main.js:825-838` returns raw JSON).

### G. Defaults chosen for the brainstorm's seven open questions

| # | Question | Default (implementer proceeds unless the user objects) |
|---|---|---|
| 1 | Tab strip placement | In `App.tsx`, directly above the `ResultsScreen` container (`App.tsx:453-463`), only when `screen === 'results'`. It must sit *outside* `ResultsScreen` because that component remounts per track. The StudioPanel sidebar is untouched — it just receives the active track's settings. |
| 2 | Per-language font fallback | **None in v1.** A new track copies the source's style verbatim (`copy_style_from` defaults to the source). `lib/languages.ts` records each language's script; if it is not Latin and the copied `fontFamily` resolves to a **bundled** font (`FontInfo.source === 'bundled'`, `lib/fonts.ts:14-18` — every file in `Fonts/` is a Latin display face), show one info toast suggesting a system font. No mapping table. |
| 3 | Export filenames / batch | `video.pl.mp4`, `video.pl.srt`: a validated `output_name_suffix` on the render/HyperFrames request bodies and a `track` on the export request. **No `tracks: "all"` batch mode in v1** — an agent loops over `render(track_id)`. |
| 4 | `.cfproj` migration | §F. Forward-compatible by construction; no deliberate break. |
| 5 | Presets | Per-track only (`apply_preset(name, track_id?)`). No "apply to all tracks" in v1. |
| 6 | Where markers surface | Tab badge (`staleCount`, `untranslatedCount`, a reflow dot); a chip per row in `GroupEditor` next to the `↺` end marker (`GroupEditor.tsx:543-548`); a one-line banner above the group list on a translated track when `reflowNeeded`, with a "Re-flow from source" button (the UI twin of `reflow_track`). |
| 7 | Autosave / size | `gather()` composes the v2 file from the track store; `useAutosave` deps add `tracks`. It already skips unchanged serializations (`useAutosave.ts:30`). Mirror cost is bounded by splitting the mirror into two effects (Phase 2). |

Two more defaults the brainstorm did not ask about:

- **Undo (D5):** settings undo becomes per-track (`useSettingsUndo` keyed by track id). Editor undo (`useUndoRedo`, segments/groups) is per-track *by remount*: switching tabs clears it. That satisfies D5's actual requirement (Cmd+Z never touches the other tab) at zero cost; preserving editor history across switches is a follow-on.
- **Agent transcript edits target the source track regardless of the active tab.** `update_words` / `remove_filler_words` push `result_updated`; today that lands in the mounted `ResultsScreen` via `applyAgentResult` (`App.tsx:151-153`, `ResultsScreen.tsx:372-378`). With a translated tab active that would corrupt the wrong track, so Phase 2 extracts the segments→groups sync into a pure function App can apply to the stored source track.

---

## Phase 0 — Allowed APIs (consolidated scout findings; do not re-derive, do not extend by guessing)

Sources read: `App.tsx`, `ResultsScreen.tsx`, `GroupEditor.tsx`, `AgentLiveSync.tsx`, `lib/{project,groups,wordIds,wordTiming,endEdited,render,api,agentCommands,settingsSanitize,undoStack,fonts}.ts`, `hooks/{useSettingsUndo,useUndoRedo,useAutosave,useSubtitleOverlay}.ts`, `types/app.ts`, `components/ui/SegmentedControl.tsx`, `backend/main.py`, `backend/models/schemas.py`, `backend/exporters/{frame_qa,video_render,hyperframes_project}.py`, `mcp_server/{server,client}.py`, `backend/tests/{conftest,test_agent_result,test_caption_cfg_contract}.py`, `mcp_server/tests/test_cleanup.py`, `vitest.config.ts`, `.github/workflows/ci.yml`.

| Concern | Location | Fact |
|---|---|---|
| App state | `App.tsx:25-70` | `screen`, `filePath`, `result`, `settings`, `groups` (display, published), `groupsEdited`, `resultsSessionId` (ResultsScreen `key`), `appliedPreset`, `projectIORef`, `pendingRestore` |
| Settings undo | `App.tsx:73-80`, `hooks/useSettingsUndo.ts:20-70`, `lib/undoStack.ts:15` | `useSettingsUndo(settings, setSettings)` → `{push, undo, redo}`; one ref-local stack; `MAX_HISTORY = 50`, 500 ms debounce |
| Mirror effect | `App.tsx:161-187` | 300 ms debounce; body `{screen, settings, groups, presets, presetsDetail, appliedPreset, render: buildRenderBody(settings, groups, groupsEdited)}`; resync snapshot at `:189-225`, `api.ts:600-601` |
| Agent result / overrides | `App.tsx:151-157` → `ResultsScreen.tsx:372-395` | forwarded through `projectIORef` to the mounted ResultsScreen |
| Project restore | `App.tsx:268-305`, `ResultsScreen.tsx:353-370` | pushes result to backend, sets state, bumps `resultsSessionId`, `pendingRestore` flushed at `:342-346`; ResultsScreen `restore` runs `adoptEndEdited(adoptWordIds(file.studioGroups, segments))` |
| Project file | `lib/project.ts:14-47` | `PROJECT_VERSION = 1`; `ProjectFile`; `ProjectIOHandle {gather, restore, applyAgentResult, applyWordOverrides}`; Electron `project:save/open` are opaque JSON (`electron/main.js:811-838`) |
| Autosave | `App.tsx:352-355`, `hooks/useAutosave.ts` | `useAutosave(getSnapshot, deps, 2000)`; snapshot = `gather()` |
| ResultsScreen ownership | `ResultsScreen.tsx:39-66,68-108,120,139-144,147-186,202-205,213-215` | props `{result, settings, onGroupsUpdate, projectIORef, onUndoRedoChange}`; local `segments`, `groups`, `groupsEdited`, `segmentsEdited`, `view`; `useUndoRedo`; `commitSegments`; the reconcile-or-rebuild effect (`groupsEdited && !wpgChanged` → `reconcileGroups`, else `buildStudioGroups` with position carry); `displayGroups = closeGroupGaps(...)`; publishes `displayGroups` |
| View tabs markup to copy | `ResultsScreen.tsx:809-830` | roving tabIndex pattern "from ui/SegmentedControl" (`SegmentedControl.tsx:64-80`, `role="radiogroup"/"radio"`) |
| Editor wiring | `ResultsScreen.tsx:859,875,901` | `SubtitleEditor`, `GroupEditor`, `AudioPlayer` all fed `segments`/`groups`/`settings` — no track awareness needed |
| GroupEditor rows | `GroupEditor.tsx:405-468,543-548` | row map; `↺` when `group.endEdited`; props `onChange` (boundary) vs `onPositionChange` (never flips `groupsEdited`) |
| Overlay/timeline inputs | `useSubtitleOverlay.ts:69-83`, `AudioPlayer.tsx:30-62` | `{segments, settings, resolution}` — track-agnostic |
| Groups core | `lib/groups.ts:21-59,147-188,296-315,363-377` | `buildStudioGroups` (ids `${seg.id}:${i}`), `closeGroupGaps`, `finalizeBounds`, `reconcileGroups` + the all-or-nothing `hasIds` rule; Rule 4 drops empty groups; Rule 6 carries `speaker`/`positionOverride` |
| Word identity | `lib/wordIds.ts:27-30,38-41,61-83,91-100` | `newWordId`, `withWordIds`, `adoptWordIds(groups, segments)`, `ensureWordIds` — all reference-stable |
| Word timing | `lib/wordTiming.ts:23,26-28,33-40,91-115,133+,185-198` | `MIN_WORD_DUR`, `tokenize`, `normalizeToken`, `distribute` (char-weighted), `retimeWords(oldWords, newTokens, bounds)`, wid carry on 1-for-1 rewrite |
| endEdited retrofit | `lib/endEdited.ts:43-54` | `adoptEndEdited` — the derived-until-touched retrofit idiom |
| Render body | `lib/render.ts:24-26,70-210,186-207` | `pct()`; `buildRenderBody(settings, groups, groupsEdited, overrides = {}, outputDir?)`; `custom_groups` sent when edited or any `positionOverride`; strips `wid` (:201); `custom_font_path: settings.fontPath` (:88) |
| Render body callers | `App.tsx:180,220`, `hooks/useRender.ts:115,166` | mirror + resync; UI classic + HyperFrames render |
| API client | `lib/api.ts:158-161,182-184,267-297,359-387,510-537` | `AgentCommand`, `ControlHandlers`, `post/put` (local-token header attached centrally), `updateResult`, `putUiState`, `exportResult`, `renderVideo`, `exportHyperframes`, control socket dispatch of `result_updated` / `agent_command` |
| Agent commands (renderer) | `lib/agentCommands.ts:77-117`, `AgentLiveSync.tsx:137-179` | `applySettingsCommand(settings, cmd, userPresets)` (pure, sanitizes); `handleCommand` handles `load_video`, `set_word_overrides`, else settings; ignores commands off the results screen |
| Sanitizer | `lib/settingsSanitize.ts:254-269` | `sanitizeSettings` — run on every restored/copied `StudioSettings` |
| Fonts | `lib/fonts.ts:14-18,113-130`; `Fonts/` | `FontInfo {name, path, source: 'system'|'bundled'|'custom'}`; `loadAllFonts()`; bundled faces are Latin display fonts; no language→font mapping exists |
| Backend state | `main.py:131,142,172,179` | `current_result`, `ws_clients`, `current_ui_state` (raw dict), `AGENT_COMMAND_OPS = {"set_settings","apply_preset","set_word_overrides","load_video"}` |
| ui-state routes | `main.py:672-677,680-685` | `PUT /api/ui-state` (ungated, raw dict — keep it that way, CLAUDE.md), `GET /api/agent/ui-state` (agent token) |
| Command route | `main.py:688-722` | validates `op`, `load_video` validates path + 409 when `not ws_clients`, then `broadcast_event({"type":"agent_command", "op", "payload"})` |
| Frame inputs | `main.py:775-811,814-831,834-844` | `_agent_frame_inputs()` → `(VideoRenderConfig, custom_groups)` from `current_ui_state["render"]`, 409 with a field-naming hint on validation failure; `/api/render-frame`, `/api/agent/check-layout` |
| Layout analysis | `frame_qa.py:35-52,103-139` | `_active_group`, `render_overlay(result, config, custom_groups, t)`, `analyze_layout(result, config, t, custom_groups, platform)` — full-frame render, bbox only |
| Pillow measure + wrap | `video_render.py:190,428-472,1049-1140` | `_get_font`, `groups_for_render` (custom groups bypass gap closing; RSVP reels), and inside `_render_frame`: the metrics loop (:1058-1074) and the row split (:1096-1135) |
| Export | `main.py:848-855,1636-1668`, `schemas.py:132-134` | `export_result(ExportRequest)` → `_do_export(result, formats, output_dir, audio_path)`; `stem = Path(audio_path).stem`, `f"{stem}{ext}"`; exporters take a `TranscriptionResult` |
| Classic render | `main.py:880-925`, `video_render.py:1701-1730`, `schemas.py:238-254` | `VideoRenderRequest {config, output_dir, custom_groups}`; `render_subtitle_video(result, config, output_dir, on_progress, source_video_path, custom_groups)`; `stem = Path(result.audio_path).stem`; `CustomGroup {text,start,end,words,position_x,position_y}` — **no `id`** |
| HyperFrames render | `main.py:965+,1029,1084,1108`, `schemas.py:257-266` | `HyperframesRenderRequest {…, use_ui_config}`; `f"{stem}_hyperframes{ext}"` |
| Output dir sandbox | `hyperframes_project.py:322-334` | `resolve_output_dir(output_dir, source_path)` |
| Schemas | `schemas.py:81-102` | `WordSegment`, `Segment`, `TranscriptionResult` (backend words carry no `wid`/`overrides` fields; `words: list[dict]` on `CustomGroup` passes them through) |
| MCP server | `server.py:23-30,33-44,219-232,258-289,292-338,356-366,383-390,418-452,455-484` | `FastMCP("capforge")`, `_APPLY_PRESET_POLL/TIMEOUT`, `WordEdit`, `get_ui_state`, `set_style`, `apply_preset` (send → poll mirror → `unconfirmed` with hint), `render_frame`, `check_layout`, `render` (submits mirrored body verbatim), `render_hyperframes` |
| MCP client | `client.py:47-69,94-101,109-115,173-192` | `_request`, `get_ui_state`, `send_command(op, payload)`, `check_layout(t, platform)`, `render_video`, `render_hyperframes`, `get_frame` |
| Backend test harness | `backend/tests/test_agent_result.py:25-84`, `conftest.py:12-48` | `main_module` (stubs whisperx/torch), `client` (seeds `current_result`, sets `AGENT_TOKEN`), `_auth()` header |
| Frontend tests | `vitest.config.ts:23-26`, `groups.test.ts:15-49`, `Button.test.tsx:4-20`, `rsvpFixtures.testutil.ts:22-26` | `node` env; inline fixture builders; `renderToStaticMarkup`; shared JSON fixtures only when a Python twin exists (none here) |
| CI | `.github/workflows/ci.yml:8-50` | frontend `typecheck && test && lint`; backend `python -m pytest` (backend/tests only — `mcp_server/tests` needs an explicit path) |

### Anti-patterns (repo-verified — do NOT do these)

- **Do not** add a field to `VideoRenderConfig` or `StudioSettings` for anything track-related. Track identity is not a style. (`output_name_suffix` goes on the *request* models, which `test_caption_cfg_contract.py` does not partition.)
- **Do not** give the backend canonical track state or a Python copy of any track rule (bake, link, staleness, reflow). One implementation, in `lib/`.
- **Do not** route translation through `update_words`/`apply_word_edits` (segment-index contract, source-correction semantics) — but **do** reuse `retimeWords` (the lib primitive) for the bake. Do not write a second `distribute`.
- **Do not** compare wid sets alone for staleness (Correction 1).
- **Do not** make agent write tools synchronous by mutating backend state. Command + confirm-by-poll, like `apply_preset`.
- **Do not** re-slice words by index or word count anywhere (CLAUDE.md → group membership identity). `reflowTrack` is a wid-set carry-over, not a re-slice.
- **Do not** let a translated track hit the `buildStudioGroups` rebuild branch (`ResultsScreen.tsx:169-184`) — its groups are inherited, `wordsPerGroup` is inert there.
- **Do not** put the tab strip inside `ResultsScreen` (it remounts per track).
- **Do not** gate `PUT /api/ui-state` (CLAUDE.md → "Deliberately ungated UI mirrors").
- **Do not** persist `previousText` beyond the next `set_track_text` on that group, and do not mirror words inside `tracks[].groups`.
- **Do not** call `closeGroupGaps` twice on the same groups (`groups_for_render` docstring); `displayGroupsFor(track)` is the single renderer-side call.
- **Do not** synthesize a `delete_track` tool (D7).

---

## Phase 1 — Pure core: track model, staleness, timing, reflow, project v2 (agent: implementer)

Do this first and alone: ~400 lines of pure TypeScript with no React, fully unit-tested, and
every later phase calls into it. TDD: write the worked-example tables as tests first.

### What to implement

1. **`src/renderer/src/lib/languages.ts`** — `LANGUAGES: ReadonlyArray<{ code, label, nativeLabel, script: 'latin' | 'cyrillic' | 'greek' | 'other' }>` (~30 entries: European + major world languages, ISO 639-1 codes), `languageLabel(code)`, `languageScript(code)`, `isKnownLanguage(code)`. Pure data.
2. **`types/app.ts`** — the four optional fields from §B, with doc comments in the style of `:92-100`.
3. **`src/renderer/src/lib/tracks.ts`** (split into `tracks.ts` + `trackStaleness.ts` + `trackTiming.ts` if any file passes ~400 lines):
   - `CaptionTrack`, `TrackGroupState`, `SOURCE_TRACK_ID = 'src'`.
   - `newTrackId(): string` — copy the shape of `newWordId` (`wordIds.ts:27-30`), prefix `t`.
   - `createTrackFromSource(source: CaptionTrack, opts: { id, lang, label?, settings? }): CaptionTrack` — one translated group per source **raw** group, same `start`/`end`/`speaker`/`positionOverride`/`endEdited`, `id: \`${opts.id}:${i}\``, `text: ''`, `words: []`, `sourceWords` = the source group's `{wid, text}` pairs, `segments` = a 1:1 copy of the groups, `groupsEdited: true`, `settings: sanitizeSettings(opts.settings ?? source.settings)`, `sourceSnapshot` recorded. **Throws** if any source word lacks a `wid` (the caller refuses; brainstorm "refuse on a source it cannot identify").
   - `bakeTranslation(group: Segment, text: string, sourceById): Segment` — §C bake: `retimeWords` over `{start, end}`, mark non-carried words `timingDerived`, mint wids via `withWordIds`, set `text`, re-record `sourceWords` from the current source, delete `previousText`. Empty text → `words: []`, keeps `sourceWords`.
   - `classifyTrack(track, source): { byGroup: Map<string, TrackGroupState>; staleCount; untranslatedCount; reflowNeeded }` — §D exactly. Build `sourceById` once per call.
   - `sourceTextFor(group, sourceById): string` — the current words for the group's recorded wids **plus** attributed insertions, in source order; what `get_track` shows as `sourceText`.
   - `propagateSourceTiming(track, source): CaptionTrack` — §C link; reference-stable when nothing moves. Words re-distributed between pinned neighbours reuse `distribute` — export it from `wordTiming.ts` (it is module-private today) rather than copying it.
   - `reflowTrack(track, source): CaptionTrack` — new skeleton from the current source groups (new group ids `\`${track.id}:r${n}:${i}\`` where `n` counts reflows, so stale ids can never collide); a new group whose wid list **exactly** equals an old group's recorded wid list carries that group's `text`, `words`, `timingLinked`, `endEdited`; every other new group is blank with `previousText` = the old texts whose recorded wids overlap it, joined by `' / '`. Re-records `sourceSnapshot`.
   - `displayGroupsFor(track): Segment[]` — `closeGroupGaps(track.groups, settings.gapCloseThreshold, settings.lastGroupHold)`, the one call ResultsScreen makes today (`:203`).
   - `syncSegmentsIntoTrack(track, segments, wordsPerGroup, wpgChanged): CaptionTrack` — the body of the reconcile-or-rebuild effect (`ResultsScreen.tsx:158-184`) as a pure function: `ensureWordIds`, then `reconcileGroups` when `groupsEdited && !wpgChanged`, else the `buildStudioGroups` rebuild with position carry; **never** the rebuild branch when `!track.isSource`. Phase 2 makes ResultsScreen's effect call this.
   - `trackToMirrorEntry(track, source, classification)` — §E's `tracks[]` element (`render` via `buildRenderBody`).
4. **`lib/groups.ts`** — Rule 4 exception: a group with `sourceWords` survives with no words (it is a placeholder with its own timing). Rule 6 carries `sourceWords`, `timingLinked`, `previousText` alongside `speaker`/`positionOverride`. `finalizeBounds` must not touch a placeholder's `start`/`end` (it already returns early on `words.length === 0`).
5. **`lib/render.ts`** — `buildRenderBody(settings, groups, groupsEdited, overrides = {}, outputDir?, nameSuffix = '')`: emits `output_name_suffix: nameSuffix`, includes `id` on each custom group, and **drops groups with no words** before mapping (Correction 4). Existing tests must not change.
6. **`lib/project.ts`** — `PROJECT_VERSION = 2`, the §F types, `migrateProjectFile(raw: unknown): ProjectFile` (validates `version`, refuses `> PROJECT_VERSION` with a typed error, lifts v1 → v2), `tracksFromProjectFile(file): { tracks: CaptionTrack[]; activeTrackId }` (applies `ensureWordIds`/`adoptWordIds`/`adoptEndEdited` per track — copy the order from `ResultsScreen.tsx:353-370`), `projectFileFromTracks(meta, tracks, activeTrackId): ProjectFile`. Round-trip must be lossless.
7. **`types/app.ts` `Word`/`Segment`** doc comments and **`lib/settingsSanitize.ts`** unchanged (translated tracks' settings pass through `sanitizeSettings` at create/restore, which already exists).

### Documentation references

- Reference-stable / immutable conventions: `wordIds.ts:38-41`, `endEdited.ts:43-54`, `groups.ts:296-315`.
- The all-or-nothing identity rule to mirror: `groups.ts:373-377`.
- Inline fixture builders to copy: `groups.test.ts:15-37` (`word`, `makeSegment`).
- Text normalization for the staleness compare: `wordTiming.ts:33-40`.

### Verification checklist

- [ ] `npx vitest run src/renderer/src/lib/tracks src/renderer/src/lib/languages src/renderer/src/lib/project src/renderer/src/lib/groups src/renderer/src/lib/render` green.
- [ ] `classifyTrack` test table = the six §D worked examples, each asserting `staleCount`, `untranslatedCount`, `reflowNeeded`, and *which* group is stale.
- [ ] `bakeTranslation('', …)` keeps the group (words `[]`), and `reconcileGroups` keeps it too after a neighbouring text edit.
- [ ] `propagateSourceTiming`: dragging the source group's end by +0.2 s moves the linked Polish end by +0.2 s, leaves a `timingLinked: false` group alone, clamps a pinned word, and returns the *same reference* when nothing moved.
- [ ] `reflowTrack` after a `wordsPerGroup` 4→6 regroup: every carried group has identical text and its `previousText` is undefined; every blank group has `previousText` containing the overlapped Polish; no two group ids collide with the pre-reflow ids.
- [ ] `createTrackFromSource` throws when one source word lacks `wid`.
- [ ] `migrateProjectFile` round-trips a v1 fixture (no `tracks`) to `{version: 2, tracks: []}` and refuses `version: 3`.
- [ ] `buildRenderBody` drops a word-less group and emits `output_name_suffix`; `grep -n "wid" src/renderer/src/lib/render.ts` still shows only the strip.
- [ ] `npm run typecheck && npm run lint` clean.

### As shipped (2026-09-09)

- `tracks.ts` split three ways: `tracks.ts` (model, create/reflow/mirror), `trackStaleness.ts` (§D), `trackTiming.ts` (§C). `trackFixtures.testutil.ts` holds the shared test builders.
- `adoptEndEdited` runs on the **source** track only in `tracksFromProjectFile`: the retrofit infers "hand-placed" from `end ≠ last word's end`, which is the *normal* state of a source-linked translated group, so applying it there would exempt every translated group from gap closing. Translated groups always carry `endEdited` explicitly.
- `reconcileGroups` gained a second guard beyond the Rule 4 exception: when every group word has vanished and any group carries `sourceWords`, it returns `previous` unchanged rather than a document-order rebuild — otherwise a freshly created all-placeholder track would be re-chunked by its own segments on the first sync. Source tracks never carry `sourceWords` and take the old paths verbatim (traced in review).
- `mergeGroups`/`splitGroup` carry the track fields: merge concatenates `sourceWords` and keeps `timingLinked` only if both sides were linked; split gives both halves the full record with `timingLinked: false` (a linked half would be snapped back to the full source span). `previousText` is dropped by both.
- `bakeTranslation` takes an optional 4th arg `{ allRecorded, isFirstGroup }` (the track-level recorded-wid set) so insertion attribution can tell "new word" from "my neighbour's word"; `classifyTrack`/`trackToMirrorEntry` pass it, and Phases 2/5 **must** pass it too.
- `buildRenderBody` drops word-less groups from `custom_groups` but keeps emitting the key (as `[]`) whenever `groupsEdited` and the caller passed any groups at all — HEAD's `groups.length > 0` gate, not the drawable count — so an all-placeholder translated track can never fall back to backend re-chunking (see the Phase 4 `is not None` guard). `buildRenderBody(settings, [], true)` still emits no key (pinned by a pre-existing test).
- `createTrackFromSource` inherits `appliedPreset` from the source when the style is inherited, `null` when explicit `settings` are passed.
- `reflowTrack` derives its reflow counter from the existing `:r<N>:` group ids (group ids are structured; word ids are the ones nothing may parse).
- Validation at the `.capforge` trust boundary is hand-rolled (typed `ProjectFileError` / `ProjectVersionError`), matching `electron/preset-io.js` — Zod is not a dependency.

### Anti-pattern guards

- No React imports, no `window`, no I/O in any of these modules.
- No second `distribute`/LCS — import from `wordTiming.ts`.
- No wid-only staleness compare; no per-group "reflowed" state.
- `tracks.ts` must not import from `components/` (it *may* import the `StudioSettings` type — that is the existing `render.ts` precedent).

---

## Phase 2 — Renderer ownership: the track store, invisible to a single-track project (agent: implementer)

The whole phase is a refactor with **no visible change** for a project with one track. The
regression gate is: every existing test passes untouched, and the manual smoke at the end
behaves exactly as `main` does.

### What to implement

1. **App state** (`App.tsx`): replace `result.segments`-as-truth + `settings` + `groups` + `groupsEdited` + `appliedPreset` with `tracks: CaptionTrack[]` (source first) and `activeTrackId`; keep `result` for project metadata. Derive `activeTrack`, `sourceTrack`, `settings = activeTrack.settings`, `displayGroups = displayGroupsFor(activeTrack)`, `classifications = useMemo(tracks.map(t => t.isSource ? null : classifyTrack(t, sourceTrack)))`. Every place that read the old state reads the derived value; `StudioPanel`, `AgentLiveSync`, `useRender` callers are prop-fed and do not change.
2. **Per-track settings undo**: `useSettingsUndo(settings, setSettings, activeTrackId)` — hold `Map<trackId, {undo: T[], redo: T[]}>` in the ref, select by key, `MAX_HISTORY` per key. `handleSettingsChange` writes to `tracks[active].settings`.
3. **ResultsScreen props** (`:39-56`): add `trackId`, `autoGroup: boolean`, `initialGroups: Segment[] | null`, `initialGroupsEdited: boolean`; replace `onGroupsUpdate(displayGroups, edited)` with `onTrackStateChange({ segments, groups, groupsEdited, segmentsEdited })` publishing **raw** state (deps: those four). Initialize `groups` from `initialGroups ?? buildStudioGroups(...)`. Make the reconcile effect call `syncSegmentsIntoTrack` (Phase 1) so the logic exists once; with `autoGroup=false` it never rebuilds. Retire `restore` from `ProjectIOHandle` and `pendingRestore` (initial props replace them); keep `gather` only as `App`'s composition of `projectFileFromTracks` (move it to App). Keep `applyAgentResult`/`applyWordOverrides` for the **active** track.
4. **App JSX**: `<ResultsScreen key={\`${resultsSessionId}:${activeTrackId}\`} … />`. A tab switch is therefore: `setActiveTrackId` → remount → initial props from the store. Nothing to checkpoint, because raw state was published continuously.
5. **Timing link**: an App effect on `[sourceTrack.segments, sourceTrack.groups]` maps every translated track through `propagateSourceTiming` and writes back only the tracks whose reference changed. If the active track is translated and changed, it remounts (bump a per-track `revision` used in the key) — acceptable, it can only happen from an agent edit to the source.
6. **Agent routing**: `handleApplyAgentResult` applies to the **source** track: when the source is active, through `projectIORef` as today; otherwise `syncSegmentsIntoTrack(sourceTrack, ensureWordIds(r.segments), …)` on the store. `set_settings`/`apply_preset` payloads gain optional `track_id` (default active) — `AgentLiveSync` passes it through; App applies via `applySettingsCommand` to that track, through the undo path only when it is the active one. `appliedPreset` moves onto the track.
7. **Three new commands** in `AgentLiveSync.handleCommand` → App callbacks: `create_track {command_id, track_id, lang, label?, copy_style_from?}` (`createTrackFromSource`, appends, **switches the tab**), `set_track_text {command_id, track_id, entries: [{group_id, text}]}` (`bakeTranslation` per entry; unknown ids collected into the error), `reflow_track {command_id, track_id}`. Each ends by setting `agentCommandEcho = {id, status, error?}`; a thrown error becomes `status: 'error'` with the message — never a swallowed catch (the existing `catch { /* ignore malformed */ }` at `AgentLiveSync.tsx:176-178` must not eat these; echo first, then rethrow nothing). Toast on success like the other ops (`toastMessageForCommand`).
8. **Mirror**: split the effect at `App.tsx:161-187` in two: (a) the existing seven keys + `activeTrackId` + `agent` (deps as today plus the echo), (b) `tracks: tracks.map(trackToMirrorEntry)` keyed on `[tracks, classifications]`. Both write the same `PUT /api/ui-state` body — build it from a ref holding the latest of each half so neither overwrites the other. Extend the resync snapshot (`:189-225`) the same way.
9. **Project I/O**: `restoreFromProjectFile` → `migrateProjectFile` → `tracksFromProjectFile` → set store + `resultsSessionId++`; a version error surfaces through the existing `setRestoreWarning`. `handleSave`/`useAutosave` use `projectFileFromTracks`; autosave deps add `tracks`.
10. **Export/render suffix on the UI path**: `useRender.ts:115,166` and the mirror pass `activeTrack.isSource ? '' : \`.${activeTrack.lang}\`` as `nameSuffix`. `ExportPanel`'s `buildExportParams` (`:149-151`) adds `track: { id, lang, segments: displayGroupsFor(track) }` for a translated track (Phase 4 defines the backend side; until then the extra key is ignored by Pydantic's default `extra='ignore'`).

### Documentation references

- Remount-by-key precedent and comment to mirror: `App.tsx:55-60`.
- The reconcile effect being extracted: `ResultsScreen.tsx:147-186` — keep its comments (they explain the identity bug this replaced).
- Command handling shape: `AgentLiveSync.tsx:137-179`; toast copy: `lib/agentCommands.ts:140-166`.
- Undo hook to key: `hooks/useSettingsUndo.ts:20-70`.

### Verification checklist

- [ ] `npm test` — every pre-existing suite passes **unmodified** (no assertion in an existing test may be edited in this phase).
- [ ] New tests: `useSettingsUndo` keying (pure `undoStack` level: two keys, push on A, undo on B is a no-op), `trackToMirrorEntry` shape equals §E, `projectFileFromTracks(tracksFromProjectFile(f)) ≡ f` for a v1 file.
- [ ] `grep -n "onGroupsUpdate" src/renderer/src` → 0 hits; `grep -n "pendingRestore\|restore:" src/renderer/src/App.tsx src/renderer/src/components/screens/ResultsScreen.tsx` → 0 hits.
- [ ] `npm run typecheck && npm run lint` clean.
- [ ] **Manual smoke (single-track, must match `main`)**: open a video → transcribe → edit a word → merge two groups → drag a group end → save → reopen (`.capforge` now says `version: 2`, no `tracks`) → render frame via MCP `render_frame` → `apply_preset` over MCP confirms → Cmd+Z undoes a settings change.
- [ ] Open a **v1** project saved by the current release: identical result to opening it on `main`.

### Anti-pattern guards

- ResultsScreen must keep initializing state **only** in `useState` initializers; a prop change must never reset segments/groups (the remount key is the only reset).
- Do not publish `displayGroups` upward any more — App derives them. Publishing gap-closed groups back as raw state is the non-idempotent tail-hold bug (`ResultsScreen.tsx:202-215` comment).
- Do not apply an agent transcript edit to whichever ResultsScreen happens to be mounted.
- Do not add `track_id` handling to the backend in this phase (Phase 4) — the renderer must work against today's backend.

### As shipped (2026-09-09)

- The store lives in **`hooks/useTrackStore.ts`** (`tracks`/`activeTrackId`/`revisions` + the derived `activeTrack`, `sourceTrack`, `classifications`, `displayGroups`), so `App.tsx` stays under the size ceiling. Its pure helpers — `emptySourceTrack`, `sourceTrackFromResult`, `projectMetaFor` — are what the App-composition test exercises.
- The mirror body is composed by **`lib/uiStateMirror.ts`** (`buildUiStateCore` / `buildTrackEntries` / `mergeUiStateBody`, plus `nameSuffixFor` and `renderEditedFlag`), which is what makes §E testable. The two effects share **one** 300 ms trailing timer, so a change that moves both halves still costs a single PUT.
- The three track commands are decoded by **`lib/trackCommands.ts`** (`applyTrackCommand`, `isTrackCommand`, `commandIdOf`) — pure, throws a human-readable message, and `set_track_text` validates every `group_id` up front so a batch with one bad id changes nothing. `AgentLiveSync` echoes `{id, status, error}` for **every** exit, including "no project is open", so the agent's poll can never hang on a refused command.
- Per-key undo is a pure primitive, `createKeyedUndoStacks` in `lib/undoStack.ts` (one debouncer and one `MAX_HISTORY` cap per key); `useSettingsUndo(settings, setSettings, key)` is now a thin wrapper. The hook body is not testable in the node env, so the keying contract is pinned at the `undoStack` level, as the phase allowed.
- **`initialSegmentsEdited` is a fifth ResultsScreen prop** beyond the four the phase listed. Without it a tab switch back to a track whose segments an agent edited off-tab would reset the flag to `false`, dropping `custom_groups` from that track's render and letting the backend re-chunk. It is seeded exactly like `initialGroupsEdited`.
- **`onAlignmentDegraded`** is a sixth prop, for the same class of reason: `gather()` used to read ResultsScreen's local `alignmentDegraded`, and with the composition moved to App the flag has to reach `result` (project metadata) or a save would forget that the timings are approximate.
- `ResultsScreen`'s key is `${resultsSessionId}:${activeTrackId}:${revisions[activeTrackId] ?? 0}` — the per-track revision the phase's item 5 asked for, held in the store rather than on `CaptionTrack` so the Phase 1 model is untouched. It is bumped by the timing-link effect for any track that moved, and by `set_track_text` / `reflow_track` (which write underneath a possibly-mounted editor).
- The timing link runs in App (not the store) because it needs the list of tracks that moved in order to bump their revisions; `propagateSourceTiming`'s reference stability is what keeps it from re-triggering itself.
- `AgentLiveSync` lost its `settings` prop: `settingsForTrack()` with no argument returns the active track's settings, so keeping both would have been dead code.
- **`hooks/useTimelineEditing.ts`** is a behaviour-preserving extraction of ResultsScreen's edge-drag + right-click-popup cluster (moved verbatim, comments included). `ResultsScreen.tsx` was already 993 lines on `main`; the phase's changes would have pushed it to ~1013, and this brings it to 790.
- The probe that reads the source video's resolution/fps writes to **every** track: output geometry is a fact about the media, not a per-track style choice.
- A new transcription (`handleTranscribeDone`) replaces the whole store, dropping translated tracks — they were written against the previous video's words. The style carries over, as it always did.

---

## Phase 3 — Track UI: tabs, language picker, markers, reflow banner, font hint (agent: implementer)

### What to implement

1. **`components/tracks/TrackTabs.tsx`** — `role="tablist"`/`role="tab"` with the roving-tabIndex + arrow-key pattern from `ResultsScreen.tsx:809-830` / `SegmentedControl.tsx:57-80`. Props: `tracks: ReadonlyArray<{ id, label, lang, isSource, staleCount, untranslatedCount, reflowNeeded }>`, `activeTrackId`, `onSelect`, `onAdd`, `onClose(id)`. Source tab first, no close button; translated tabs show a count badge (`stale` in `--color-brand`, `untranslated` muted) and a small dot when `reflowNeeded`; a trailing `+` tab. All colours via CSS variables (`--color-text`, `--color-surface`, `--color-border`, `--color-brand`); font `--cf-font-ui`.
2. **`components/tracks/LanguagePicker.tsx`** — a popover anchored to `+`: a filter input over `LANGUAGES` (label + native label + code), Enter/click picks. One click creates the track (D1): `lang` stamped, `label = languageLabel(lang)`, style copied from the **active** track (so "style the English, then add Polish" inherits what you see). Languages already present are listed but marked "added" and disabled (UI-only uniqueness, D1). Copy the popover/portal mechanics from `components/ui/ColorSwatch.tsx` (`createPortal`, portaled out of the studio card in commit `7ad96aa`) and the anchor-rect positioning from `GroupPositionPopup`.
3. **App wiring** — mount `TrackTabs` above the `ResultsScreen` container (§G-1). `onClose` asks `window.confirm` naming the track and its untranslated/stale counts, then removes it and activates the source. `onAdd` → picker → `createTrackFromSource`; on a non-Latin script whose copied `fontFamily` is a bundled font (`loadAllFonts()` → `FontInfo.source === 'bundled'`), `toast(…, 'info')` per §G-2. `createTrackFromSource` throwing (missing wids) → `toast(err.message, 'error')`, no track.
4. **`GroupEditor.tsx`** — optional prop `groupStates?: ReadonlyMap<string, TrackGroupState>`; render a chip beside the `↺` slot (`:543-548`) for `stale` ("source changed") and `untranslated` ("no text"); nothing for `clean`. `ResultsScreen` threads `groupStates` from a new prop.
5. **Reflow banner** — in `ResultsScreen`, above the editor area, only when `!autoGroup && reflowNeeded`: one line + a "Re-flow from source" button → App runs `reflowTrack` (pushes editor undo first) and remounts. Also in the banner: "Ask the agent to re-translate N stale groups" as plain text — no in-app translation (non-goal).
6. **StudioPanel** — new prop `activeTrackIsSource`; `LayoutCard` hides the *Words per group* row on translated tracks (grouping is inherited). Everything else in the sidebar is per-track already because it is prop-fed.
7. **Timeline pins** — in ResultsScreen's `onWordEdge`/`onSegmentEdge` commit paths on a translated track: word drag deletes `timingDerived`; group drag sets `timingLinked: false` (and `endEdited` as today).
8. **TitleBar** — the undo/redo buttons keep working per track (they read `subtitleUndo` from the mounted ResultsScreen; on remount they reset — accepted, §G).

### Documentation references

- Tabs markup + keyboard pattern: `ResultsScreen.tsx:809-830`, `SegmentedControl.tsx:57-80`.
- Portal precedent: `components/ui/ColorSwatch.tsx` (`createPortal`); anchorRect popover: `components/editor/GroupPositionPopup.tsx`.
- Component test pattern (static markup only): `components/ui/Button.test.tsx:4-20`.
- Theme rules: CLAUDE.md → Theming (`--color-*` only; inline `style` when Tailwind misparses).

### Verification checklist

- [ ] `TrackTabs.test.tsx` (static markup): renders source first, `aria-selected` on the active tab, badge text `"3"` for `staleCount: 3`, no close control on the source tab, a `+` tab last.
- [ ] `LanguagePicker.test.tsx`: filter `"pol"` lists Polish; an already-added code renders disabled.
- [ ] `GroupEditor` markup test: a `stale` state renders the chip text; `clean` renders none.
- [ ] `npm run typecheck && npm test && npm run lint`.
- [ ] `grep -rn "text-white\|bg-black\|#[0-9a-fA-F]\{6\}" src/renderer/src/components/tracks` → 0 hits.
- [ ] **Manual**: add Polish → tab appears, style inherited, groups blank (preview shows nothing on the Polish tab), timeline shows the inherited group bars; type a translation into one group in the text view → words appear with proportional timing; drag one word → re-typing the group keeps that word's timing; switch to Original, drag a group end, switch back → the Polish end moved; change `wordsPerGroup` on Original → Polish tab shows the reflow dot and banner, Polish text untouched; click Re-flow → carried groups keep text, blanks show; close the Polish tab → confirm dialog → gone, Original active.

### As shipped (2026-09-09)

- Track actions live in `hooks/useTrackActions.ts` and go through `lib/trackCommands.ts` (`applyTrackCommand`), so the UI and the agent share one create/reflow implementation; App sits above `ToastProvider`, so the hook returns a `notice` that App hands to a second `<ToastRelay>`.
- `LanguagePickerPanel` is exported separately from the stateful portal wrapper `LanguagePicker` (a `createPortal` cannot run under `renderToStaticMarkup`); the picker takes an `anchorRef` so the outside-click closer does not fire on the `+` mousedown.
- Two more verbatim extractions to stay under 800 lines: `components/editor/GroupRowChrome.tsx` (`EndTimeButton` + the new `TrackStateChip`) and `components/screens/EditorViewTab.tsx` (`TabButton`).
- `ReflowBanner` renders under the Text/Groups tab bar, visible in both views (not only above the group list). Its `pushUndo()` is symbolic: the reflow bumps the track revision and remounts the editor with a fresh undo stack.
- `useTimelineEditing` takes `translated` (= `!autoGroup`): word drag deletes `timingDerived`, group drag sets `timingLinked: false`. No automated coverage — the node vitest env cannot mount a hook.
- Active-tab underline uses `--color-accent` (matching the editor's view tabs); stale badge and reflow dot use `--color-brand`.

### Anti-pattern guards

- No `wordsPerGroup` rebuild on a translated track (the row is hidden *and* `autoGroup=false` guards it).
- The tab strip lives in `App.tsx`, never inside `ResultsScreen`.
- No in-app translation, no font mapping table, no bilingual/stacked rendering.

---

## Phase 4 — Backend: mirror consumers, layout scan, filename suffixes, command ops (agent: implementer)

Everything here reads the mirror (§E) or validates a request. Nothing owns track state.

### What to implement

1. **`main.py` mirror selection** — `_agent_frame_inputs(track_id: Optional[str] = None)`: `None` → today's path; otherwise find `current_ui_state["tracks"][…]["render"]` by id, 404 `{"detail": "Unknown track", "tracks": [inventory]}` when absent; the existing 409 hint on validation failure stays. `/api/render-frame` and `/api/agent/check-layout` read `req.get("track_id")`. `/api/export-hyperframes` with `use_ui_config` honours `track_id` the same way (copy how it reads the mirror at `main.py:965+`).
   **`groups_for_render` (`video_render.py:428-472`) must test `custom_groups is not None`, not truthiness**: a translated track whose groups are all still placeholders mirrors `custom_groups: []` (Phase 1 as shipped), and the truthy test would silently draw the *source* transcript for it. Pin with a test: `custom_groups=[]` → no groups; `custom_groups=None` → built from the transcript.
2. **`AGENT_COMMAND_OPS`** += `create_track`, `set_track_text`, `reflow_track`. Validate like `load_video` (`main.py:706-717`): `command_id` non-empty string; `create_track` requires `lang` (`^[a-z]{2,3}(-[A-Za-z]{2,4})?$`) and `track_id`; `set_track_text` requires a non-empty `entries` list of `{group_id: str, text: str}`; all three 409 when `not ws_clients`.
3. **Filename suffixes** — `VideoRenderRequest.output_name_suffix: str = Field("", pattern=r"^(\.[A-Za-z0-9_-]{1,32})?$")` and the same on `HyperframesRenderRequest` (`schemas.py:250-266`). `render_subtitle_video(..., name_suffix: str = "")` → `stem = Path(result.audio_path).stem + name_suffix` (`video_render.py:1724`); `/api/render-video` passes it (`main.py:905-913`); the HyperFrames route applies it to its `stem` (`main.py:1029`). `CustomGroup.id: Optional[str] = None` (`schemas.py:238-247`).
4. **Export for a track** — `ExportRequest.track: Optional[ExportTrack] = None` where `ExportTrack {id: str, lang: str, segments: list[Segment]}`; `export_result` builds `TranscriptionResult(segments=track.segments, language=track.lang, audio_path=current_result.audio_path, duration=current_result.duration)` and calls `_do_export(..., name_suffix=f".{track.lang}")` — add `name_suffix` to `_do_export` (`main.py:1636-1668`, `f"{stem}{name_suffix}{ext}"`). Validate `lang` with the same pattern as above (it becomes part of a filename).
5. **Layout scan** — extract from `_render_frame` (behaviour-neutral, same names, same maths):
   - `measure_group_words(config, font, words) -> list[dict]` = `video_render.py:1058-1074`;
   - `wrap_rows(all_metrics, *, effective_space_w, max_w_px, num_lines, is_rsvp) -> list[list[dict]]` = `:1096-1135`;
   and call them from `_render_frame`. New module `backend/exporters/layout_scan.py`: `scan_layout(config, groups, max_lines) -> dict` — per group: `font = _get_font(config.font_family, config.font_size, config.custom_font_path, bold=config.bold)`, metrics, rows, `row_widths` as `:1137-1140`; a violation is `len(rows) > max_lines` or `max_row_w > max_w_px` (a single word wider than the box). Returns `{"scanned": n, "mode": config.reading_mode, "max_lines": max_lines, "max_width_px": max_w_px, "violations": [{"group_id", "index", "start", "end", "text", "lines", "max_row_px", "overflow_px"}]}`; in `rsvp` mode returns `violations: []` with `"note": "RSVP is a single sliding line; wrap overflow does not apply"`. `/api/agent/check-layout` dispatches on `req.get("scan")` (with `max_lines = int(req.get("max_lines", 2))`) and applies `groups_for_render(current_result, config, custom_groups)` first so the scanned groups are the rendered ones.

### Documentation references

- Route + gate + broadcast shape: `main.py:688-722`.
- Test harness: `backend/tests/test_agent_result.py:25-84`; seed `current_ui_state` with a §E-shaped dict in a fixture.
- The extraction targets, verbatim: `video_render.py:1049-1140`.
- Output sandbox: `hyperframes_project.py:322-334` (unchanged, still applied).

### Verification checklist

- [ ] `.venv-dev/bin/python -m pytest backend/tests -q` — full suite green, **goldens untouched** (`test_render_golden.py`), and `CAPFORGE_PARITY=1 … test_caption_parity.py -q` green: the extraction changed nothing.
- [ ] New `backend/tests/test_tracks_api.py`: `render-frame` with a known `track_id` uses that track's config (assert via a distinctive `font_size`); unknown id → 404 with inventory; `check-layout` `scan=True` on a 3-group fixture where one group's text is long → exactly one violation with `lines == 3`; scan in `rsvp` mode → `[]`; `render-video` with `output_name_suffix=".pl"` produces `<stem>.pl…` (monkeypatch the encoder); `output_name_suffix="../x"` → 422; `export` with `track` writes `<stem>.pl.srt`; `create_track` command with a bad `lang` → 400, with no UI → 409.
- [ ] `grep -n "output_name_suffix" backend/models/schemas.py` → on the two *request* models only; `test_caption_cfg_contract.py` untouched and green.
- [ ] `grep -c "def measure_group_words\|def wrap_rows" backend/exporters/video_render.py` → 2, and `_render_frame` calls both.

### As shipped (2026-09-09)

- `HyperframesRenderRequest.track_id: Optional[str]` added (the HF route takes a Pydantic body, so the field is the only way to express `track_id` under `use_ui_config`).
- The unknown-track 404 body is `{"detail": {"title", "hint", "tracks": [{id,label,lang}…]}}` — `HTTPException` can only populate `detail`, and the sibling 409 uses the same nested shape. **Phase 5's `_resolve_track` reads `detail["tracks"]`.**
- `max_lines` is validated (non-integer or `< 1` → 400) rather than a bare `int(...)`; `DEFAULT_MAX_LINES = 2` lives in `layout_scan.py`. `_get_font` is resolved once per scan, not per group.
- `video_render.py` grew by 41 lines (two signatures + docstrings + the `name_suffix` parameter); the moved bodies are byte-identical to `main` modulo indentation. Net-neutral was unreachable with both functions required to live in that file.
- `LANG_CODE_PATTERN` and `OUTPUT_NAME_SUFFIX_PATTERN` are named constants in `schemas.py`; `ExportTrack` has its own docstring. The Phase 6 schema grep gate below was widened accordingly.
- `CustomGroup.id` does not reach any HyperFrames artifact (both HF projections re-key group dicts), so `SCAFFOLD_VERSION` was not bumped.

### Anti-pattern guards

- No new field on `VideoRenderConfig`.
- No track state on the backend beyond `current_ui_state`; no Python `classify`/`bake`/`reflow`.
- No full-frame render inside the scan (that is what makes 1 150 groups take seconds, not minutes).
- Never format a client-supplied string into a path without the `Field(pattern=…)` gate.

---

## Phase 5 — MCP tools (agent: implementer)

### What to implement (`mcp_server/server.py`, `mcp_server/client.py`)

1. **Shared helpers** — rename `_APPLY_PRESET_POLL/_TIMEOUT` to `_CONFIRM_POLL/_CONFIRM_TIMEOUT` (same values); `_resolve_track(state, track_id) -> dict` (active when `None`; raises a tool-level error dict listing the inventory otherwise); `_send_and_confirm(op, payload) -> dict` — mints `command_id = f"c-{uuid4().hex[:12]}"`, `send_command`, polls `get_ui_state()["agent"]` until `lastCommandId == command_id`, returns `{"status": "ok"}` / `{"status": "error", "error": …}` / `{"status": "unconfirmed", "hint": …}` with the same hint ladder as `apply_preset` (`server.py:320-338`).
2. **New tools**
   - `create_track(lang: str, label: Optional[str] = None, copy_style_from: Optional[str] = None) -> dict` — mints `track_id`, sends `create_track`, confirms, then returns `{"status", "track_id", "label", "groups": [{id, start, end, text: source text}]}` from `tracks[].groups` **of the source** paired 1:1 by index with the new track's ids. Docstring states the side effect (switches the tab) and the refusal (source without complete word ids).
   - `set_track_text(track_id: str, entries: list[TrackTextEntry]) -> dict` where `TrackTextEntry(group_id: str, text: str)` (Pydantic, like `WordEdit` at `:33-44`). Confirms, then returns the track's `{staleCount, untranslatedCount, reflowNeeded, written}`. Docstring: wholesale per-group replacement; timings derived proportionally; **not** `update_words`; blank text = blank caption.
   - `get_track(track_id: Optional[str] = None, stale_only: bool = False, start: Optional[float] = None, end: Optional[float] = None) -> dict` — reads `tracks[i].groups`; `stale_only` keeps `state in ("stale", "untranslated")`; `start`/`end` window by group time (the brainstorm's `range`). Returns `{"track": inventory entry, "groups": [...]}`.
   - `reflow_track(track_id: str) -> dict` — confirms, returns counts plus the blank groups with `previousText`.
3. **Extended tools** — optional `track_id: Optional[str] = None` on `set_style`, `apply_preset` (payload passthrough; `apply_preset` confirms against `tracks[i].appliedPreset`), `render_frame`, `check_layout` (+ `scan: bool = False`, `max_lines: int = 2`), `render` (submits `tracks[i].render` verbatim — the suffix is already inside), `render_hyperframes`, `export` (builds `track: {id, lang, segments}` from `tracks[i].render.custom_groups` for a translated track; source → today's body). `get_ui_state` returns `tracks` **stripped of `groups` and `render`** plus `activeTrackId`; docstring updated.
4. **Client** — `send_command` unchanged; `check_layout(t, platform, track_id=None, scan=False, max_lines=2)`; `get_frame(t, composite, track_id=None)`; `export(payload)` unchanged.
5. **The loop belongs in the docstrings** (brainstorm): `create_track`'s docstring ends with the five-step recipe — *translate → `set_track_text` → `check_layout(track_id, scan=True)` → shorten overflowing groups → re-write → re-scan*; `check_layout`'s docstring says Polish/German run 10–15 % longer than English and three-line captions are the expected failure; `get_track`'s docstring explains `stale` vs `reflowNeeded` and that `reflow_track` is the repair for the latter.

### Documentation references

- Confirm-by-poll to copy: `server.py:292-338`. Command relay: `client.py:97-98`.
- Verbatim-body principle for `render`: `server.py:437-452` (keep the comment).
- Pydantic tool arg models: `server.py:33-56`.
- Docstring voice: `update_words` (`:127-142`) and `render` (`:418-434`).

### Verification checklist

- [ ] `.venv-dev/bin/python -m pytest mcp_server/tests -q` (explicit path — `pyproject.toml:4` skips it otherwise). New `test_tracks_tools.py` uses a stub client (a class with the same method names returning canned §E dicts, monkeypatched onto `server._client`): `create_track` returns the paired skeleton; `_send_and_confirm` returns `error` when the echo says so and `unconfirmed` after the timeout (patch `time.sleep`); `get_track(stale_only=True)` filters; `get_ui_state` output has no `render`/`groups` under `tracks`; `export` for a translated track sends `track` with `lang`.
- [ ] `grep -n "delete_track" mcp_server/server.py` → 0 (D7).
- [ ] Tool count: 31 → 35 (`create_track`, `set_track_text`, `get_track`, `reflow_track`); no other new tool.

### As shipped (2026-09-09)

- The four track tools and the confirm-by-poll machinery live in **`mcp_server/tracks.py`**, registered on the shared `mcp` instance by `tracks.register(mcp, lambda: _client)`; `server.py` was already 821 lines on `main` and is 921 after the eight extended docstrings — moving the co-author/workspace cluster out is a separate cleanup.
- `main` had 34 tools, not 31; the roster is now **38** (`mcp.list_tools()`), and `grep -c "@mcp.tool()" server.py` reads 34 because the new four are decorated in `tracks.py`.
- `resolve_track` returns an error dict (dicts cannot be raised) built from the mirror's `tracks` inventory; `render_frame`/`check_layout` pass `track_id` straight to the backend, whose 404 carries the same inventory.
- `export` refuses a translated track with no captions yet (`custom_groups: []`) with an error + hint rather than writing an empty file.
- Small additive keys: `set_style`/`apply_preset` echo `track_id`; `create_track` adds `next`; `reflow_track` blanks include `sourceText` beside `previousText`.
- Tests fake both `time.sleep` and `time.monotonic` so the unconfirmed path never spins against the real 5 s deadline.
- `mcp_server/README.md`'s tool table is updated in Phase 6.

### Anti-pattern guards

- No tool mutates backend state directly; every write is command + confirm.
- `set_track_text` never calls `apply_word_edits`.
- Do not rebuild the render body in Python (the casing bridge lives in `render.ts`).
- Do not return words inside `get_track` or `create_track` (token budget — brainstorm table).

---

## Phase 6 — Final verification, docs, manual QA (agent: implementer; scout for any fact gap)

1. `npm run typecheck && npm test && npm run lint`; `.venv-dev/bin/python -m pytest backend/tests -q`; `.venv-dev/bin/python -m pytest mcp_server/tests -q`; `CAPFORGE_PARITY=1 .venv-dev/bin/python -m pytest backend/tests/test_caption_parity.py -q`.
2. **Render-boundary gates** (the constraint at the top, mechanically):
   - `git diff main -- src/renderer/src/hooks/useSubtitleOverlay.ts src/renderer/src/lib/overlayGeometry.ts src/renderer/src/lib/rsvp*.ts backend/exporters/hyperframes_caption_html.py backend/exporters/hyperframes_rsvp_runtime.py backend/exporters/rsvp*.py backend/tests/golden docs/caption-parity.md` → **empty**.
   - `git diff main -- backend/exporters/video_render.py` → only the two extractions (no line inside `measure_group_words`/`wrap_rows` differs from the original block except indentation and the parameter list).
   - `git diff main -- backend/models/schemas.py` adds nothing inside `class VideoRenderConfig` — verify with `git diff main -U0 -- backend/models/schemas.py | grep '^@@'` (every hunk must sit outside the `VideoRenderConfig` line range) and `test_caption_cfg_contract.py` unmodified + green. Additions elsewhere (`LANG_CODE_PATTERN`, `OUTPUT_NAME_SUFFIX_PATTERN`, `ExportTrack`, `CustomGroup.id`, the two request-model fields, `HyperframesRenderRequest.track_id`) are the expected set.
   - `grep -rn "track" src/renderer/src/hooks/useSubtitleOverlay.ts src/renderer/src/hooks/useTimeline.ts` → 0 hits.
3. **Rule-locality gates**: `grep -rln "function classifyTrack\|function bakeTranslation\|function reflowTrack\|function propagateSourceTiming" src backend mcp_server` → exactly one file each, all under `src/renderer/src/lib/`; `grep -rn "def classify\|def bake\|def reflow" backend mcp_server` → 0.
4. **Docs**:
   - `CLAUDE.md` → Key Conventions: a "Caption tracks" entry (ownership split, the mirror contract pointer, the four new optional fields and which are group-only, `autoGroup`, the "agent edits target the source" rule, project v2 additivity) and a line under Communication for the three new command ops; the Renderer Structure list gains `components/tracks/` and `lib/tracks.ts`/`languages.ts`; the MCP paragraph gains the four tools and the `check_layout` scan.
   - New `docs/caption-tracks.md`: the §B–§F of this plan as reference (data model, timing/staleness rules with the worked-example table, the mirror contract, the agent loop), written as documentation rather than plan.
   - Brainstorm doc status line → "PLANNED → see multi-language-caption-tracks-plan.md"; this doc's status → SHIPPED with any "**As shipped**" divergences recorded inline, RSVP-plan style.
   - `CHANGELOG.md` entry under the next version.
5. **Manual QA (user)** — the parts CI cannot cover:
   - End-to-end over MCP on a real 3–5 minute clip: `create_track("pl")` → translate → `set_track_text` → `check_layout(track_id, scan=True)` → fix → `render(track_id)` → file is `<name>.pl.mp4`; `export(["srt_standard"], track_id)` → `<name>.pl.srt`.
   - RSVP visual check on the Polish track (brainstorm risk): proportional timing reads acceptably; note anything that looks wrong rather than "fixing" a renderer.
   - Agent `update_words` on the English while the Polish tab is active: the English edit lands, the Polish tab shows 1 stale, no tab switch, no lost Polish text.
   - Kill the backend mid-session → resync restores both mirror halves (agent `get_ui_state` shows both tracks after reconnect).
   - Open the saved v2 project in the **previous release build**: opens the source track, ignores `tracks`.
   - Windows: a suffix like `.pl` survives the NSIS path handling in the output folder.

### As shipped (2026-09-09)

**What CI proved.** Every gate in items 1–3 was run on `feat/caption-tracks` and is green:

| Gate | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm test` | 1322 passed, 51 files |
| `npm run lint` | 0 errors (33 pre-existing `react-hooks` warnings, unchanged in kind from `main`) |
| `pytest backend/tests -q` | 1099 passed, 35 skipped |
| `pytest mcp_server/tests -q` | 67 passed |
| `CAPFORGE_PARITY=1 pytest backend/tests/test_caption_parity.py -q` | 35 passed |
| `git diff main` over the three renderers, `rsvp*`, `backend/tests/golden`, `docs/caption-parity.md` | **empty** — the top-of-document constraint held |
| `git diff main -- backend/exporters/video_render.py` | only `measure_group_words` + `wrap_rows` (bodies byte-identical modulo indentation), the `groups_for_render` `is not None` guard + docstring, and `name_suffix` |
| `git diff main -U0 -- backend/models/schemas.py \| grep '^@@'` | hunks at `+132`, `+158`, `+272`, `+282`, `+294`; `class VideoRenderConfig` spans 163–261, so **every hunk is outside it**. `test_caption_cfg_contract.py` unmodified and green |
| `grep -rln "function classifyTrack\|bakeTranslation\|reflowTrack\|propagateSourceTiming"` | exactly one file each, all under `src/renderer/src/lib/` |
| `grep -rn "delete_track" mcp_server/` | 0 (D7) |

Two gates as literally written are over-broad and were re-derived by hand rather than
loosened:

- `grep -rn "track" useSubtitleOverlay.ts useTimeline.ts` → **0** was never achievable:
  both files pre-date this feature and contain `tracking`, `trackBg`, "tracks the theme".
  The real assertion is stronger and holds — `git diff main` on **both** files is empty,
  so no hit is new.
- `grep -rn "def classify\|def bake\|def reflow" backend mcp_server` → **0** matches
  `mcp_server/tracks.py`'s `def reflow_track`. That is the MCP *tool* (send command →
  confirm by poll → read the mirror), not a Python implementation of the reflow rule; the
  rule still lives only in `lib/tracks.ts`. The tool name is the agent-facing surface this
  plan specified, so it stays.

**One robustness fix beyond the phase list.** `mcp_server/tracks.py` `create_track` pairs
the new track's group ids with the source groups by index. It was already index-guarded
(no `IndexError`), but padded any excess with empty source text — which reads to an agent
as "nothing to translate here". It now pairs over the shorter list and returns a
`warning` naming both counts and pointing at `get_track`. Three tests in
`mcp_server/tests/test_tracks_tools.py` (`MismatchedClient`) cover more groups, fewer
groups, and the silent equal-counts case.

**Docs written in this phase:** `docs/caption-tracks.md` (new reference doc — data model,
timing, staleness with the worked-example table, the mirror contract, project v2, the
agent loop, the UI, and a "what is deliberately not there" list); a "Caption tracks"
entry in `CLAUDE.md` → Key Conventions plus the Communication/Renderer-Structure/MCP
lines; `mcp_server/README.md`'s tool table (now 38 rows, cross-checked against
`mcp.list_tools()`); `docs/plans/changelog-caption-tracks.md` holds the release-notes
entry for the user to paste (`CHANGELOG.md` itself was left alone — it carries the user's
own uncommitted edits).

#### Still outstanding — manual QA only (none of the below has been run)

- [ ] End-to-end over MCP on a real 3–5 minute clip: `create_track("pl")` → translate → `set_track_text` → `check_layout(track_id, scan=True)` → fix → `render(track_id)` → file is `<name>.pl.mp4`; `export(["srt_standard"], track_id)` → `<name>.pl.srt`.
- [ ] RSVP visual check on the Polish track (brainstorm risk): proportional timing reads acceptably; note anything that looks wrong rather than "fixing" a renderer.
- [ ] Agent `update_words` on the English while the Polish tab is active: the English edit lands, the Polish tab shows 1 stale, no tab switch, no lost Polish text.
- [ ] Kill the backend mid-session → resync restores both mirror halves (agent `get_ui_state` shows both tracks after reconnect).
- [ ] Open the saved v2 project in the **previous release build**: opens the source track, ignores `tracks`.
- [ ] Windows: a suffix like `.pl` survives the NSIS path handling in the output folder.

Also unrun by CI, because the node vitest environment renders components to static markup
and cannot mount a hook: the Phase 2 and Phase 3 manual smoke lists (single-track parity
with `main`, opening a v1 project, the tab/picker/banner interactions, and the timeline
pin behaviour in `useTimelineEditing`).

---

## Effort

| Phase | Scope | Sessions |
|---|---|---|
| 1 | pure core + project v2 (+ groups Rule 4 exception, render body) | 1–2 |
| 2 | ownership refactor, invisible | 2 |
| 3 | track UI | 1–2 |
| 4 | backend | 1 |
| 5 | MCP | 1 |
| 6 | verification + docs + QA | 1 |

Phases 4 and 5 can be built by one implementer session each without the UI, since both are
pinned by unit tests against §E-shaped fixtures; live QA needs Phases 2–3.

---

## Open decisions (defaults chosen — implementer proceeds unless the user objects)

1. **`reflow_track` exists** (Correction 6). Removing it means "reflowed" is visible but unrepairable over MCP; the UI button would still exist.
2. **Untranslated groups keep their timing bars visible on the timeline** (a blank bar) rather than being hidden, so the user sees what still needs text. Cosmetic.
3. **Closing the last translated tab does not delete anything on the source.** Obvious, stated so nobody adds "clean up sourceWords".
4. **`copy_style_from` accepts a track id only**, not a preset name — presets already have `apply_preset(name, track_id)`.
5. **Label uniqueness is not enforced anywhere** (D1); `create_track("pl")` twice makes two Polish tabs with the same label and the same `.pl` suffix, the second render overwriting the first. The "Duplicate tab" follow-on adds the label slug to the suffix; v1 does not.
