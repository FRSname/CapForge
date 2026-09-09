# Plan: CapForge v2.6.0 Changelog

## Goal

Add a new `## CapForge v2.6.0` section at the top of `CHANGELOG.md` — the first
`##` heading in the file, above `## CapForge v2.5.0` — matching the existing
house style: bold feature name on its own line, one prose paragraph, grouped under
`### New Features` / `### Fixes` / `### Internal`. No bullet lists, no code blocks,
no commit hashes inside an entry.

Also add a **persistent tutorial-video link** near the top of the file, so readers
of any release entry can find it. It is a file-level header line, not part of the
v2.6.0 entry — future releases get prepended *below* it and it stays put.

`package.json` is **already** at `2.6.0` (bumped in `3c306ee`, 2026-09-02), so this
task is **changelog-only** — unlike `docs/plans/changelog-v2.4.0.md`, there is no
version bump to perform. Do not re-bump.

## Phase 0: Source of Truth (gathered 2026-09-06 — verify, don't re-derive)

### The coverage boundary is NOT the `v2.5.0` tag

`git log v2.5.0..HEAD` returns 36 commits, but the tag `v2.5.0` sits at
`1042d40` (2026-08-07) while the **v2.5.0 changelog section was written later**, in
`3b4f166` (2026-08-10, the last commit that touched `CHANGELOG.md`). So the tag
range over-reports.

**First task of the executor**: confirm the real boundary by reading the v2.5.0
section (`sed -n '3,36p' CHANGELOG.md`) and checking which of the four 2026-07-29
commits it already covers. Current reading: it covers per-word background boxes,
agent batch control, word-timing locality, group identity, settings sanitization,
the merge-words stale-bounds fix, and the NUL-sentinel internal note — and does
**not** mention favorite fonts, dot-prefixed font families, words-per-group, or
restored-project rendering. If that holds, those four are v2.6.0 material.

### Candidate commits, chronological

| Commit | Date | Theme | Verdict |
|---|---|---|---|
| `38065e7` | 07-29 | exclude private dot-prefixed font families from system font list | Fix (confirm not in v2.5.0) |
| `9465b2a` | 07-29 | favorite fonts pinned to top of font picker | Feature (confirm not in v2.5.0) |
| `c729282` | 07-29 | presets no longer override words-per-group | Fix (confirm not in v2.5.0) |
| `3b301ac` | 07-29 | restored projects render again (settings defaults merge, NaN guard) | Fix (confirm not in v2.5.0) |
| `b4381b2` | 08-10 | merge commit | omit |
| `16024dc`, `3b4f166` | 08-10 | 409 field-named errors, settings sanitization | **already in v2.5.0** — omit |
| `bcff35d`, `950f076`, `3578991`, `411242f`, `69c2aa2`, `8a1858d` | 08-10/11 | caption gap closing | Feature |
| `7ffb271`…`6acec46` (13 commits) | 08-11/12 | RSVP speed-reading mode + reels | Feature (headline) |
| `b037ef3` | 09-01 | split SRT/VTT exports into readable subtitle cues | Fix |
| `931e2cf` | 09-02 | choose the Whisper model at install time and in Settings | Feature |
| `fc22032` | 09-02 | recommend Large Turbo everywhere, stop bypassing the VRAM ladder | Fix |
| `7c8828f`, `7ad96aa`, `22dee9d` | 09-04/06 | gradient text + background colours, picker portal, slider-driven editor | Feature |
| `b3c58d8`, `0305bb9`, `6330f0e`, `d0bedc9`, `04895ec`, `3c306ee` | — | plan docs, CLAUDE.md restructure, version bump | omit (not user-facing) |
| `2c8bcfc` | 09-01 | README tutorial video link | omit as a *changelog entry* — but its URL is the source for the header line (Phase 2, step 1) |

### Plan docs to read for exact behaviour — do not re-derive from diffs

- `docs/plans/rsvp-speed-reading-mode.md` and `docs/plans/rsvp-continuous-flow.md`
- `docs/plans/caption-gap-closing.md` (see also `fill-gaps-bake-and-editable-end.md`)
- `docs/plans/srt-cue-segmentation.md`
- `docs/plans/selectable-whisper-model.md`
- `docs/plans/gradient-colors.md`
- `docs/plans/font-list-preset-restore-fixes.md` (covers the four 07-29 commits)

`CLAUDE.md` also carries authoritative prose on RSVP (reading mode, reels, the
`gapCloseThreshold` relationship) and on gap closing — cross-check claims there.

### The tutorial link

Already live in `README.md:5`, added by `2c8bcfc`:

