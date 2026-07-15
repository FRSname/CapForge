# Plan: Fill gaps between groups (`fill_gaps` / `fillGaps`)

**Status:** planned, not started
**Branch suggestion:** `feat/fill-group-gaps` off `main` (all line numbers scouted on main @ `1bf50cf`).
**Orchestration:** each phase runs via the `implementer` agent (no model overrides). `scout` only for fact gaps.

## Problem

Between caption groups there are silence gaps where no caption is on screen. Add a **Fill gaps**
toggle in the **Layout** card: when on, each group's END time stretches to the NEXT group's
START, so a caption stays visible until the next one appears.

## Semantics (one pure transform, applied consistently)

- `stretch(groups)`: for each group `i < last`, if `groups[i+1].start > groups[i].end`, set
  `groups[i].end = groups[i+1].start`. Never shrink (overlapping/out-of-order groups keep
  their end). Last group unchanged. Word timings unchanged — only the group's outer `end`
  moves, so word animations/karaoke are unaffected; the last word simply holds its "past"
  state until the next group starts. Group exit animations anchor to the (now later) end —
  that is the intended behavior (caption holds, then exits right as the next appears).
- **It is a derived view, not an edit**: `studioGroups` state, the Groups editor, the
  timeline, project save, and the `custom_groups` render payload all keep TRUE word-bounded
  times. The stretch is applied (a) in the frontend only where the preview overlay consumes
  groups, and (b) in the backend after its custom-vs-auto group selection — driven by a new
  `fill_gaps` config flag. This keeps `groupsEdited` semantics and re-grouping intact.
- Subtitle file exports (SRT/ASS) consume segments/other paths and are NOT affected.

## Phase 0 — Documentation Discovery (DONE — orchestrator-verified facts)

(Scout agents hit the session usage limit; the orchestrator gathered these facts directly
with targeted reads. Every location below was read this session on main.)

### Where groups come from

| Concern | Location | Fact |
|---|---|---|
| Frontend grouping | `src/renderer/src/lib/groups.ts:21-58` (`buildStudioGroups`) | group `start`/`end` = first word start / last word end (`:49-50`); editor primitives (merge/split/move/reorder) + `finalizeBounds` (`:166-174`) all re-derive bounds from words |
| Frontend group state | `src/renderer/src/components/screens/ResultsScreen.tsx:64,153,179` | `buildStudioGroups(result.segments, settings.wordsPerGroup)`; `studioGroups` persisted to project only when edited (`:321`), restored at `:329-330` |
| Overlay visibility | `src/renderer/src/hooks/useSubtitleOverlay.ts:71-78` | picks `activeGroup` where `seg.start <= currentTime && currentTime < seg.end` (half-open — adjacent stretched groups cannot double-render); `age`/`remaining` for entry/exit anims at `:115-116` |
| Render body condition | `src/renderer/src/lib/render.ts:151-157` (+ comment `:50`) | `custom_groups` sent ONLY when `groupsEdited` or any `positionOverride`; otherwise the BACKEND re-groups — so fill-gaps MUST be a backend config flag, not baked into sent groups |
| Backend grouping | `backend/exporters/video_render.py:265-295` (`_build_groups`) | mirrors frontend derivation; group `end` = `chunk[-1].end` (`:289`) |
| Backend selection point (Pillow) | `video_render.py:1214-1217` | `groups = custom_groups` else `_build_groups(...)` — single point to apply the stretch for BOTH custom and auto groups |
| Backend selection point (HyperFrames) | `backend/exporters/hyperframes_project.py:735` (imports `_build_groups` at `:35`) | same `custom_groups if custom_groups else _build_groups(...)` pattern — second call site for the stretch |
| HTML runtime | `hyperframes_caption_html.py:163` (`caption_groups_json`), `:325` | receives already-built group dicts; runtime keys visibility on group start/end ("one group visible at a time, hard kill at group end"). Groups arrive pre-stretched from the server → **no runtime JS change, no CAP_CFG key, no SCAFFOLD_VERSION bump** (the scaffold fingerprint covers group payload changes automatically) |

### UI / settings precedents

| Concern | Location | Fact |
|---|---|---|
| Boolean schema field | `backend/models/schemas.py:193` | `shadow_enabled: bool = Field(False, description=...)` — exact shape for `fill_gaps` |
| Grouping schema fields | `schemas.py:156` (`words_per_group`), `:201` (`CustomGroup`), `:217/:224` (`custom_groups` on render + hyperframes-export configs) | `fill_gaps` must be added to `VideoRenderConfig`; verify whether the hyperframes-export config at `:224` shares it via inheritance or needs its own field |
| Boolean toggle UI | `src/renderer/src/components/studio/StudioPanel.tsx:444-448` | `shadowEnabled` checkbox row (`checked={s.shadowEnabled}`, `onChange={(e) => set('shadowEnabled', e.target.checked)}`, On/Off text) — copy for the Layout card row |
| Layout card rows | `StudioPanel.tsx` Layout section (Words/Grp, Lines, X/Y Pos, Max width, Safe zones) | insert "Fill gaps" row after "Words/Grp"; StudioSettings interface ~`:57` area (`wordsPerGroup`), `DEFAULTS` ~`:147` |
| Settings search | `src/renderer/src/lib/settingsSearch.ts:140-147` (layout registry entries), `CARD_SETTINGS.layout` `:49` | add `fillGaps` to the layout list + one registry entry |
| Presets boolean | `src/renderer/src/lib/presets.ts:69` (`shadowEnabled?: boolean`), `:166` (`Boolean(p.shadowEnabled)`), `:241` | copy for `fillGaps` |
| Bridge | `src/renderer/src/lib/render.ts` config object | add `fill_gaps: settings.fillGaps ?? false`; update `render.test.ts` golden default config |

