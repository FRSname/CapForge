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

- `get_ui_state()` for the screen, the style and the track inventory;
  `open_video(video_id)` to open a library video; `get_video(video_id)` for the record.
- `create_track(lang, label=…)`, `set_track_text(track_id, entries)`,
  `get_track(track_id, …)`, `reflow_track(track_id)`.
- `check_layout(t=0, track_id=…, scan=True)` and `render_frame(t, track_id=…)` for QA.
- `export(formats, track_id=…)` and `render(track_id=…)` to deliver.
- `set_video_meta`, `validate_video`, `get_upload_package` for the metadata half;
  `publish_guide("localized")` is the reference for it.

If the window is closed, say so and stop: nothing here works against a stored record
alone.

**A long video is the normal case, and it is a lot of text.** A fifteen-minute talk is
hundreds of captions. `create_track` and `get_track` therefore hand back one page at a
time (`groupCount` is the whole track, `nextOffset` is where to resume). Past roughly
200 captions, keep your own scratch file — one line per caption: offset, group id,
`sentence`, source text, and your translation as you write it — and translate from that
file rather than re-reading the track for every batch. It is also what you rebuild from
when a batch is refused.

## 1. Open the video, read what is there, ask once

`get_ui_state()`: `screen` must be `results`; otherwise `open_video(video_id)` a library
video (found with `list_videos()` or `search_library(q)`), or wait out `progress` with
`get_status()`.

Then read **both** halves before you offer anything:

- `tracks` — **a track for the language already there is resumed, never duplicated**:
  two Polish tabs render to the same `.pl.mp4` and the second overwrites the first.
  Resume with `get_track(track_id, stale_only=True)` and fill what it returns
  (section 6).
- `get_video(video_id)` — the record. If `description` is empty there is no metadata to
  translate, so do not offer that half; say the capforge-publish skill comes first.

**Ask your blocking questions in one message, not two.** There are usually exactly two:

1. **Scope** — captions only, or captions *and* the record's metadata in that language
   (offer the second only when the record has something to translate).
2. **Register** — formal or informal "you", where the language makes it a real choice
   and the channel does not answer it (`get_channel` for a channel whose `language` is
   the target one).

### The source should be clean first, and say what "first" costs

Every source word edited later marks the captions built on it "source changed". So
before you translate, count it: if the transcript still has misheard names or WhisperX
errors, tell the user how many captions a later cleanup would put back in your hands —
"there are about N captions; cleaning up afterwards will mark the ones covering those
fixes stale and I will re-translate them" — and **recommend doing the cleanup first**
(the capforge-cleanup skill). Proceed anyway if they say so; just do not present it as
a footnote.

## 2. Decide the caption size before you translate, not after

Look at `settings.wordsPerGroup` in `get_ui_state()`, and at how the source's captions
relate to its sentences (`create_track`'s reply pairs each caption with a `sentence`
index; so does `get_track`). Two shapes, two ways of working:

- **Sentence-sized captions** (one caption per sentence, or nearly) — translate whole
  sentences and write one entry per caption. No distribution, no splitting.
- **Sub-sentence fragments** (two to four words) — you must translate the sentence and
  then distribute it across its fragments (section 4). That is real work, and it is
  wasted if the caption size changes afterwards.

If the user would rather have sentence-sized captions, **change it before the track
exists**: a *Words per group* change on the source re-chunks the source, and a track
created from it inherits the new shape. Changing it afterwards re-cuts the translated
captions and throws your fragment splits away (section 5). Offer the choice here; it
costs nothing now and a re-translation later.

## 3. Create the track

`create_track(lang)` with an ISO code ("pl", "de", "pt-BR"); `label` only when the user
wants a tab name other than the language's English name. The app switches to the new
tab, so from now on every tool without a track id describes this track. Pass the track
id explicitly anyway.

The reply is the **first page** of the skeleton: `groupCount` captions in all, each
returned one with a group id, the source text to translate and a `sentence` index. Page
the rest with `get_track(track_id, offset=…)`, which returns the same shape. The new
track inherits the source's style and its `appliedPreset`, so a preset name you did not
choose is expected, not a symptom.

Refused when the transcript's words carry no ids yet (an older project that has not been
edited since it was opened): make any small edit in the app, or reopen the project, and
try again.

## 4. Translate by sentence

Consecutive entries with the same `sentence` are one sentence. When the captions are
fragments, **translate the sentence, then distribute it across its fragments in
order.** A fragment translated alone ("And would you like" / "to give it a try?") reads
like a broken one, and word order differs between languages, so the split is yours to
choose. Keep each fragment roughly as long as the fragment it replaces and leave whole
phrases intact.