```
▶ **[Watch the tutorial — how to use CapForge](https://www.youtube.com/watch?v=7xxLt5FEq1E)**
```

Copy that line verbatim — same glyph, same bolding, same link text — so the two
files agree. Re-read `README.md:5` at execution time in case the URL has changed;
do not type the video id from this plan without checking it.

### Style reference

Read `CHANGELOG.md` lines 3–36 (the v2.5.0 entry) before writing. Note its opening:
v2.5.0 begins with a one-sentence framing line under the `##` heading before the
first `###`. v2.4.0 and v2.3.0 do not. **v2.6.0 should have one** — the release has
a clear theme (new ways to read and colour captions) and the framing line is the
newest convention.

Tone: end-user, second person is used sparingly ("your edits", "you don't touch"),
present tense, name the symptom before the fix.

## Phase 1: Draft the entries

Every claim must trace to a commit or a plan doc from Phase 0. Draft in a scratch
file first; do not edit `CHANGELOG.md` until Phase 2.

### `### New Features`

1. **RSVP speed-reading captions** — headline item, lead with it.
   Sources: `docs/plans/rsvp-speed-reading-mode.md`, `rsvp-continuous-flow.md`,
   `CLAUDE.md` "two layout modes".
   Content: a new reading mode that shows one unwrapped line sliding so the active
   word's focus letter stays pinned to a fixed column (Spritz-style), with an
   optional reticle, context dimming, edge fade and a configurable pivot. Say that
   consecutive captions with no blank frame between them flow through as one
   continuous line rather than snapping back. Say it renders identically in the
   preview, the classic export and the HyperFrames engine.
   Guard: it is a *layout* mode, not a word animation — do not describe it as a new
   word style/transition, and do not imply it can be set per word.

2. **Caption gap closing** — automatic, with two settings.
   Sources: `docs/plans/caption-gap-closing.md`, `950f076`, `411242f`, `3578991`.
   Content: short gaps between captions are closed automatically so captions don't
   flicker off between phrases; a threshold setting controls how large a gap still
   gets closed, and a final-caption hold controls how long the last caption stays.
   Ends you set by hand are left alone. Applies to preview and render alike.

3. **Choose your Whisper model** — install time and Settings.
   Sources: `931e2cf`, `docs/plans/selectable-whisper-model.md`.
   Content: pick the transcription model during first-launch setup and change it
   later in Settings, instead of being locked to one download.

4. **Gradient caption colours**
   Sources: `7c8828f`, `22dee9d`, `7ad96aa`, `docs/plans/gradient-colors.md`.
   Content: text colour and background colour accept a linear gradient, edited with
   sliders (angle/stops). Confirm from the plan doc which of text/background/both
   ship, and whether per-word overrides participate, before asserting either.

5. **Favorite fonts** (only if Phase 0 confirms it is not already in v2.5.0)
   Source: `9465b2a`. Content: star a font to pin it to the top of the picker.

### `### Fixes`

6. **SRT and VTT exports are readable subtitle cues**
   Source: `b037ef3`, `docs/plans/srt-cue-segmentation.md`, `backend/exporters/cue_split.py`.
   Content: exported `.srt`/`.vtt` used to emit whole transcription segments as one
   cue — long walls of text with the wrong timings for a subtitle track. Cues are now
   split to a readable length. Guard: check whether the ASS exporter was also fixed;
   the memory index says it was **not** — do not claim it.

7. **Model recommendations no longer bypass the VRAM ladder**
   Source: `fc22032`. Content: the app recommends Large Turbo consistently and the
   recommendation now respects the available-VRAM tiering instead of skipping it.
   Read the diff for the exact user-visible symptom before writing.

8. **Colour picker no longer clipped by the studio card**
   Source: `7ad96aa`. Content: the picker popover is now portalled out of the card,
   so it isn't cut off. Keep to one sentence; consider folding into entry 4 only if
   it reads as part of the same feature — but see the anti-pattern note below.

9. **Restored projects render again** (if not already in v2.5.0)
   Source: `3b301ac`, `docs/plans/font-list-preset-restore-fixes.md`.

10. **Presets no longer override words-per-group** (if not already in v2.5.0)
    Source: `c729282`. Content: applying a preset kept your grouping instead of
    silently resetting it.

11. **Private system fonts hidden from the picker** (if not already in v2.5.0)
    Source: `38065e7`.

### `### Internal`

Keep it to the items that carry real signal, in the style of v2.5.0's Internal
section (it explains *why* a reader should care, not just what changed):
- The RSVP core is triplicated across Python, TypeScript and the embedded runtime
  and pinned against shared JSON fixtures, plus a Canvas↔Pillow numeric fixture —
  the three renderers can't drift.
