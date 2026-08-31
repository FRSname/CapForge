# SRT cue segmentation — long, multi-sentence subtitle lines

**Bug:** an exported `.srt` sometimes contains one cue holding several sentences on a
single very long line.

**Status:** IMPLEMENTED 2026-08-31 (uncommitted). SRT + VTT done; ASS deliberately deferred.

---

## Phase 0 — Discovery (already done; read this before writing code)

### Root cause (verified against source, not assumed)

`export_srt_standard` emits **one cue per WhisperX segment, verbatim**, with no length,
duration or sentence handling at all:

- [srt_standard.py:15-22](backend/exporters/srt_standard.py:15) — `for seg in result.segments: … lines.append(seg.text.strip())`.

And WhisperX segments are **VAD/decoder chunks, not sentences**. The codebase already
says so:

- [transcriber.py:250-252](backend/engine/transcriber.py:250) — "align() may split one segment into sentence-level subsegments — merge the words back so the caller keeps a 1:1 segment mapping." CapForge deliberately re-merges, so a segment routinely spans multiple sentences.

So a long segment → one enormous cue. That is the reported bug, exactly.

### Same defect, same shape, in two sibling exporters

- [vtt_export.py:14-21](backend/exporters/vtt_export.py:14) — one cue per segment, identical.
- [ass_export.py:95-103](backend/exporters/ass_export.py:95) — one `Dialogue` per segment (with per-word `\k` karaoke tags).
- [srt_word.py:14-25](backend/exporters/srt_word.py:14) — one cue **per word**. Not affected; leave alone.

### The grouping machinery that exists — and why it is NOT the default answer

`groups_for_render` ([video_render.py:425-460](backend/exporters/video_render.py:425)) is the
single place render paths decide `custom_groups`-or-build, and `_build_groups`
([video_render.py:380-421](backend/exporters/video_render.py:380)) chunks words by
`words_per_group` and runs gap closing. **The export path never touches it.**

Do not simply route SRT through it: display groups are typically 3–5 words, tuned for
on-screen captions. An `.srt` built from them swaps "one huge cue" for "hundreds of
one-breath cues" — a different flavour of wrong for a deliverable subtitle file.
Group-matching belongs behind an explicit opt-in (Phase 4).

### Export plumbing (allowed APIs — these exist; do not invent others)

| Thing | Location | Signature / shape |
|---|---|---|
| `ExportFormat` enum | [schemas.py:46-53](backend/models/schemas.py:46) | `srt_word, srt_standard, json, vtt, ass, subforge, hyperframes` |
| `ExportRequest` | [schemas.py:129-131](backend/models/schemas.py:129) | `formats: list[ExportFormat]`, `output_dir: str = "output"` — **no config, no groups** |
| Route | [main.py:847-855](backend/main.py:847) | `POST /api/export`, `Depends(require_local_token)` |
| `EXPORTERS` map | [main.py:1617-1625](backend/main.py:1617) | `{fmt: (fn, ext)}` |
| `_do_export` | [main.py:1635-1673](backend/main.py:1635) | calls `content = exporter_fn(result)` — single-arg today |
| `Segment` | [schemas.py:86-91](backend/models/schemas.py:86) | `start, end, text, words: list[WordSegment], speaker` |
| `WordSegment` | [schemas.py:78-83](backend/models/schemas.py:78) | `word, start, end, score, speaker` |
| Frontend caller | [ExportPanel.tsx:149-151](src/renderer/src/components/studio/ExportPanel.tsx:149) | `buildExportParams(formats, outputDir)` → `{formats, output_dir?}` |
| API client | [api.ts:374-376](src/renderer/src/lib/api.ts:374) | `api.exportResult(params)` → `post('/api/export', params)` |
| MCP tool | [server.py:201-205](mcp_server/server.py:201) | `export(formats, output_dir)` → `client.export({...})` |

### Findings worth acting on while here

