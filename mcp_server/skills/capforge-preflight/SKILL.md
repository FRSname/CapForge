---
name: capforge-preflight
description: "Check a CapForge video before it is uploaded and report what would go wrong: the record's fields against YouTube's limits and the channel's house rules, the chapters, the cover frame, every channel's post, every translated language, leftovers in the transcript, and captions that wrap or went stale. A read-only checklist with one table and a fix for each line. Use when the user asks whether a video is ready to publish, for a preflight, a pre-upload check, a QA pass or a review of the upload package."
---

# CapForge publish preflight

A preflight **reads and reports**. It writes nothing to the record, the transcript or
the captions. Its product is one table the user can act on: what was checked, what it
found, and which action (or which skill) fixes it. Fixing is a separate ask, and each
fix has its own skill: capforge-publish for the record's text, capforge-cleanup for the
transcript, capforge-translate for a language track, capforge-style for the captions.

## Requirements

CapForge must be running. The record checks work with the window closed; the caption
checks need the video open on the results screen. Tools, all from the `capforge` MCP
server:

- `get_video(video_id=…)` or `get_video(path=…)`; `list_videos()` / `search_library(q)`
  to find it.
- `validate_video(video_id, lang=…, channel=…)`, `get_upload_package(video_id, …)`.
- `check_chapters(video_id, chapters)` to test a chapter list you would propose.
- `list_channels()`, `get_collection(collection_id)` for what the package pastes.
- `get_video_transcript(video_id)` for the stored transcript.
- `get_ui_state()`, `get_track(track_id)`, `check_layout(t=0, track_id=…, scan=True)`
  for the captions, when the video is open.

If there is no record for the video, say so and stop: there is nothing to preflight.

## 1. The record

`get_video(...)`. Read `status` first and say it: `imported` (no transcript yet),
`transcribed`, `captioned` (a render exists), `drafted` (a description exists),
`published`. A video below `drafted` has no package to check, so the report is short:
what is missing, and that capforge-publish writes it.

Then `validate_video(video_id)`:

- **hard** findings block the upload: YouTube's limits (title ≤ 100 characters,
  description ≤ 5000 bytes, tags ≤ 500 characters, no angle brackets) and the chapter
  rules (first at 0, at least three, ascending, 10 s apart, inside the video). CapForge
  refuses a write that breaks one, so a hard finding means a field was left in a bad
  state or the duration changed.
- **style** findings are the channel's house rules (no em dashes, a description
  length window, a keyword count, a hook in the first 150 characters). Report them as
  should-fix.

Beyond the validator, look at the fields yourself and report as notes:

- title_options empty, or the `title` still the file name.
- `chapters` empty on a video over a few minutes; `check_chapters` on a list you
  would propose only if the user asks for a suggestion.
- `thumbnail.cover` unset while `thumbnail.candidates` exist, or no candidates at
  all (the package prints the cover's path).
- `speakers` still keyed to diarized ids with no `name`.
- `shorts.clip_suggestions` present but the caption empty, or a clip over 60 s.
- `links` without https, `tags` fewer than a handful, `hashtags` missing the `#`.
- A collection_id: `get_collection(collection_id)` and check its slots are filled;
  an unfilled `{{slot}}` prints literally in every member's package and is reported
  by the package as unknown_slot.

## 2. The package, every channel, every language

`get_upload_package(video_id)` renders the primary channel's text with any open
findings in `violations`. Skim the text once as a reader would: does the first line
work before "more", is anything duplicated because a profile line was also pasted into
the description, is a placeholder like `[FULL VIDEO URL]` still there.

Then, for each channel in `list_channels()` that the record has a post for
(`get_video` → `posts`, skipping `hidden: true`): `validate_video(video_id,
channel="<id>")`, and `get_upload_package(video_id, channel="<id>")` for the pasted
text. A `<platform>_max_chars` finding means the text will not paste as it is.

For each language under `localized` (and each `languages` entry that has a caption
track but no localized fields): `validate_video(video_id, lang="pl")`; a language with
captions and no metadata is a note, not a failure.

## 3. The transcript

`get_video_transcript(video_id)` (segments only). This is the stored transcript, which
can lag the screen if the user is editing right now. Report, with a timestamp each:

- filler words left (um, uh, er) and obvious repeats ("the the");
- a diarized speaker id in the transcript that has no name under `speakers`;
- a name or product spelled two ways;
- anything bracketed or placeholder-like ("[inaudible]", "???").

These are leads for capforge-cleanup, not findings you fix here.

## 4. The captions (window open)

Only if `get_ui_state().screen` is `results` for this video. Skip the section and say
so otherwise; never open the video to run it unless the user asks.

- Every track in `tracks`: `staleCount`, `untranslatedCount`, `reflowNeeded`. Any
  non-zero is a should-fix for capforge-translate.
- `check_layout(t=0, track_id=…, scan=True)` per track: captions wrapping past two
  lines or wider than the box. Each reported group is a should-fix (a shorter
  translation on a translated track; a smaller font, a narrower box or fewer words per
  group on the source, which is capforge-style).
- For a vertical video meant for Shorts, Reels or TikTok,
  `check_layout(t, platform="shorts")` at two or three timestamps for the safe-zone
  advisory; text over the platform's controls is a note.

## 5. The report

One table, worst first:

```
Check                         Result          Fix
Title ≤ 100 chars             ok
Description hook              style           rewrite the first line (capforge-publish)
Chapters                      BLOCKS: 2 only  add one at 04:12 or 07:45 (pause candidates)
Cover                         missing         grab_frames at 01:03, then pick a cover
TikTok post                   BLOCKS: 2 340 > 2 200 chars   shorten the caption
Polish package                note            title and chapters still in English
Transcript                    3 leads         "kubernetes" ×4, "SPEAKER_01" unnamed
Captions (pl)                 2 wrap          groups t-3f9c:41, t-3f9c:88
```

Three levels only: **BLOCKS** (a hard finding: the upload or the paste fails),
**should fix** (a style rule or a stale caption), **note** (missing but optional).
Say plainly at the top whether the video is ready, and what the shortest path to ready
is. Timestamps as MM:SS.

## 6. After the report

Fix nothing unprompted. When the user picks a line, follow that line's skill and its
rules (a record write reads the rev first, a transcript write needs the window, a
translation is written by sentence), then run the affected check again and show the
new row. `mark_published` belongs to the moment the video is live and is not part of a
preflight.
