# Multi-language caption tracks

> Reference for the caption-track feature (language tabs). Read this before changing
> anything under `lib/tracks.ts`, `lib/trackStaleness.ts`, `lib/trackTiming.ts`,
> `hooks/useTrackStore.ts` or `mcp_server/tracks.py`. The *why* lives in
> [plans/multi-language-caption-tracks.md](plans/multi-language-caption-tracks.md); the
> *what, where, in which order* in
> [plans/multi-language-caption-tracks-plan.md](plans/multi-language-caption-tracks-plan.md).

A **track** is a named bundle of exactly the three inputs `buildRenderBody()`
(`src/renderer/src/lib/render.ts`) already takes: settings, groups, and the
`groupsEdited` flag. That is the whole feature's load-bearing idea, and the reason
**none of the three caption renderers changed**: no `useSubtitleOverlay.ts`, no
`video_render.py` drawing code, no `hyperframes_caption_html.py`, no goldens, no
[caption-parity.md](caption-parity.md), and **no new field on `VideoRenderConfig`**.
A translated track renders through the identical path the source does; it just hands
that path a different bundle.

## Ownership

| Concern | Owner | Mechanism |
|---|---|---|
| Track list, active tab, every track's segments/groups/settings | renderer (`hooks/useTrackStore.ts`) | React state; `ResultsScreen` owns the *active* track's editor state and remounts on a tab switch |
| What an agent reads | the mirror | `PUT /api/ui-state` gains `tracks[]`, `activeTrackId`, `agent` |
| What an agent writes | commands | `POST /api/agent/command` → `broadcast_event` → `AgentLiveSync.handleCommand` |
| Confirmation | polling | each write command carries a tool-minted `command_id`; the renderer echoes `{id, status, error?}` into the mirror; the tool polls, exactly as `apply_preset` does |
| Rendering a non-active track | the mirror | `_agent_frame_inputs(track_id)` selects `tracks[i].render` instead of the top-level `render` |

Three consequences, stated plainly:

- **Track tools need the CapForge window open.** All three command ops answer `409`
  when `not ws_clients`, the `load_video` precedent.
- **The backend never owns a track rule.** There is no canonical track state in Python
  and no Python twin of bake / link / staleness / reflow. Every rule has exactly one
  implementation, in TypeScript, under `src/renderer/src/lib/`. This is unlike gap
  closing (two implementations) and RSVP (three) — do not "helpfully" add one.
- **Agent transcript edits target the source track regardless of the active tab.**
  `update_words` / `remove_filler_words` push `result_updated`; App routes that into
  the stored **source** track (through the mounted `ResultsScreen` when the source is
  active, through `syncSegmentsIntoTrack` on the store otherwise). Landing it in
  whichever editor happens to be mounted would overwrite a translation with English.

## Data model

Four optional fields were added to the existing types in `src/renderer/src/types/app.ts`
— the same pattern as the group-only `positionOverride` / `endEdited`:

| Field | On | Meaning |
|---|---|---|
| `sourceWords?: Array<{wid, text}>` | `Segment` | **group-only, translated tracks only.** The source words this caption's text was written from — `{wid, text}` pairs, not a wid set (see [Staleness](#staleness)). |
| `timingLinked?: boolean` | `Segment` | **group-only, translated tracks only.** Absent (the default) = this group follows its source span. `false` = the user dragged it on the translated tab; leave it alone. |
| `previousText?: string` | `Segment` | **group-only, translated tracks only.** The translation a reflow detached from this span, kept for the agent's context. Cleared the moment text is set; never persisted past that. |
| `timingDerived?: boolean` | `Word` | Timing was derived from the group span rather than measured. Absent = authoritative (a source word, or a translated word the user pinned by dragging it). |

`CaptionTrack` (`lib/tracks.ts`) is the bundle:

```ts
interface CaptionTrack {
  id: string; label: string; lang: string; isSource: boolean
  segments: Segment[]      // source: the transcript; translated: the text-view units
  groups: Segment[]        // RAW groups (pre-gap-closing), exactly what ResultsScreen holds
  groupsEdited: boolean    // translated tracks: always true, so custom_groups is always sent
  segmentsEdited: boolean
  settings: StudioSettings
  appliedPreset: string | null
  sourceSnapshot?: { groupWids: string[][] }   // translated only
}
```