1. **Stale comment.** [StudioPanel.tsx:243-244](src/renderer/src/components/studio/StudioPanel.tsx:243)
   says the `groups` prop is *"forwarded to ExportPanel for custom_groups payload"*.
   `ExportPanel` takes no `groups` prop and `buildExportParams` sends none. Either wire it
   (Phase 4) or fix the comment — do not leave it lying.
2. **No SRT library is installed.** [backend/requirements.txt](backend/requirements.txt)
   has 7 entries, none subtitle-related. Timestamp formatting is already 8 correct lines
   per exporter; only the *splitting policy* is new. **Recommendation: hand-roll, add no
   dependency** — the Python runtime is bundled and shipped by Electron, so a dep is a real
   packaging cost for ~60 lines of pure logic. (Phase 1 opens with a short reuse check so
   this is a decision, not an assumption.)
3. `pyproject.toml` sets `testpaths = ["backend/tests"]` — a bare `pytest` silently skips
   `mcp_server/tests`. Pass that path explicitly if you touch the MCP layer.

### Anti-pattern guards (apply to every phase)

- **Do NOT add cue settings to `VideoRenderConfig` or `StudioSettings`.** These are
  export-file settings, not caption *style*. Putting them there triggers the seven-file
  snake_case↔camelCase bridge **and** `backend/tests/test_caption_cfg_contract.py`, whose
  partition test fails the backend CI job on any unclassified `VideoRenderConfig` field.
  They belong on `ExportRequest`.
- **Do NOT shift word timings.** The repo-wide invariant (`lib/wordTiming.ts`,
  `mcp_server/cleanup.py`: *"Timing is never shifted"*) holds here. Cue boundaries must be
  taken from existing `WordSegment.start` / `.end` values, never recomputed.
- **Do NOT call `/api/realign`** from any export path. It is a manual button by design.
- **Do NOT reuse `_build_groups` / `groups_for_render`** for the default SRT path (see above).
- **Do NOT touch `srt_word.py`.** One-word-per-cue is its contract.

---

## Phase 1 — Pure cue-splitting module (TDD, no wiring)

### 1a. Reuse check (10 minutes, then decide and move on)

`gh search repos "srt segmentation subtitle line length"`, and check `srt` / `pysubs2` /
`pycaption` on PyPI. Record the outcome in the PR description. Expected outcome: adopt the
*conventions* (see below), write the ~60 lines locally, add no dependency. If a library
does turn out to carry the splitting policy itself, adopt it and say so.

### 1b. Write `backend/exporters/cue_split.py`

Pure, dependency-free, no I/O, no Pydantic-model mutation.

```python
@dataclass(frozen=True)
class CueSpec:
    max_chars_per_line: int = 42   # broadcast convention
    max_lines: int = 2
    max_duration: float = 7.0      # seconds
    min_duration: float = 1.0      # advisory; see the extension rule
    max_cps: float = 20.0          # reading speed, chars/second

@dataclass(frozen=True)
class Cue:
    start: float
    end: float
    lines: list[str]               # 1..max_lines
    speaker: str | None

def split_segments(segments: list[Segment], spec: CueSpec) -> list[Cue]: ...
```

**Algorithm — three ordered passes over each segment's word list, then wrapping.**

1. **Sentence pass.** Break after any word whose text ends in terminal punctuation
   (`.` `!` `?` `…` `。` `！` `？`), never producing a zero-word chunk. This alone fixes the
   reported "more sentences in one line".
2. **Length pass.** Any chunk longer than `max_chars_per_line * max_lines` is split again,
   choosing the break point in this order: after a `, ; : — –` nearest the chunk midpoint,
   else at the whitespace nearest the midpoint. Recurse until every chunk fits.
3. **Duration / rate pass.** While `duration > max_duration` **or**
   `chars / duration > max_cps`, split again using the same preference order. Never split
   below one word.