### Anti-patterns (verified — do NOT do)

- **Do not** mutate `studioGroups` / bake stretched ends into state, the Groups editor, the
  timeline, project save, or the `custom_groups` payload — the stretch is derived-only.
  Baking it would corrupt `finalizeBounds` round-trips and make edits sticky.
- **Do not** implement frontend-only: with unedited groups the backend re-groups itself
  (`render.ts:151-157`), so preview and export would diverge without the `fill_gaps` flag.
- **Do not** stretch in `_build_groups`/`buildStudioGroups` themselves — they're also used
  for editor state; apply the transform at the consumption points listed above.
- **Do not** shrink ends or reorder; only extend into a positive gap.
- **Do not** bump SCAFFOLD_VERSION — no CAP_CFG/runtime JS shape change (groups payload
  values changing is covered by the scaffold fingerprint).
- **Do not** touch ASS/SRT exporters.

---

## Phase 1 — Shared transforms + backend flag (agent: implementer)

1. `backend/models/schemas.py`: `fill_gaps: bool = Field(False, description="Stretch each group's end to the next group's start so captions persist through gaps")` on `VideoRenderConfig` next to `words_per_group` (`:156`); confirm the hyperframes-export config (`:224` area) inherits or add it there too.
2. `backend/exporters/video_render.py`: add pure helper `fill_group_gaps(groups: list[dict]) -> list[dict]` (new dicts, no mutation — copy `_build_groups`' dict shape) implementing the Semantics above. Apply at `:1214-1217`: after the custom/auto selection, `if getattr(config, "fill_gaps", False): groups = fill_group_gaps(groups)`.
3. `backend/exporters/hyperframes_project.py:735`: same guarded call after its selection line (import the helper next to `_build_groups` at `:35`).
4. `src/renderer/src/lib/groups.ts`: add pure `fillGroupGaps(groups: Segment[]): Segment[]` (immutably, mirroring the backend helper; follow the file's existing style).
5. Backend unit tests: grep `backend/tests/` for existing `_build_groups` coverage and add `fill_group_gaps` tests beside it (gap stretched; overlap untouched; last group untouched; empty list).

Verify: `.venv-dev/bin/python -m pytest backend/tests/ -x -q` green; `grep -n "fill_gaps\|fill_group_gaps" backend/models/schemas.py backend/exporters/video_render.py backend/exporters/hyperframes_project.py`.

## Phase 2 — Frontend wiring (agent: implementer)

1. `StudioPanel.tsx`: `fillGaps: boolean` in StudioSettings, `false` in DEFAULTS, checkbox row "Fill gaps" (copy `:444-448`) after Words/Grp in the Layout card.
2. `render.ts`: `fill_gaps: settings.fillGaps ?? false`; update `render.test.ts` default-config expectation.
3. Preview: in `ResultsScreen.tsx`, derive `const displayGroups = useMemo(() => settings.fillGaps ? fillGroupGaps(groups) : groups, [groups, settings.fillGaps])` and pass it ONLY to the player/overlay consumer (trace where `groups` currently flows to `useSubtitleOverlay` and swap that one prop). GroupEditor, timeline, save/load, and the render body keep `groups`.
4. `types` — none needed (`Segment` already has start/end). `settingsSearch.ts`: `fillGaps` in `CARD_SETTINGS.layout` (`:49`) + registry entry `{ label: 'Fill gaps', cardId: 'layout', keywords: ['gap', 'stretch', 'continuous', 'hold', 'silence'] }` near `:144`. Check the label is unique (it is — no other 'Fill gaps' row).
5. `presets.ts`: `fillGaps?: boolean` + both converters (copy `shadowEnabled` `:69,:166,:241`); update `presets.test.ts` round-trip keys.
6. Frontend unit tests: add `fillGroupGaps` cases to the groups test module (find `groups.test.ts` under `src/renderer/src/lib/`; if absent, add cases to the nearest lib test following repo conventions).

Verify: `npm run typecheck`; `npm test` green; grep sweep for `fillGaps` across the six files.

## Phase 3 — Cross-renderer proof (agent: implementer)

1. Parity: add `test_fill_gaps_parity` to `backend/tests/test_caption_parity.py` — a two-group fixture with a real gap, `fill_gaps=True`, sampled at a `t` INSIDE the former gap: both Pillow and HyperFrames must render the FIRST group's caption (copy an existing two-assertion test's structure, e.g. the highlight-offset one).
2. Optional golden: skip — goldens are single-`t` pixel pins and the parity case covers the timing semantics; add one only if review asks.

Verify: full pytest green; `CAPFORGE_PARITY=1 .venv-dev/bin/python -m pytest backend/tests/test_caption_parity.py -q` green.

## Phase 4 — Final verification (agent: implementer; code-reviewer pass)

1. Full backend suite + typecheck + vitest.
2. Code review of the branch diff (focus: derived-view discipline — no stretched ends leaking into state/save/custom_groups; both backend call sites guarded; overlay half-open interval with adjacent groups).
3. Manual QA (user): toggle Fill gaps on a transcript with silence → caption holds until the next group in preview; classic render and HyperFrames render match; toggle off restores gaps; group editing still works with the toggle on; preset round-trip.

## Open decisions (defaults chosen, flag if user disagrees)

- **No cap on stretch length** — a 30s silence keeps the caption 30s (exactly "fill the gaps"). A max-hold-seconds knob can be added later if wanted.
- **Timeline shows true (unstretched) times** — the timeline is an editing surface for word timings; showing stretched ends there would fight the drag/snap logic.
- **Control style:** checkbox row like Shadow's On/Off (the "button" requested), not a SegmentedControl.