What stays the same across languages: names, product names, numbers, code, commands and
anything the speaker spelled out. Match the register decided in section 1. Do not
translate what is on screen as a quotation of English UI text unless the channel does.

## 5. Write in batches — and watch `groupCount`

`set_track_text(track_id, entries)`, thirty to fifty `{"group_id", "text"}` entries at a
time. One unknown id rejects the whole batch and writes nothing. The reply carries
`groupCount`, `untranslatedCount` (should reach 0) and `staleCount` (should stay 0).

**Group ids are not stable for the life of the track, and nothing flags when they
change.** They are re-minted whenever the captions are re-cut — by `reflow_track`, and
also by a *Words per group* change on this tab, which re-chunks each sentence into new
ids. That second one sets neither `reflowNeeded` nor any staleness, because the
translations themselves survive it: only their names change. So:

- **Write from the ids of your most recent read.** Never carry ids from a page you read
  an hour and six batches ago as if they were still good.
- **`groupCount` moving between two batches is the news.** If it changes, the captions
  were re-cut under you: `get_track` again, rebuild your scratch file from the ids it
  returns, and carry your translations across by source text, not by id.
- **A refused batch is never retried verbatim.** The refusal says whether the ids were
  merely wrong or superseded; for superseded ids the repair is a re-read.

## 6. Repairs: stale, untranslated, reflow

`get_track(track_id, stale_only=True)` lists what needs work. Each group has a `state`:

- **untranslated** — blank; write it.
- **stale** — the source words behind it changed after it was written. Read the
  sentence's other fragments too (an unfiltered `get_track`, or with `start`/`end`),
  re-translate from `sourceText`, and write the whole sentence's fragments again.
- **reflowNeeded** on the track — the *source* was re-chunked, so the captions no longer
  line up with it at all. `reflow_track(track_id)` rebuilds the skeleton: captions whose
  source words are unchanged keep their text, the rest come back blank with
  `previousText` as your starting point, and **group ids change**, so use the ones it
  returns.

## 7. Check the layout — against the source, not against nothing

`check_layout(t=0, track_id=…, scan=True)` measures every caption on the track and
returns the ones that wrap past two lines or run wider than the caption box. Then run
the **same scan on the source track** and compare the two lists:

- A caption that overflows only in the translation is expansion — Polish and German run
  ten to fifteen percent longer than English. Shorten it: same meaning, fewer
  characters. Write it again, re-scan, until it is gone.
- A caption that overflows **in both** is not a translation problem. The speaker's
  sentence is simply too long for one caption, and compressing the translation only
  hides it while the English keeps overflowing. Name those, say the honest fix is to
  split the source caption (or narrow *Words per group* on the source, which means a
  reflow afterwards), and let the user decide. Do not silently squeeze meaning out of a
  translation to fit a 25-second run-on sentence.

The RSVP reading mode reports nothing here, because a single sliding line cannot wrap.

## 8. Look at frames, and re-check what is highlighted

`render_frame(t, track_id=…)` at two or three moments (a dense caption, a name, the end)
and look: contrast, a caption over a face, a word cut oddly. A language in a non-Latin
script may render in a fallback face, since the bundled fonts are Latin display faces;
`set_style({"fontName": "<a system font>"}, track_id=…)` fixes that on this track alone.
Style is per track, and a new track starts with a copy of the source's.

**Emphasis does not survive translation, and cannot.** A translated caption's word
timings are derived across the caption's span, so the word highlighted at any instant is
a *position*, not a meaning — the word the source emphasised is not the word this frame
lights up. Per-word styling from the source is not copied onto a new track either.
Check a frame mid-caption in a highlighting style; if the user wants emphasis on this
track, add it with `emphasize` while this tab is active (word indices from
`get_ui_state(include_groups=True)`), and otherwise say plainly that the highlight is
timing, not emphasis.

The user can re-cut the translated captions in the app with *Words per group*, which
re-chunks each translated sentence without merging sentences. Your translations survive
it — their group ids do not (section 5).

## 9. Deliver

- Subtitle files: `export(["srt_standard", "vtt"], track_id=…)` writes
  `<name>.<lang>.srt` beside the video; srt_word and `ass` are the karaoke forms.
  It refuses a track with no captions yet.
- A captioned video: `render(track_id=…)` writes `<name>.<lang>.mp4` with the track's
  style. It blocks for minutes, so ask first, and run one language at a time: there is
  no batch mode.

## 10. The metadata half (only if section 1 agreed it)

Follow `publish_guide("localized")`:

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

## 11. Report

One short summary: the language and tab, captions written out of how many, captions
still blank or stale (ideally none), layout violations left and which of them were the
source's fault, which files were written, and whether `localized` was filled for that
language. Remind the user that a later edit to the original marks the affected captions
on the tab, and that this skill repairs them from `get_track(stale_only=True)`.