**Cue timing.** `start = chunk[0].start`, `end = chunk[-1].end` — copied, never computed.
`min_duration` may only *extend* a cue's `end` forward into genuine silence, capped at the
next cue's `start` and at the segment `end`; if there is no silence, the cue stays short.
Never move a `start`.

**No-word fallback.** When `seg.words` is empty (degraded alignment — see
`alignment_degraded` on `TranscriptionResult`), split the *text* by the same rules and
interpolate times proportionally by character count across `[seg.start, seg.end]`. This is
the **only** place a timestamp is synthesised, it stays inside the segment's own span, and
it must carry a comment saying so.

**Line wrapping.** Within a cue, choose the whitespace break that minimises the difference
in line lengths among breaks that keep every line ≤ `max_chars_per_line`; if no such break
exists, fall back to greedy fill. Emit `lines`, joined by the caller with `\n`.

### 1c. Write `backend/tests/test_cue_split.py` first

Follow the existing style — plain pytest functions, shared fixtures from
[conftest.py](backend/tests/conftest.py) (`transcription_result`, `empty_result`), no mocks.

Required cases:
- The reported bug: one segment, three sentences, ~200 chars → 3+ cues, every line ≤ 42 chars.
- Every cue boundary equals some existing `WordSegment.start`/`.end` (**timing-locality guard**).
- No cue exceeds `max_duration`; none exceeds `max_cps`.
- A single word longer than `max_chars_per_line` is emitted alone, not dropped or infinitely recursed.
- No-words segment → proportional times, all within `[seg.start, seg.end]`.
- Empty result → `[]`.
- Punctuation inside a word (`U.S.`, `3.5`) does not produce a one-word cue storm — pick the abbreviation handling in code and pin it with a test either way.
- Two lines are balanced, not `41 chars / 3 chars`.

### Verification

```bash
pytest backend/tests/test_cue_split.py -v
```

---

## Phase 2 — Wire into the SRT / VTT / ASS exporters (this is what ships the fix)

1. `backend/exporters/srt_standard.py` — `export_srt_standard(result, spec: CueSpec | None = None)`.
   Keep `_fmt` exactly as is (comma-milliseconds). Iterate `split_segments(...)`, join
   `cue.lines` with `\n`, number sequentially from 1.
2. `backend/exporters/vtt_export.py` — same change, keep its dot-milliseconds `_fmt`.
3. `backend/exporters/ass_export.py` — one `Dialogue` per **cue**; `_karaoke_text` must be
   re-scoped to the cue's word slice, not the whole segment. Multi-line cues use `\N`
   (`_escape` already handles literal newlines).
4. `backend/models/schemas.py` — add a `CueSpecModel(BaseModel)` mirroring `CueSpec` with
   `Field(...)` bounds (`max_chars_per_line: int = Field(42, ge=10, le=120)`,
   `max_lines: int = Field(2, ge=1, le=4)`, `max_duration: float = Field(7.0, gt=0)`,
   `min_duration: float = Field(1.0, ge=0)`, `max_cps: float = Field(20.0, gt=0)`,
   `split: bool = True`) and hang it on `ExportRequest` as `cue: CueSpecModel | None = None`.
   `split=False` is the escape hatch back to today's one-cue-per-segment behaviour.
   **Not on `VideoRenderConfig`.**
5. `backend/main.py` — in `_do_export`, add `_SPEC_AWARE = {SRT_STANDARD, VTT, ASS}` and call
   `exporter_fn(result, spec=spec)` for those, `exporter_fn(result)` otherwise. Thread
   `request.cue` through `export_result` ([main.py:847](backend/main.py:847)).

### Tests to update (deliberate contract change — the old assertion encodes the bug)

- `backend/tests/test_srt_standard.py:7` — `test_one_entry_per_segment_with_sequential_numbering`
  becomes one-entry-per-*cue*. Keep the timestamp-format and empty-result tests untouched.
