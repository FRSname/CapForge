# Word Timing UX + Timeline Layout Plan

**Problem 1 (word timing):** Adding a new word to a caption — or retiming an existing one —
is clunky: the only UI is numeric `M:SS.SSS` inputs behind a word-chip click in
SubtitleEditor, and words typed into a segment inherit the previous word's timing wholesale.

**Problem 2 (layout):** The center column has a large block of empty space under the
timeline/transport strip. The timeline should pin to the bottom of the app and the video
preview should grow into the freed space.

**Solution shape (three legs):**
1. **Auto re-align (the big win):** new backend endpoint runs WhisperX forced alignment on an
   edited segment's text against the original audio → word timings recomputed automatically.
   User edits text freely, presses "Re-align", timing just works.
2. **Word lane on the timeline:** when a group is selected, the canvas timeline shows its
   words as draggable sub-blocks (drag edges/body, snap to playhead + neighbors) for manual
   fine-tuning over the waveform.
3. **Layout fix:** `AudioPlayer` becomes `flex-1`, video caps (`55vh`/`40vh`) removed,
   bottom strip (timeline zoom bar + canvas + waveform + transport) naturally pins to bottom.

Each phase is self-contained and lands independently. Phases 1–3 are the core; 4–5 are the
manual-fine-tuning leg and ergonomics.

---

## Phase 0 findings (discovery already done — verified 2026-07-02)

### Data model
- Frontend `Word { word, start, end, score?, overrides? }`, `Segment { id, start, end, text, words, speaker? }`
  — `src/renderer/src/types/app.ts:42–59`.
- Backend `WordSegment { word, start, end, score?, speaker? }`, `Segment` (no `id` field!),
  `TranscriptionResult { segments, language, audio_path, duration }`
  — `backend/models/schemas.py:79–99`. `audio_path` is preserved in the global
  `current_result`, so the backend can reload audio any time.

### Existing word-timing surfaces
- `SubtitleEditor.tsx:161–174` — text edit re-derives words by whitespace split; timings are
  kept by index; **new words inherit previous word timing / segment bounds** (this is the pain).
- `SubtitleEditor.tsx:88–107` — `handleWordTimingChange()` (numeric input path);
  `parseTimePrecise()` at 610–615 accepts `1.234` and `M:SS.SSS`.
- `useTimeline.ts` — segment-level blocks only (`195–246`), edge/body drag with snapping
  (`313–429`, `EDGE_HIT=6`, `SNAP_THRESHOLD_PX=8`), `RULER_H=20`, `TRACK_H=32`,
  `TIMELINE_HEIGHT=52` (lines 12–18). No word rendering, no word drag.
- Segments state + undo live in **ResultsScreen** (`ResultsScreen.tsx:53`, `useUndoRedo` at
  79–90, `pushUndo()` before each edit). Group timing drags go through `handleSegmentEdge`
  (368–391) and set `groupsEdited`.
- Group rebuild subtlety: `ResultsScreen.tsx:61–170` — when `groupsEdited` is true and
  segment count is unchanged, manual group bounds + word overrides are **preserved**, which
  can swallow re-aligned word timings if not handled (see Phase 3).

### Backend alignment machinery
- `backend/engine/transcriber.py:89–104` — align step:
  `whisperx.load_align_model(language_code, device)` then
  `whisperx.align(segments, model_a, metadata, audio, device, return_char_alignments=False)`.
  Align model is loaded fresh and freed every call today; main Whisper model IS cached
  (`_load_model`, 141–195).
- `whisperx.align` takes the **full audio** array plus segment dicts with `text`/`start`/`end`
  and aligns each segment inside its own time window — so single-segment re-align is the
  intended usage. **Executor must re-verify** the exact signature/return shape against the
  installed package: read `whisperx/alignment.py` in the backend's site-packages before coding.
- Endpoints (`backend/main.py`): `/api/transcribe` (333), GET/PUT `/api/result` (388/396),
  `/api/serve-audio` (271). **No re-align endpoint exists.** PUT `/api/result` just overwrites
  `current_result` in memory.

