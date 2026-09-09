# Design brief: multiple caption tracks / language layers

**Status:** BRAINSTORM — decisions recorded. **Planned 2026-09-09** in
[multi-language-caption-tracks-plan.md](multi-language-caption-tracks-plan.md); where its
"Corrections to the brainstorm" section conflicts with this document, the plan wins (notably:
a typo fix *keeps* its `wid`, so staleness compares text too; "reflowed" became a track-level
flag; and `reflow_track` is a third new tool). This document remains the record of *why*.

**Provenance:** signatures cited as `file:line` were read from source during the
brainstorm. Everything else is asserted from `CLAUDE.md` and should be re-verified by
the planner before it is relied on.

---

## The workflow being built

1. Transcribe the video in its original language, as today.
2. Style it, tune group boundaries, prepare it for render.
3. Ask the agent (over MCP) to translate the captions to e.g. Polish.
4. The agent creates a new language tab with the translated captions.
5. Open that tab, adjust the style *for that language only*, render that version.

UI shape: tabs across the top. `Original` first, then one tab per added language, then
a `+` tab.

---

## The load-bearing insight

`buildRenderBody()` (`lib/render.ts`) is a choke point: it takes *(segments/groups +
StudioSettings)* and produces a render payload. If a language is just a named bundle of
`{ segments, groups, settings, font }`, then **none of the three caption renderers
change** — no Canvas/Pillow/GSAP parity work, no golden-frame churn, no touching
`docs/caption-parity.md`.

Keeping the entire feature *above the render boundary* is the property that makes it
cheap. **Any design change that pushes state below `buildRenderBody()` should be treated
as a red flag** and re-examined.

---

## Decisions

### D1 — Data model: track-shaped, language-flavoured

```
Project
  tracks: [
    { id, label: "Original", lang: "en", isSource: true,  segments, groups, settings, font }
    { id, label: "Polski",   lang: "pl", isSource: false, segments, groups, settings, font }
  ]
  activeTrackId
```

Type is neutral (`CaptionTrack`) and carries **both** `lang` and a free-text `label`.
The UI is language-flavoured: `+` opens a language picker, one click, which stamps
`lang`, derives `label`, selects the font fallback, and drives the export filename
(`video.pl.mp4`, `video.pl.srt`). Uniqueness on `lang` is a **UI-only** constraint, not
a model constraint.

*Rationale:* the bundle is identical whether you call it a language or a track, so
genericity costs nothing internally, while a language-first UI keeps the actual workflow
one click instead of a name/language/copy-from dialog. Style variants of the same
language (a TikTok cut vs. a YouTube cut) arrive later as **"Duplicate tab"** — a second
track with the same `lang` and a distinct label, disambiguated in filenames by label
slug. No migration needed to get there.

`Original` is a track like any other except: it owns the audio alignment, it is the
staleness reference for every other track, and it cannot be deleted.

### D2 — Translation unit: the **group**, not the segment

