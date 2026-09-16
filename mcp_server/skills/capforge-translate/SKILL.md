---
name: capforge-translate
description: "Add a translated caption track to the video open in CapForge: create the language tab, translate the captions sentence by sentence onto the source timing, shorten what wraps, and optionally translate the title, description and chapter titles for that language's upload package. Use when the user asks for captions, subtitles or a caption track in another language, to translate the captions, or for a Polish, German, Spanish (any language) version of the video's metadata."
---

# CapForge caption translation

A translated track is a second set of captions on the **same timing** as the original:
every translated caption keeps the span of the source words it was written from, so the
result stays locked to the audio and follows any later edit to the source. CapForge
stores and renders; you translate. The two halves of the job are the captions on the
track and, when the user wants it, the viewer-facing metadata under the record's
`localized` for the same language.

## Requirements

CapForge must be running **with its window open and the video on the results screen**:
tracks live in the app's session. Tools, all from the `capforge` MCP server:

- `get_ui_state()` for the screen and the track inventory; `open_video(video_id)` to
  open a library video.
- `create_track(lang, label=…)`, `set_track_text(track_id, entries)`,
  `get_track(track_id, stale_only=…)`, `reflow_track(track_id)`.
- `check_layout(t=0, track_id=…, scan=True)` and `render_frame(t, track_id=…)` for QA.
- `export(formats, track_id=…)` and `render(track_id=…)` to deliver.
- `get_video`, `set_video_meta`, `validate_video`, `get_upload_package` for the
  metadata half; `publish_guide("localized")` is the reference for it.

If the window is closed, say so and stop: nothing here works against a stored record
alone.

## 1. Open the video and read its tracks

`get_ui_state()`: `screen` must be `results`; otherwise `open_video(video_id)` a library
video (found with `list_videos()` or `search_library(q)`), or wait out `progress` with
`get_status()`.

Look at `tracks` before creating anything. **A track for the language already there is
resumed, never duplicated**: two Polish tabs render to the same `.pl.mp4` and the second
overwrites the first. Resume with `get_track(track_id, stale_only=True)` and fill what
it returns (section 4).

The source should be clean first. Every source word edited later marks the captions
built on it "source changed", so if the transcript still has misheard names, suggest the
capforge-cleanup skill before translating, or at least fix the names now.

## 2. Create the track

`create_track(lang)` with an ISO code ("pl", "de", "pt-BR"); `label` only when the user
wants a tab name other than the language's English name. It returns the new track's
groups, each with a group_id, the source text to translate and a `sentence` index,
and the app switches to the new tab, so from now on every tool without a track id
describes this track. Pass the track id explicitly anyway.

Refused when the transcript's words carry no ids yet (an older project that has not been
edited since it was opened): make any small edit in the app, or reopen the project, and
try again.

## 3. Translate by sentence, write by caption

Entries are caption-sized fragments; consecutive entries with the same `sentence` are
one sentence. **Translate the sentence, then distribute it across its fragments in
order.** A fragment translated alone ("And would you like" / "to give it a try?") reads
like a broken one, and word order differs between languages, so the split is yours to
choose. Keep each fragment roughly as long as the fragment it replaces and leave whole
phrases intact.

What stays the same across languages: names, product names, numbers, code, commands and
anything the speaker spelled out. Match the register the channel uses in that language
(`get_channel` for a channel whose `language` is the target one, if there is one);
formal "you" versus informal is a real choice, so ask when the channel gives no
answer. Do not translate what is on screen as a quotation of English UI text unless the
channel does.

Write with `set_track_text(track_id, entries)` in batches of thirty to fifty
`{"group_id", "text"}` entries. One unknown id rejects the whole batch and writes
nothing, so use the ids exactly as returned. The reply carries the track's counters:
`untranslatedCount` should reach 0, `staleCount` should stay 0.

## 4. Repairs: stale, untranslated, reflow

`get_track(track_id, stale_only=True)` lists what needs work. Each group has a `state`:

- **untranslated** — blank; write it.
- **stale** — the source words behind it changed after it was written. Read the
  sentence's other fragments too (an unfiltered `get_track`, or with `start`/`end`),
  re-translate from `sourceText`, and write the whole sentence's fragments again.
- **reflowNeeded** on the track — the source was re-chunked (groups merged, split, or
  words per group changed), so the captions no longer line up with the source at all.
  `reflow_track(track_id)` rebuilds the skeleton: captions whose source words are
  unchanged keep their text, the rest come back blank with `previousText` as your
  starting point, and **group ids change**, so use the ones it returns.

## 5. Check the layout, then look

`check_layout(t=0, track_id=…, scan=True)` measures every caption on the track and
returns the ones that wrap past two lines or run wider than the caption box. Polish and
German run ten to fifteen percent longer than English, so a caption spilling onto a
third line is the expected failure. Shorten those translations — same meaning, fewer
characters — write them again, re-scan, until the list is empty. The RSVP reading mode
reports nothing here, because a single sliding line cannot wrap.

Then `render_frame(t, track_id=…)` at two or three moments (a dense caption, a name,
the end) and look: contrast, a caption over a face, a word cut oddly. A language in a
non-Latin script may render in a fallback face, since the bundled fonts are Latin
display faces; `set_style({"fontName": "<a system font>"}, track_id=…)` fixes that
on this track alone. Style is per track, and a new track starts with a copy of the
source's.

The user can re-cut the translated captions in the app with *Words per group*, which
re-chunks each translated sentence without merging sentences; it never sets
`reflowNeeded`, so nothing of yours is lost by it.

## 6. Deliver

- Subtitle files: `export(["srt_standard", "vtt"], track_id=…)` writes
  `<name>.<lang>.srt` beside the video; srt_word and `ass` are the karaoke forms.
  It refuses a track with no captions yet.
- A captioned video: `render(track_id=…)` writes `<name>.<lang>.mp4` with the track's
  style. It blocks for minutes, so ask first, and run one language at a time: there is
  no batch mode.

## 7. The metadata half (optional, same language)

Only when the user wants the upload package in that language too, and only once the
record's source fields exist (`get_video`; if `description` is empty, the
capforge-publish skill comes first). Follow `publish_guide("localized")`:

- Translate **from the record's fields**, never from the package text, and keep the
  chapter titles aligned by index with the root chapters (times are never translated).
- `set_video_meta(video_id, {"localized": {"pl": {...}}}, rev)`, one language per
  call, with the `rev` you last read. A language you omit is kept; an object replaces
  that language whole, so send every field of it you want kept.
- `validate_video(video_id, lang="pl")`, fix the hard findings, then
  `get_upload_package(video_id, lang="pl")` and show the text; its NOTES name what is
  still in the source language (the footer always is).

The track's captions are useful wording to stay consistent with, not a substitute for
translating the fields.

## 8. Report

One short summary: the language and tab, captions written, captions still blank or
stale (ideally none), layout violations left (ideally none), which files were written,
and whether `localized` was filled for that language. Remind the user that a later
edit to the original marks the affected captions on the tab, and that this skill
repairs them from `get_track(stale_only=True)`.