### Layout root cause
- `ResultsScreen.tsx:509–522` — player container is `flex-1 flex flex-col overflow-hidden`
  (correct), but its only child `AudioPlayer` root (`AudioPlayer.tsx:280`) is
  `flex flex-col` **without `flex-1 min-h-0`** → it wraps content and leaves the gap below.
- Video wrapper hard caps: not-zoomed `maxHeight: '55vh'` + `maxWidth: calc(55vh * AR)`
  (`AudioPlayer.tsx:321–324`), zoomed `height: '55vh'` (319), audio-only `40vh` (347–350).
- Waveform fixed 60px (`useWaveSurfer.ts:78`), canvas timeline fixed 52px, transport ~36px —
  these stay natural-height; only the video area should flex.
- **No ResizeObserver anywhere** — `useSubtitleOverlay` recomputes its CSS letterbox transform
  per `draw()` call, so a paused video that resizes needs an explicit redraw trigger.

---

## Phase 1 — Layout: pin timeline strip to bottom, let video grow

**Files:** `src/renderer/src/components/player/AudioPlayer.tsx`,
`src/renderer/src/hooks/useSubtitleOverlay.ts` (redraw trigger only — NOT rendering formulas).

1. `AudioPlayer.tsx:280` root: add `flex-1 min-h-0` so it fills the player container from
   `ResultsScreen.tsx:509`.
2. Video area (282–359): make the `relative flex-1 min-h-0` container center its child
   (`flex items-center justify-center`). Replace the hardcoded caps:
   - not-zoomed wrapper: keep `aspectRatio`, replace `maxHeight: '55vh'` /
     `maxWidth: calc(55vh * AR)` with `maxHeight: '100%'`, `maxWidth: '100%'`
     (aspect-ratio + both max constraints letterbox correctly in Chrome 130 / Electron 33);
   - zoomed wrapper: `height: '55vh'` → `height: '100%'`;
   - audio-only placeholder: same treatment for the `40vh` caps.
3. Bottom strip (timeline zoom bar, canvas timeline, waveform, transport, lines 362–437):
   unchanged natural heights — with the video area flexing, the strip pins to the bottom and
   the empty space disappears.
4. Resize-aware overlay: the subtitle canvas transform is computed from
   `anchor.offsetWidth/Height` inside `draw()` (`useSubtitleOverlay.ts`). Add a
   `ResizeObserver` on the anchor element that re-invokes `draw(lastTime)` (keep a
   `lastTimeRef`). Follow the repo's canvas convention (CLAUDE.md): native listener/observer
   in a `useEffect` with cleanup; always call `draw()` after state changes.

**Verify:**
- [ ] Window at various heights: no empty band below transport; video grows/shrinks; captions
      overlay stays glued to the video (resize while paused).
- [ ] Audio-only project: placeholder also fills.
- [ ] Video zoom (Ctrl+Wheel, dbl-click) still works in the larger area.
- [ ] `npm run typecheck` clean.

**Anti-patterns:** do NOT touch any rendering formula in `useSubtitleOverlay.ts` (parity
contract, CLAUDE.md); no new hardcoded vh caps; don't resize the waveform/timeline strip.

---

## Phase 2 — Backend: `/api/realign` (WhisperX forced alignment on demand)

**Files:** `backend/engine/transcriber.py`, `backend/models/schemas.py`, `backend/main.py`,
`backend/tests/test_realign.py` (new).

0. **Read the installed whisperx source first** (`whisperx/alignment.py` — find via
   `.venv-dev` or the runtime venv) and confirm: `align()` parameter order, that segments are
   dicts with `text`/`start`/`end`, and the return shape (`{"segments": [...]}` with per-word
   `word/start/end/score`). Do not code against an assumed API.
1. Transcriber: add `realign_segments(segments: list[Segment], audio_path: str, language: str) -> list[Segment]`:
   - `whisperx.load_audio(audio_path)` (full file — align slices per segment window);
   - **cache the align model per language** on the instance (`self._align_model`,
     `self._align_metadata`, `self._align_lang`) so repeated re-aligns during an editing
     session don't pay the model load each time; free it in `unload_model()`;
   - call `whisperx.align()` with the segment dicts, rebuild `Segment`/`WordSegment` models
     reusing the `_build_result` conversion pattern (`transcriber.py:208–229`);
   - words WhisperX can't align (numbers, OOV) may come back missing timings — reuse the
     existing skip/fallback behavior in `_build_result` and interpolate from neighbors so the
     response always has complete word timings.