- `backend/tests/test_vtt_export.py`, `backend/tests/test_ass_export.py` — same.
- Add a route test: `POST /api/export` with an explicit `cue` payload changes the file, and
  `cue: {split: false}` reproduces the legacy output byte-for-byte.

### Verification

```bash
pytest backend/tests -q && pytest mcp_server/tests -q
```

Manual: export an `.srt` from a real clip; confirm no cue exceeds two lines of 42 chars and
no cue holds two sentences.

---

## Phases 3 & 4 — cut (2026-08-31)

Scope confirmed by the user: *"I just want those classic .srt subtitles to be like
typical subtitles when I'm watching movies or YouTube."* So there is **no UI control and
no `ExportRequest.cue` plumbing** — the broadcast defaults are simply correct behaviour,
hard-coded as module constants in `cue_split.py`. That also drops the `schemas.py` and
`main.py` edits from Phase 2. If tuning is ever wanted, adding the request field later is
a small, isolated change.

The stale [StudioPanel.tsx:243](src/renderer/src/components/studio/StudioPanel.tsx:243)
comment about forwarding `groups` to ExportPanel is therefore **fixed, not implemented**.

## What was actually built (2026-08-31)

- **New** `backend/exporters/cue_split.py` (~250 lines) + `backend/tests/test_cue_split.py` (17 tests).
- **Rewritten** `backend/exporters/srt_standard.py`, `backend/exporters/vtt_export.py` — they now format only; all policy lives in `cue_split`.
- **Updated** `backend/tests/test_srt_standard.py`, `backend/tests/test_vtt_export.py` — the old "one entry per segment" assertions encoded the bug. Added a direct regression test for the reported paragraph-in-one-cue case and a max-duration test.
- **Fixed** the stale `groups` comment in `StudioPanel.tsx:243`.
- No new dependency, no `schemas.py` change, no `main.py` change, no `VideoRenderConfig` field.

### Two corrections to the plan above

1. **The reading-speed (CPS) pass was dropped.** Characters-per-second is
   *scale-invariant under splitting* — cutting a cue in half roughly halves both its
   text and its duration, leaving CPS unchanged. A `max_cps` split criterion would
   therefore never converge on fast speech while doing nothing useful. Fast delivery
   can only be fixed by extending timings, which this module is not allowed to do.
   `MAX_CPS` does not exist in the shipped module.
2. **`min_duration` only extends non-final cues.** The plan allowed the last cue to
   extend to `start + MIN_DURATION`; nothing in the export path knows the media
   duration, so that could overrun the end of the video. The final cue now keeps its
   natural end.

### ASS — deliberately not done

`ass_export.py:95` has the identical one-`Dialogue`-per-segment shape, but splitting
there means re-scoping `_karaoke_text`'s per-word `\k` tags to a cue's word slice.
That is genuinely different work from plain-text cue formatting and was out of the
confirmed scope ("classic .srt"). It is the obvious follow-up.

## Phase 5 — Final verification

```bash
pytest backend/tests -q      # 925 passed, 27 skipped
pytest mcp_server/tests -q   # 28 passed
npm run typecheck            # clean
```

Anti-pattern greps — each must return nothing:

```bash
grep -rn "words_per_group\|groups_for_render" backend/exporters/cue_split.py backend/exporters/srt_standard.py
```
```bash
grep -n "max_chars_per_line\|max_cps" backend/models/schemas.py | sed -n '/VideoRenderConfig/,$p'
```
```bash
git diff --stat backend/requirements.txt
```

Confirm untouched and still green:
- `backend/tests/test_caption_cfg_contract.py` (no `VideoRenderConfig` field added)
- `backend/tests/test_srt_word.py` (word-level exporter unchanged)
- the golden-frame and caption-parity suites (no renderer touched by this change)

Manual QA: export `srt_standard`, `vtt` and `ass` from a clip with long segments; open the
`.srt` in a player and in Premiere; verify sentence boundaries, ≤2 lines, and that
timestamps still land on the spoken words.