Project-level metadata (`language`, `duration`, `audioPath`, `alignmentDegraded`) stays
on `App.result`, and the source track's `segments` *are* `result.segments`. The source
track's id is the constant `SOURCE_TRACK_ID = 'src'`.

`displayGroupsFor(track)` is the **single** renderer-side `closeGroupGaps` call; App
derives it, `ResultsScreen` keeps the raw groups. Two calls double-hold the last caption
(the tail hold is not idempotent).

### Group lifecycle rules that had to bend

- **`reconcileGroups` Rule 4** drops a group left with no words. A translated group with
  no text *is* a word-less group with its own timing, so Rule 4 gained an exception for
  groups carrying `sourceWords`.
- A second guard: when every group word has vanished **and** any group carries
  `sourceWords`, `reconcileGroups` returns the previous list unchanged rather than
  falling back to a document-order rebuild — otherwise a freshly created
  all-placeholder track would be re-chunked by its own (empty) segments on the first
  sync. Source tracks never carry `sourceWords` and take the old paths verbatim.
- `mergeGroups` concatenates `sourceWords` and keeps `timingLinked` only when both sides
  were linked. `splitGroup` gives both halves the full record with `timingLinked: false`
  — a linked half would be snapped straight back to the full source span. Both drop
  `previousText`.