- The reel cull and per-reel layout cache exist for speed (measuring 900 words per
  frame: 140ms → 9.7ms) and are pixel-neutral.
Skip anything you can't source.

## Phase 2: Write the edit

1. Insert the tutorial link as its own line under `# Changelog`, separated by blank
   lines, copied verbatim from `README.md:5`. Resulting head of file:

   ```
   # Changelog

   ▶ **[Watch the tutorial — how to use CapForge](https://www.youtube.com/watch?v=7xxLt5FEq1E)**

   ## CapForge v2.6.0
   ```

   It sits **above** the first `##` heading, so it is not owned by any release and
   survives every future prepend.
2. Insert the new `## CapForge v2.6.0` section below that line and above the
   existing `## CapForge v2.5.0` heading. Nothing else in the file changes.
3. Section order: `### New Features`, `### Fixes`, `### Internal` — matching v2.5.0.
4. Within New Features, order by user visibility: RSVP, gap closing, Whisper model
   choice, gradients, favorite fonts.
5. Do **not** touch `package.json` — it is already `2.6.0`.
6. Do **not** create the `v2.6.0` git tag; tagging is a release step, not part of
   writing the changelog.

## Phase 3: Verification

- [ ] `sed -n '1,10p' CHANGELOG.md` shows `# Changelog`, then the tutorial link line,
      then `## CapForge v2.6.0`.
- [ ] The tutorial line is byte-identical to `README.md:5`
      (`diff <(sed -n '5p' README.md) <(sed -n '3p' CHANGELOG.md)` — adjust the
      CHANGELOG line number to wherever it actually landed).
- [ ] The link is above the first `##` heading, not inside the v2.6.0 section:
      `awk '/^## /{exit} /youtube/{print NR}' CHANGELOG.md` prints a line number.
- [ ] The URL resolves — open it, or at minimum confirm the video id matches the
      README's. A dead tutorial link at the top of the changelog is worse than none.
- [ ] `git diff CHANGELOG.md` is a pure insertion — zero deletions, no reflow of the
      v2.5.0 entry or anything older.
- [ ] Every bold entry traces to a commit hash or plan doc in the Phase 0 table.
      Re-read the list and name the source for each; drop any entry you cannot source.
- [ ] No duplication with v2.5.0: grep the v2.5.0 section for each v2.6.0 headline
      noun (`font`, `preset`, `sanitiz`, `words-per-group`, `restore`) and confirm
      nothing is described twice.
- [ ] Format matches: bold headline line, single paragraph, no bullets inside an
      entry, no code blocks, no hashes, no PR numbers.
- [ ] `grep -n '"version"' package.json` still reads `2.6.0` and was not modified.
- [ ] The RSVP paragraph does not describe RSVP as a word transition or a per-word
      setting (grep the new section for "word style" / "per-word" near "RSVP").
- [ ] Omitted commits are deliberately omitted: the seven docs/merge/version-bump
      commits listed in Phase 0 carry no user-facing change.

## Anti-patterns to avoid

- **Do not use `git log v2.5.0..HEAD` as the scope.** The tag predates the v2.5.0
  changelog write by three days; four commits in that range are already documented.
  The boundary is "what the v2.5.0 section already describes", not the tag.
- **Do not bump `package.json`.** It was bumped in `3c306ee` before the last three
  feature commits landed. Bumping again produces `2.7.0` for a `2.6.0` changelog.
- **Do not fold the colour-picker portal fix into the gradient feature paragraph**
  unless the diff shows the popover was clipped *only because of* the gradient
  editor. `7ad96aa` reads as a pre-existing layout bug the gradient editor exposed —
  check before merging them, and keep them separate if in doubt (same rule the
  v2.4.0 plan applied to the font picker and its later interaction fix).
- **Do not claim ASS export was fixed** by the cue-splitting change unless
  `backend/exporters/` shows it. The known state is SRT/VTT only.
- **Do not claim RSVP honours every style setting.** `docs/caption-parity.md`
  documents which settings RSVP ignores — either stay silent on that or state it
  accurately.
- **Do not put the tutorial link inside the v2.6.0 section.** It is not a v2.6.0
  change — the video predates the release and applies to every entry. Nested under
  `## CapForge v2.6.0` it would scroll out of sight the moment v2.7.0 is prepended.
- **Do not restyle it** into a badge, an image thumbnail, or an HTML `<a>`. Match
  `README.md:5` exactly; the two files should read as one voice.
- **Do not invent a release theme the commits don't support.** The framing sentence
  must summarize what actually shipped, not aspiration.