2. Schemas: `RealignRequest { segments: list[Segment], language: Optional[str] }` (language
   falls back to `current_result.language`), `RealignResponse { segments: list[Segment] }`.
3. Endpoint `POST /api/realign` in `main.py`: stateless — takes segments, returns aligned
   segments. 400 if no `current_result`/`audio_path` or file missing; run in a thread
   (`run_in_executor` / `asyncio.to_thread`, matching how `/api/transcribe` offloads work) so
   the event loop isn't blocked.
4. Tests: unit-test the request/response models + endpoint guards (no result loaded, missing
   file) with the transcriber mocked; a real-audio alignment test can be opt-in like the
   parity suite (env-gated) if model download is needed.

**Verify:**
- [ ] `.venv-dev/bin/python -m pytest backend/tests` — all pass.
- [ ] Manual: `curl -X POST /api/realign` with an edited segment returns per-word timings that
      differ from the input and are monotonic (start < end, non-overlapping within segment).

**Anti-patterns:** don't run alignment on the event loop; don't invent whisperx kwargs not in
the installed source; don't mutate `current_result` inside the endpoint (frontend owns the
merge and its undo history).

---

## Phase 3 — Frontend: "Re-align timing" flow in the editor

**Files:** `src/renderer/src/components/editor/SubtitleEditor.tsx`,
`src/renderer/src/components/screens/ResultsScreen.tsx`, api helper
(follow existing fetch patterns, e.g. wherever PUT `/api/result` is issued).

1. Per-segment "Re-align" button in SubtitleEditor (next to the existing word-chip timing UI).
   Show it always; highlight it after a text edit changes the word count (that's exactly when
   timings are stale). Manual trigger first — no silent auto-realign (deterministic; auto can
   be a follow-up toggle).
2. Handler in ResultsScreen (where segments state + undo live): `pushUndo()` →
   `POST /api/realign` with the target segment (strip frontend-only fields the backend schema
   doesn't know: `id`, per-word `overrides` — re-attach both to the response by word index) →
   replace the segment in `segments` state → toast success/error (`useToast`, per CLAUDE.md).
   Spinner state on the button while in flight.
3. **Group-rebuild correctness:** after re-align, verify the derivation effect
   (`ResultsScreen.tsx:61–170`) propagates new word timings into groups even when
   `groupsEdited` is true and segment count is unchanged — the preserve-manual-bounds branch
   (108–140) may keep stale word timings. If so, rebuild the affected groups' `words` from the
   updated segment (preserving `overrides` by index) and let `finalizeBounds` recompute bounds.
4. Multi-word-count mismatch: if the re-aligned word count differs from the edited text's
   count (WhisperX tokenization), trust the backend's words — they ARE the alignment.

**Verify:**
- [ ] Add a word mid-segment in the Text view → Re-align → chips show sensible per-word
      timings; playback highlight hits the new word on beat.
- [ ] Undo (Cmd+Z) restores pre-realign timings; redo re-applies.
- [ ] Per-word style overrides survive a re-align (same word index keeps its override).
- [ ] Groups view + timeline blocks reflect the new timings (including with prior manual
      group edits).
- [ ] Backend unreachable → error toast, segments untouched.
- [ ] `npm run typecheck` clean.

**Anti-patterns:** don't send frontend `id`/`overrides` to the backend Pydantic model (it will
422); don't bypass `pushUndo`; no silent failure (toast every error).

---

## Phase 4 — Word lane on the canvas timeline (manual fine-tuning)

**Files:** `src/renderer/src/hooks/useTimeline.ts`,
`src/renderer/src/components/player/AudioPlayer.tsx` (container height),
`src/renderer/src/components/screens/ResultsScreen.tsx` (word-edit callback).

Design: when a group is **selected** (click its block; reuse/extend the existing hover/hit
logic), the timeline grows by a word lane (`WORD_TRACK_H = 24`; export a dynamic height —
`TIMELINE_HEIGHT` stays the collapsed constant, container animates between the two). The
selected group's words render as sub-blocks in the lane.