Word timings for a translated track cannot come from forced alignment — the audio is
still English, and the translation has a different word count and word order ("the red
car" → "czerwony samochód", 3 → 2, reordered). So the translated track **inherits the
source group's `start`/`end` verbatim** and word timings inside the group are derived
**proportionally by character count**.

This preserves CapForge's core invariant at the level that matters: captions still
appear and disappear exactly on the original audio.

**A real alternative was considered and rejected.** MCP is entirely segment/word-native
today, so translating per *segment* would need no new read tool at all —
`get_transcript(segments_only=True)` is already the right shape. It was rejected because
the workflow translates *after* the user has hand-tuned group boundaries; segment-unit
translation re-groups from scratch and throws that tuning away (different number of
caption cards, different beats). Group-unit inherits the tuned rhythm and swaps only the
words. It also bounds proportional-timing drift to ~1.5 s of text instead of a 5 s
segment.

**The price, stated plainly:** groups do not currently cross the MCP boundary at all.
This decision introduces them. That is the honest cost of D2 and the planner should not
be surprised by it.

**Accepted consequence:** everything word-level is *approximate* on a translated track —
karaoke highlight, per-word animation, and especially RSVP. Proportional-by-character is
a reasonable model (longer words get more time) but it will not be as tight as aligned
timing. Confirmed acceptable by the user.

### D3 — Derived word timings are **baked**, not computed on the fly

Bake them into the words at `set_track_text` time and mark them derived. Computing at
preview/render time would mean the user cannot drag a word on the timeline and cannot
see what they are getting. A manual drag flips that word to **pinned**; re-translating a
group recomputes the derived timings and leaves pinned ones alone.

### D4 — Text is copied; **timing stays linked**

Distinct signals, easy to conflate:

- **Text** is copy-on-create then independent. A re-group of the source must not reflow
  hand-tuned Polish line breaks.
- **Timing** stays linked to the source group by default. Dragging an English group
  200 ms later must move the Polish too — it is the same audio moment. The link breaks
  when the user drags the *Polish* group by hand.

This is the third appearance of the `endEdited` idiom ("derived until a human touches
it"). It should be implemented **once, consistently**, not as three near-identical
mechanisms.

### D5 — Undo stacks are **per-track**

`useSettingsUndo` currently wraps one global `setSettings`. With tabs, a global stack
means switching to the Polish tab and pressing Cmd+Z silently undoes something on the
English tab that is not on screen. Per-track stacks, `MAX_HISTORY = 50` each
(`lib/undoStack.ts`).

### D6 — Untranslated groups render **blank**

If the agent writes 100 of 190 groups and stops, silently falling back to source text
ships a video with English mixed into the Polish. Blank, plus an `untranslatedCount`
surfaced on the track, is honest and visible.

### D7 — The agent gets **no** `delete_track`

Closing a tab is one human click. The failure mode of an agent deleting forty minutes of
hand-tuned Polish is bad enough that the convenience is not worth it.

---

## Staleness model (three-way, per group)

**Reference:** each translated group records the ordered `wid` list it was translated
from. This is free — `lib/wordIds.ts` already mints and carries ids, and `retimeWords`
LCS-matches on *text*, so a corrected word does not match and receives a fresh `wid`.

Classify each source group by comparing its current wid set against the recorded sets:

| Condition | State | Repair |
|---|---|---|
| exact match | **clean** | — |
| no match, every wid already existed | **reflowed** | agent re-flow pass |
| no match, contains new wids | **stale** | re-translate that group |

Why three states and not one: changing `wordsPerGroup` on the English changes every wid
set, but the translated *text* is still perfectly good — only the chunking moved.
Marking 190 groups stale would be a lie. Under this scheme:

- a typo fix → exactly **1 stale**
- a re-group of the English → **~190 reflowed, 0 stale**
- a word insertion → **1 stale plus a tail of reflowed** (correct, and the reason this
  beats a per-track flag)

**Reflow is an agent pass, not a mechanical one.** Polish cannot be re-chunked to match
new English boundaries (different word counts and order — that is the entire premise of
D2). But it is cheap: hand the agent the new source groups *plus the existing Polish* as
context. It re-flows prose it already wrote rather than translating from scratch.

**Falls out correctly:** `/api/realign` carries wids through, so a forced-alignment pass
marks nothing stale and (per D4) drags the Polish timings along with it.

**Identity stays all-or-nothing**, matching `reconcileGroups`: if any source word lacks a
`wid`, mark the whole track reflow-needed rather than half-classifying.

**Legacy projects** need wids minted before a track can be created. `adoptWordIds`
retrofits them by text+timing on restore, so this is mostly automatic — but
`create_track` should *refuse* on a source it cannot identify rather than proceed.

---

## MCP surface

### Grounded current state (read from source)

| Tool | Signature | Location |
|---|---|---|
| `get_status` | `() -> dict` — straight passthrough to backend **job** state | `mcp_server/server.py:63` |
| `get_transcript` | `(segments_only: bool = False)` — segment-indexed, words by `(seg idx, word idx)` | `mcp_server/server.py:84` |
| `update_words` | `(edits: list[WordEdit])` | `mcp_server/server.py:128` |
| `export` | `(formats: list[str], output_dir: str = "output")` | `mcp_server/server.py:212` |
| `get_ui_state` | `() -> dict` | `mcp_server/server.py:220` |
| `set_style` | `(patch: dict)` | `mcp_server/server.py:259` |
| `render_frame` | `(t: float, composite: bool = True)` | `mcp_server/server.py:357` |
| `check_layout` | `(t: float, platform: str = "off")` | `mcp_server/server.py:384` |
| `render` | `(output_dir: str = "")` | `mcp_server/server.py:419` |

**Groups appear nowhere.** The entire agent surface is segment/word-native.

### Governing principle

**Every existing tool gains an optional `track_id` that defaults to the active track.**
`set_style`, `apply_preset`, `render`, `export`, `check_layout`, `render_frame`. Every
existing call keeps working unchanged on a single-track project — that is the whole
backward-compatibility story. Prefer extending existing tools over minting new ones; the
roster is already ~34 tools and each one costs context in every session.

### Genuinely new

- **`create_track(lang, label?, copy_style_from?, range?)`** → returns the new track id
  **and** the source group skeleton `[{id, start, end, text}]`. Fusing the read into
  creation makes create → translate → write two calls. Side effect: switches the visible
  tab (what the user expects). Refuses on a source without complete wids.
- **`set_track_text(track_id, entries: [{group_id, text}])`** → wholesale per-group
  replacement; derives and bakes word timings (D3), marks them derived.

  **This must not go through `update_words`.** That tool's contract is the LCS retiming
  in `lib/wordTiming.ts` for *correcting the source*, with `op: replace|delete|merge`.
  Translation is different semantics and forcing it through would be a mistake.
- **`get_track(track_id, stale_only=false, range?)`** → the staleness read. With
  `stale_only`, returns only changed groups carrying **both** current source text and the
  existing translation, so the agent re-translates in context. One call, deltas only.

### Placement

Track inventory (`tracks[]`, `activeTrackId`, per-track `staleCount` /
`untranslatedCount`) belongs on **`get_ui_state`**, not `get_status`. `get_status` is a
passthrough to backend job state (idle/transcribing/rendering) — hanging a track list
there is a category error. The active tab *is* UI state, and `PUT /api/ui-state` already
has the deliberately ungated renderer mirror (see `CLAUDE.md` → Communication).

### The gap that must be closed: `check_layout` scan mode

`check_layout(t, platform)` is **per-timestamp**. Checking a whole translated track for
overflow means one call per group — ~190 calls for a 5-minute video. That kills the
self-correction loop, which is the difference between this feature being pleasant and
being tedious.

It needs `check_layout(track_id=..., scan=true)` returning **only violations**:
`[{group_id, lines, overflow_px}]`. This matters because Polish runs ~10–15 % longer than
English (German worse) in the same time window and the same `maxWidth` box — three-line
captions where there were two is the expected daily annoyance, not an edge case.

**The loop belongs in the tool description**, so the agent runs it unprompted: translate
→ scan → shorten the overflowing groups → re-write → re-scan.

### Token budget

Per-group entries, words excluded:

| Video length | ~Groups | Read | Write back | Round trip |
|---|---|---|---|---|
| 5 min | ~190 | ~5 k | ~3 k | **~8 k** |
| 30 min | ~1,150 | ~32 k | ~18 k | **~50 k** |

The 30-minute case needs paging, hence the optional `range` (time span or group index
window) on `create_track` and `get_track`.

### Resulting workflow

*"translate the captions to Polish"* → `create_track("pl")` → translate →
`set_track_text` → `check_layout(scan=true)` → fix the two overflows → done. Four or five
calls, no babysitting; the user opens the tab to a styled track needing only a nudge.

---

## Non-goals (explicitly deferred)

- **RTL (Arabic, Hebrew).** Canvas and the HTML layer get bidi free from the browser;
  Pillow does not. Would need `python-bidi` + `arabic-reshaper` and a fresh three-way
  parity fight. Latin / Cyrillic / Greek first.
- **CJK line breaking.** No spaces means "words" are a fiction; both the grouping and the
  wrap logic assume space-delimited tokens.
- **Built-in translation API** (DeepL / Google). Agent-over-MCP is better quality, avoids
  key management, and allows "make it punchier, it is overflowing".
- **Bilingual / stacked display** (two languages on screen simultaneously). Natural
  extension, but it is a *render* feature — it breaks the "nothing below the render
  boundary changes" property that makes this design cheap. Separate project.
- **Agent-side track deletion** (D7).

---

## Open questions for the planner

1. **Tab UI placement.** Where the tab strip sits relative to the always-visible
   StudioPanel sidebar and the `file | progress | results` screen state in `App.tsx`.
2. **Per-language font fallback.** How `lang` selects a default font, and the interaction
   with `customFontPath` / the bundled-vs-user font distinction in
   `electron/preset-io.js`.
3. **Export filenames and batch render.** `video.pl.mp4` / `video.pl.srt`; whether
   `render` / `export` gain a `tracks: "all"` batch mode.
4. **`.cfproj` migration.** Existing single-track projects load as one `Original` track.
   Whether new multi-track files should remain openable by older builds (probably not
   worth it — decide explicitly).
5. **Preset interaction.** Presets are style-only and apply per-track; is an "apply to
   all tracks" affordance wanted?
6. **Where reflow/stale markers surface in the UI** — a count badge on the tab, plus a
   per-group marker in `GroupEditor`. Note the existing trap that popup wiring lives in
   *both* `ResultsScreen.tsx` and `GroupEditor.tsx`.
7. **Autosave / project size** with N tracks (`useAutosave`).

---

## Risks

- **Scope creep below the render boundary.** The moment a decision requires the three
  caption renderers to know about tracks, the cost profile of this feature changes
  completely. Re-read the load-bearing insight above before accepting such a change.
- **The `endEdited` idiom triplicating** (D4) into three subtly different
  derived-until-touched mechanisms.
- **Proportional timing quality on RSVP.** Accepted (D2), but worth an early visual check
  on a real translated clip rather than discovering it at the end.