- `buildRenderBody` **drops word-less groups** from `custom_groups` but still emits the
  key (as `[]`) whenever `groupsEdited` and the caller passed any groups at all. See
  [`custom_groups: []` vs `None`](#custom_groups--vs-none).

## Timing

Captions stay locked to the source audio — the same invariant as
[word-timing locality](../CLAUDE.md). Nothing here measures new timing; it only
subdivides or follows a span that already exists.

**Bake** (`bakeTranslation`, `lib/trackTiming.ts`) is
`retimeWords(group.words, tokenize(text), { start, end })` — the *existing* primitive,
not a second text→timing path. `retimeWords`'s `distribute()` already weights each token
by `max(length, 1)` above a `MIN_WORD_DUR` floor, which is exactly
"proportional by character count across the group span". Every emitted word not
LCS-carried from the previous words is marked `timingDerived: true`; carried words keep
whatever flag they had, so a pinned word stays pinned across a re-translation. Empty
text keeps the group with `words: []` and its `sourceWords` record.

`bakeTranslation` takes an optional 4th argument `{ allRecorded, isFirstGroup }` — the
track-level recorded-wid set — so insertion attribution can tell "a new source word"
from "my neighbour's word". `classifyTrack` and `trackToMirrorEntry` pass it; every
other caller must too.

**Link** (`propagateSourceTiming`, `lib/trackTiming.ts`) runs in App whenever the source
track's segments or groups change. For each translated group with `timingLinked !== false`
and at least one surviving `sourceWords` wid, the linked span is
`[first surviving wid's start, last surviving wid's end]`, **except**:

- when the first wid is the *first* word of its current source group, the span takes
  that group's `start`;
- when the last wid is the *last* word of its source group, the span takes that group's
  `end`, and a source `endEdited` on that boundary sets `endEdited` on the translated
  group too.

That exception is what carries a manual timeline drag and a hand-placed end across to
the translation, and what makes gap closing behave the same on both tabs. When the span
moves: `start`/`end` move, pinned words are clamped into the span, and derived words are
re-distributed proportionally between their pinned neighbours. The function is
**reference-stable** — unchanged input returns the same array — which is what stops the
App effect from re-triggering itself.

**Pin.** On a translated tab, dragging a word's edge deletes its `timingDerived`;
dragging a group sets `timingLinked: false` (and `endEdited`, as on any tab). Both are
wired in `hooks/useTimelineEditing.ts`, which takes a `translated` flag.

## Staleness

Two independent questions, deliberately at different granularities.

**Per group** — "the source text behind this caption changed". Inputs: the track, and a
`SourceIndex` built once per call from the source track's *groups*
(`buildSourceIndex`, `lib/trackStaleness.ts`). In order:

| Test | State |
|---|---|
| `text.trim() === ''` | `untranslated` |
| any recorded wid missing from the index, **or** any recorded `text` ≠ the current word text after `normalizeToken` (NFC), **or** a source word whose *predecessor* in document order is in this group's recorded set is itself not recorded (the `reconcileGroups` Rule 3 attribution rule: an insertion belongs to the group that owns the word before it) | `stale` |
| otherwise | `clean` |

**Per track** — "the source's *chunking* changed since this track was created or
reflowed": `reflowNeeded = !deepEqual(currentSourceGroupWids, track.sourceSnapshot.groupWids)`,
wid lists only. Text changes never set it. It is a track-level boolean on purpose: a
manual merge or split on the *translated* tab is legitimate, and a per-group boundary
comparison against the source would flag it forever.

Identity is all-or-nothing, matching `groups.ts`: if any source word lacks a `wid`,
every group is reported `stale` and `reflowNeeded` is `true` rather than half-matching.

### Why the recorded text matters

A one-for-one typo fix (`"teh" → "the"`) **keeps its `wid`** on purpose
(`lib/wordTiming.ts`), so that `reconcileGroups` does not read it as delete-plus-insert.
Comparing wid *sets* alone would therefore never notice a corrected word, and the
translation of the old text would sit there looking clean. That is why the record is
`{wid, text}` pairs and the comparison includes normalized text.

### Worked examples

| Source edit | Result |
|---|---|
| typo fix (wid carried, text changed) | 1 `stale`, `reflowNeeded=false` |
| `wordsPerGroup` change | 0 `stale`, `reflowNeeded=true` |
| word inserted mid-transcript | 1 `stale` (the predecessor's group), `reflowNeeded=true` |
| `/api/realign` (wids and text preserved) | 0 `stale`, `reflowNeeded=false` |
| agent `set_track_text` on a stale group | that group re-records `sourceWords` from the current source → `clean` |
| manual merge of two translated groups | `sourceWords` concatenated → still `clean` |

These are the test table in `lib/trackStaleness.test.ts`.

### Reflow

`reflowTrack(track, source)` (`lib/tracks.ts`) is the repair for `reflowNeeded`: a new
skeleton from the current source groups. A new group whose wid list **exactly** equals
an old group's recorded list carries that group's `text`, `words`, `timingLinked` and
`endEdited`; every other new group comes back blank with `previousText` set to the old
texts whose recorded wids overlap it, joined by `' / '`. It is a wid-set carry-over, not
a re-slice by index or word count. Group ids become `` `${track.id}:r${n}:${i}` `` where
`n` is derived from the existing `:r<N>:` ids, so a stale id can never collide with a
fresh one. (Group ids are structured and may be parsed; **word** ids are the opaque
ones.) `sourceSnapshot` is re-recorded, clearing `reflowNeeded`.

Reflow is mechanical, never a translation: the agent fills the blanks afterwards with
`set_track_text`, using `previousText` as its starting point.

## The mirror contract

`PUT /api/ui-state` carries a **superset** of the seven keys it always had
(`screen`, `settings`, `groups`, `presets`, `presetsDetail`, `appliedPreset`, `render`)
— those keep describing the **active** track, unchanged, so every existing agent prompt
still works. The body is composed by `lib/uiStateMirror.ts`
(`buildUiStateCore` / `buildTrackEntries` / `mergeUiStateBody`), which is what makes the
shape testable; the two App effects that write it share one 300 ms trailing timer, so a
change moving both halves still costs a single PUT.

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
      "id": "t-3f9c…", "label": "Polish", "lang": "pl", "isSource": false,
      "groupCount": 190, "staleCount": 1, "untranslatedCount": 0, "reflowNeeded": false,
      "appliedPreset": null,
      "groups": [ { "id": "t-3f9c:0", "start": 0.0, "end": 1.4, "text": "czerwony samochód",
                    "state": "stale", "sourceText": "the red cart", "previousText": null } ],
      "render": { "config": { "...": "…" }, "custom_groups": [ "…" ], "output_name_suffix": ".pl" }
    }
  ],
  "agent": { "lastCommandId": "c-01H…", "lastCommandStatus": "ok", "lastCommandError": null }
}
```

- `tracks[].render` is
  `buildRenderBody(track.settings, displayGroupsFor(track), track.groupsEdited, …)` —
  byte-for-byte the body the UI's own render/export uses.
- **`output_name_suffix` is a body key**, a sibling of `config`, never inside it:
  omitted on the source, `.${lang}` on a translated track. It lives on the *request*
  models (`VideoRenderRequest`, `HyperframesRenderRequest`) and never on
  `VideoRenderConfig` — putting it there would trigger the seven-file settings pipeline
  and `backend/tests/test_caption_cfg_contract.py`.
- `tracks[].groups` is **compact — no words**. `state` / `sourceText` / `previousText`
  appear on translated tracks only.
- The MCP `get_ui_state` tool returns `tracks` with `groups` and `render` **stripped**
  (inventory only), to protect the token budget. `get_track` is how you read groups.
  The backend serves the mirror verbatim; it does not validate it.
- `agent` is the command echo the confirm-by-poll reads. `AgentLiveSync` echoes for
  **every** exit path, including "no project is open", so a poll can never hang on a
  refused command.

### `custom_groups: []` vs `None`

A translated track always carries `custom_groups` — `[]` when every group is still an
untranslated placeholder. So `groups_for_render` (`backend/exporters/video_render.py`)
tests `custom_groups is not None`, **not** truthiness. Reading `[]` as "unset" would
fall back to re-chunking the transcript and draw the *source* language over the
translated track. Pinned by a test; do not "simplify" it back.

## Project file: version 2

`PROJECT_VERSION = 2` (`lib/project.ts`). Version 2 is purely **additive**: every v1 key
keeps its v1 meaning and describes the **source** track. Added:

```ts
version: 2
tracks?: TranslatedTrackFile[]   // translated tracks only; absent on v1 files
activeTrackId?: string           // absent → source
```

A v1 file is a v2 file with no `tracks`, so `migrateProjectFile` is
`{...file, version: 2, tracks: file.tracks ?? []}` plus the per-track retrofits
(`ensureWordIds`, `adoptWordIds`, `adoptEndEdited`). Older builds ignore unknown keys
and open the source track — the forward compatibility is by construction, not by a
migration step.

`.capforge` is a **trust boundary**: `migrateProjectFile` hand-validates the file and
throws typed `ProjectFileError` / `ProjectVersionError` (matching
`electron/preset-io.js`; Zod is not a dependency). `version > PROJECT_VERSION` is
refused with a message telling the user to update, where previously `project:open`
returned raw JSON with no check at all.

`adoptEndEdited` runs on the **source** track only. The retrofit infers "hand-placed"
from `end ≠ last word's end`, which is the *normal* state of a source-linked translated
group — applying it there would exempt every translated group from gap closing.
Translated groups always carry `endEdited` explicitly.