1. Draw: word blocks with 1px gaps, active-word tint, truncated labels when width allows.
   Copy the segment-block drawing pattern (`useTimeline.ts:195–246`).
2. Interactions (copy the segment drag machinery, `313–429`):
   - drag word start/end edge (`EDGE_HIT=6`) → clamp to `[prevWord.end, nextWord.start]` and
     the group bounds, min duration 0.04s;
   - drag word body → move start+end together, same clamps;
   - snap (`SNAP_THRESHOLD_PX=8`) to playhead and adjacent word edges;
   - `pushUndo()` on mousedown via a drag-start callback (mirror
     `handleSegmentEdgeDragStart`, `ResultsScreen.tsx:389–391`).
3. Word edits flow through a new `onWordEdge(groupId, wordIdx, patch)` prop →
   ResultsScreen updates `groups` (word timings inside the group), sets `groupsEdited` —
   consistent with how group-level drags already work (`handleSegmentEdge`, 368–391).
   `finalizeBounds` semantics: if a word drag pushes past group bounds, group start/end
   follow (first/last word).
4. Escape/click-elsewhere deselects → lane collapses.

**Verify:**
- [ ] Select group → lane appears; drag a word edge over the waveform → preview highlight
      timing changes immediately; undo works.
- [ ] Words can't cross neighbors or invert (start ≥ end impossible).
- [ ] Timeline zoom/pan still smooth with the lane open; `draw()` called after every state
      mutation (canvas convention, CLAUDE.md).
- [ ] `npm run typecheck` clean.

**Anti-patterns:** no React `onWheel` for canvas (native listener, `{ passive: false }` —
CLAUDE.md); don't mutate `segments` from the timeline (groups are the render source; Text
view numeric inputs remain the segment-level path); don't repaint via React state churn per
mousemove — use refs + `draw()` like the existing drag code.

---

## Phase 5 — Ergonomics: playhead-set buttons (small, high leverage)

**Files:** `src/renderer/src/components/editor/SubtitleEditor.tsx`,
`src/renderer/src/components/screens/ResultsScreen.tsx` (needs current playhead time —
already tracked for the player; thread it or a getter ref down).

1. In the word-chip timing editor (`SubtitleEditor.tsx:400–440`), add two icon buttons beside
   the S/E inputs: "set start to playhead" / "set end to playhead". Flow: scrub to the word's
   audible start, click, done — no typing `M:SS.SSS`.
2. Same guards as `handleWordTimingChange` (88–107): `pushUndo` first, clamp to neighbors.

**Verify:**
- [ ] Buttons set the value from the live playhead; chips + preview update; undo works.
- [ ] `npm run typecheck` clean.

---

## Phase 6 — Final verification

- [ ] `npm run typecheck` clean.
- [ ] `.venv-dev/bin/python -m pytest backend/tests` — all pass (203+ baseline).
- [ ] Golden-frame + parity suites untouched — `git diff` must show **zero changes** to
      `_render_frame()` (`video_render.py`), `hyperframes_caption_html.py`, or any rendering
      formula in `useSubtitleOverlay.ts` (only the ResizeObserver redraw trigger is allowed).
- [ ] Manual end-to-end: transcribe a clip → add a word → Re-align → fine-tune one word on the
      timeline word lane → render classic + HyperFrames → timings match preview.
- [ ] Layout QA at small window heights (video shrinks gracefully, strip never clipped) and
      with the left editor panel resized to min/max width.
- [ ] Grep guards: no `55vh`/`40vh` remnants in AudioPlayer; no `onWheel=` on canvases; no
      whisperx kwargs beyond those in the installed `alignment.py`.

## Open decisions (defaults chosen, revisit if wrong)
- **Manual Re-align button** (not auto-on-edit) — deterministic, user-controlled; auto mode
  can be added later as a toggle.
- **Word lane on group selection** (not zoom-threshold) — explicit, discoverable, keeps the
  collapsed timeline compact.
- **Align model cached per language** in the Transcriber instance — trades ~few hundred MB
  RAM for instant repeat re-aligns; freed via `unload_model()`.
