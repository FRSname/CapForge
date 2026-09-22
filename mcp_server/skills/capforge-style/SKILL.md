---
name: capforge-style
description: "Style the captions of the video open in CapForge: apply a preset or a look described in words, tune it for the format (a vertical Short, a talk, a tutorial), emphasise the numbers and names that matter, check nothing wraps or covers a face, and apply the same look across every video in a folder. Use when the user asks to style, restyle or theme the captions, to make them look like another video, to apply a preset, to emphasise or highlight words, or to give a whole event the same caption look."
---

# CapForge caption style

The look of the captions is a **style**: one flat set of settings the app shows in its
style sidebar, saved with the video, and shareable as a preset. This skill sets that
style from the outside, looks at the result, and fixes what the render would get wrong.
It works on the classic caption engine, the one the live preview draws; HyperFrames
caption styles are a different engine with their own tools and are not this skill.

## Requirements

CapForge must be running **with its window open and the video on the results screen**.
Tools, all from the `capforge` MCP server:

- `get_ui_state()` for the screen, the current `settings`, `appliedPreset` and the
  track inventory; `get_ui_state(include_groups=True)` adds the `groups` with their
  word indices, which only the emphasis step needs; `open_video(video_id)` to open
  a library video.
- `list_presets()` and `apply_preset(name, track_id=…)`.
- `set_style(patch, track_id=…)` for a tweak; `emphasize(edits)` for single words.
- `render_frame(t, track_id=…)` to see it; `check_layout(...)` to measure it.
- `find_moments(query)` and `find_semantic_moments(kind)` to pick the words to
  emphasise.
- `get_channel`, `get_collection`, `get_video`, `list_videos` for what the channel or
  folder expects; `render(track_id=…)` to write the video when asked.

If the window is closed, say so and stop.

## 1. Open the video

`get_ui_state()`: `screen` must be `results`; otherwise `open_video(video_id)` (found
with `list_videos()` or `search_library(q)`), or wait out `progress` with `get_status()`.
Never `load_video` to get a library video open: that re-transcribes it and resets its
style and groups.

Read `settings` and `appliedPreset` before changing anything, and say what is there.
A video the user already styled by hand is not restyled without a yes.

## 2. Decide the look

In order of preference:

1. **A named preset.** `list_presets()` returns the user's own presets (saved from the
   app's Presets menu, possibly with a custom font) and the built-ins (YouTube Bold,
   TikTok Pop, Minimal White, Highlight Pill, Karaoke Neon, Subtitles (Clean), Reveal
   Dark). A user preset with the channel's or event's name is almost always the
   answer.
2. **The channel or folder's house look.** `get_channel(channel_id)` `context.notes`
   and `get_collection(collection_id)` may say which preset the channel uses. When the
   user tells you a look is the house look and no note says so, offer to record it
   there ("Caption preset: UCK Bold") with `set_channel`, so the next run finds it.
3. **Like another video.** Ask the user to save that video's look as a preset in the
   app first (Presets → Save), then apply it by name. When they would rather you do
   it: `open_video` the other video, read `get_ui_state().settings` and
   `appliedPreset`, `open_video` the target again, and either `apply_preset` the
   named one or `set_style` with the settings you read. Say that you are switching the
   open video twice.
4. **Described in words.** Start from the closest built-in and tune it (section 3).
   A vertical video for Shorts, Reels or TikTok wants a large font, a narrow box and
   the text above the platform's controls; a talk wants a calm two-line caption near
   the bottom; a tutorial wants the highlight word style so the spoken word is
   followed.

`apply_preset(name)` blocks until the app confirms and answers `{"status": "ok"}`.
Anything else is not applied: read the hint, usually a name that matches nothing.
The preset is remembered as `appliedPreset` and survives later tweaks.

## 3. Tune with set_style

`set_style(patch)` takes camelCase keys from `get_ui_state().settings`. **Read the
current value and match its scale before writing** — the units are not uniform:

- percentages 0–100: `bgOpacity`, `maxWidth`, `posX`, `posY`, `animDuration`;
- fractions 0–1: `shadowOpacity`, `highlightOpacity` (writing 90 here by analogy is
  the classic mistake; the app reads it as 0.9);
- plain seconds: `gapCloseThreshold`, `lastGroupHold`;
- `bounceStrength` is a fraction of the font size with no ceiling, so 1.5 is legal;
- `readingMode` is `wrap` or `rsvp` (the Spritz speed-reading line), which is a
  layout, not a word style; `wordStyle` and `animationType` are the word looks.

Unknown keys are ignored and out-of-range numbers are clamped, so read
`get_ui_state()` again when the exact value matters. One patch with several keys is
fine. `wordsPerGroup` re-cuts the captions; on a translated track it re-cuts each
translated sentence and never merges two.

## 4. Emphasise the words that carry the point

Emphasis is sparse: a few words a minute, never a filler, never a whole sentence.
Candidates come from the transcript, not from taste alone:

- `find_semantic_moments("numbers")` — the figures a viewer should catch;
- `find_moments(query="<product or name>")` — the brand or the tool the video is about;
- `find_semantic_moments("cta")` — subscribe, link in bio;
- a line the user names.

Map each moment to `get_ui_state(include_groups=True).groups` (each group lists its
words, and a word is addressed by its index there)
and write `emphasize([{"group": g, "word": w, "overrides": {"font_size_scale": 1.3,
"active_word_color": "#…", "word_transition": "bounce"}}])`. Use the keys the tool
documents and nothing else; keep the colour within the style's palette. Emphasis
survives to the render and to the project file.

## 5. Look, then measure

Every style change is checked two ways before you call it done:

- `render_frame(t)` at three moments — the first caption, a dense one, one over the
  speaker's face — and look at contrast, the box over a face or a slide, a caption
  cut at the frame edge, the emphasised word. `composite=False` shows the overlay
  alone when the video frame confuses the read.
- `check_layout(t=0, scan=True)` measures every caption and returns the ones that
  wrap past two lines or run wider than the box. Fix them with a smaller font, a
  narrower or wider `maxWidth`, or fewer `wordsPerGroup`, then scan again. For a
  vertical video, `check_layout(t, platform="shorts")` (or `tiktok`, `reels`) adds the
  safe-zone advisory: text over the platform's controls is allowed but should be a
  choice.

Show the user one frame and say what you changed and why.

## 6. Tracks

Style is per language tab. A translated track starts with a copy of the source's
style, and `apply_preset`, `set_style`, `render_frame`, `check_layout` and `render` all
take a track_id from `get_ui_state().tracks`; without one they act on the tab the
app is showing, which changes when a track is created. Restyle each tab you mean to,
and scan each one: the same font that fits English wraps in German.

## 7. The same look across a folder

For an event or a series: `list_videos(collection="<id>")` (or the folder's members
from `get_collection`), then one video at a time:

1. `open_video(video_id)` — a record that was never saved from the app is skipped and
   named;
2. `apply_preset(name)` and confirm `ok`;
3. `check_layout(t=0, scan=True)`, fix what wraps with `set_style` on that video;
4. `render_frame` once, at a dense caption, and keep it for the summary;
5. `render()` only if the user asked for the files — it blocks for minutes, so run it
   here, one video at a time, and check `get_status()` is idle before opening the
   next.

Finish with one table: video, preset applied, wraps fixed, file written. Nothing is
restyled that the user styled by hand unless they said so for the whole folder.

## 8. Report

What the look is now (the preset, the tweaks by key), the words emphasised with their
timestamps, what the scan found and how it was fixed, and one frame. The style is
saved with the video by the app's autosave; suggest saving it as a preset from the
Presets menu when it is going to be reused.