## The agent loop

Four tools in `mcp_server/tracks.py`, registered onto the shared `mcp` instance by
`tracks.register(mcp, lambda: _client)`. None of them mutates backend state: every write
is a command plus a confirm-by-poll (`send_and_confirm`), and every read comes from the
mirror.

1. **`create_track(lang, label?, copy_style_from?)`** — mints a `track_id`, sends the
   command, confirms, and returns the new track's group ids paired 1:1 by index with the
   **source** text to translate. Side effect: the app switches to the new tab, so the
   *active* track — what `get_ui_state`, `render_frame` and `render` describe with no
   `track_id` — is now this one. Refused when the transcript's words carry no ids yet.
   If the two group counts ever disagree it pairs over the shorter list and returns a
   `warning` rather than inventing empty source text.
2. **`set_track_text(track_id, entries)`** — wholesale per-group replacement,
   `[{group_id, text}]`. Timings are derived proportionally across the group's existing
   span. Every `group_id` is validated up front, so a batch with one bad id changes
   nothing. This is **not** `update_words`, and it never calls `apply_word_edits`.
3. **`check_layout(t, platform?, track_id?, scan=True, max_lines=2)`** — the scan mode
   measures **every** group instead of rendering one frame
   (`backend/exporters/layout_scan.py`), reusing the renderer's own
   `measure_group_words` + `wrap_rows`, so the row split it reports is the row split
   Pillow will draw. A violation is "wraps onto more than `max_lines` rows" or "a single
   row is wider than the caption box". In `rsvp` mode it returns `violations: []` plus a
   note — a single sliding line has no wrap overflow.
4. Shorten the offending translations — same meaning, fewer characters — re-write with
   `set_track_text`, and re-scan until clean. Polish and German run 10–15 % longer than
   English; a three-line caption is the expected failure.

For repairs: **`get_track(track_id?, stale_only?, start?, end?)`** reads the mirror's
compact groups (never words) and can filter to the groups needing work or to a time
window; **`reflow_track(track_id)`** is the fix for `reflowNeeded`, returning the new
counters plus the blank groups with their `previousText`.

`set_style`, `apply_preset`, `render_frame`, `check_layout`, `render`,
`render_hyperframes` and `export` all take an optional `track_id` (default: the active
track). `render` still submits `tracks[i].render` **verbatim** — the suffix is already
inside it — because the casing bridge lives in `lib/render.ts` and nothing rebuilds a
render body in Python. `export` refuses a translated track with no captions yet rather
than writing an empty file.

## The UI

- **`components/tracks/TrackTabs.tsx`** — the tab strip, mounted in `App.tsx` directly
  above the `ResultsScreen` container. It must live there and not inside `ResultsScreen`,
  which remounts per track (its key is
  `` `${resultsSessionId}:${activeTrackId}:${revisions[activeTrackId] ?? 0}` ``).
  Source tab first with no close button; a translated tab shows a stale/untranslated
  count badge and a dot when `reflowNeeded`; a trailing `+`.
- **`components/tracks/LanguagePicker.tsx`** — a portalled popover over `LANGUAGES`
  (`lib/languages.ts`, 46 entries with their script). One click creates the track,
  copying the **active** track's style. `LanguagePickerPanel` is exported separately so
  it can be tested under `renderToStaticMarkup`.
- **`components/tracks/ReflowBanner.tsx`** — one line plus a "Re-flow from source"
  button, under the Text/Groups tab bar so it is visible in both views.
- **`GroupEditor`** rows show a chip beside the `↺` end marker for `stale`
  ("source changed") and `untranslated` ("no text"); nothing for `clean`.
- **`StudioPanel`** hides the *Words per group* row on a translated track. Grouping is
  inherited; `autoGroup=false` guards the rebuild path independently, so a translated
  track can never hit `buildStudioGroups`.
- Undo is per track: settings undo via `createKeyedUndoStacks` (`lib/undoStack.ts`) keyed
  by track id; editor undo resets on the remount a tab switch causes.
- `hooks/useTrackActions.ts` routes UI create/reflow through the same
  `applyTrackCommand` (`lib/trackCommands.ts`) the agent commands use, so there is one
  implementation of each.

## What is deliberately not there

- **No Python twin of any track rule.** No `classify`, `bake`, `reflow` or link in
  `backend/` or `mcp_server/`; the greps that assert this are in Phase 6 of the plan.
- **No `delete_track` MCP tool.** Closing a tab is a UI action with a confirm dialog;
  an agent deleting a user's translations unprompted is not a capability worth having.
- **No per-language font table.** A new track copies the source's style verbatim. If the
  language's script is not Latin and the copied family resolves to a *bundled* font
  (every face in `Fonts/` is a Latin display face), the app shows one info toast
  suggesting a system font. That is the whole mechanism.
- **No batch render.** There is no `tracks: "all"` mode; an agent loops over
  `render(track_id)`.
- **No in-app translation.** The agent translates; CapForge stores and renders.
- **No RTL or CJK handling.** Layout is LTR and space-separated throughout.
- **No bilingual or stacked display.** One track renders at a time.
- **No label uniqueness.** `create_track("pl")` twice makes two Polish tabs with the same
  `.pl` suffix, the second render overwriting the first.
