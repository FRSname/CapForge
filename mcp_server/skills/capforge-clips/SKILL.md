---
name: capforge-clips
description: "Find the moments of a CapForge video that stand on their own as Shorts, Reels or TikToks: rank the candidates, time each one to the transcript, write the Shorts caption and a post for every short-form channel, and hand the user the cut list. CapForge cuts nothing; the user trims the clip in their editor. Use when the user asks for clip ideas, Shorts candidates, the best moments, a highlight reel list, a TikTok or Reel from a video, or a Shorts caption."
---

# CapForge clip candidates

A **clip** here is a timestamped passage plus the text that goes with it. CapForge
trims nothing and exports no clips, and that is a decision, not a gap: the user cuts
the clip in their editor from the rendered video, where the captions are already
burned in. What this skill produces is the cut list and the copy, written onto the
video's library record so the Publish workspace shows it and it survives the session.

## Requirements

CapForge must be running; the window may be closed, because everything reads and
writes the record. Tools, all from the `capforge` MCP server:

- `get_video(video_id=…)` or `get_video(path=…)`; `list_videos()` / `search_library(q)`
  to find the video.
- `get_video_transcript(video_id)` for the stored transcript
  (`get_transcript(segments_only=True)` when the video is the open session).
- `find_video_moments(video_id, kind=…)` and `find_video_moments(video_id, query=…)`
  for timestamps (`find_semantic_moments(kind)` and `find_moments(query)` do the same
  against the open session).
- `set_video_meta(video_id, patch, rev)`, `validate_video(video_id, channel=…)`.
- `list_channels()`, `get_channel(channel_id)` for the short-form channels.
- `grab_frames(video_id, times)` for a cover frame per clip, when asked.
- `publish_guide("shorts")` is the reference for the `shorts` field.

No record or no transcript: say so and stop. Nothing here is written from a title
alone.

## 1. Read what exists

`get_video(...)` and keep its `rev`. If `shorts` already has a caption or clips, show
them and ask before replacing: the patch replaces the whole `shorts` block, and a clip
you leave out is gone. Read `duration` too. Under 60 seconds the video **is** the
clip: write the caption and stop at one candidate spanning the whole thing, or none.

Then the transcript, segments only. Read it end to end once; the candidates come from
reading, and the tools below only time them.

## 2. Hunt for candidates

A clip works with **no setup**: the viewer lands in the middle of the video and still
gets it. Read for:

- a surprising number or a claim with a figure — `find_video_moments(video_id,
  kind="numbers")` lists every spoken figure;
- a demo, especially one that fails instructively;
- a quotable line, a question the speaker answers in one breath;
- a disagreement or a change of speaker that sets up a punchline —
  `kind="speaker_change"`;
- a call to action worth its own clip — `kind="cta"`.

Shortlist five to eight, then rank them by: does the first three seconds hook, is the
idea complete without the rest of the talk, is there a payoff at the end, is something
happening on screen. Keep the top three to five for the user, and say why each one
made the list in one line. Two or three of them will end up on the record.

## 3. Time each clip from the transcript

Never estimate. For each candidate:

- `find_video_moments(video_id, query="<the first words of the clip>")` gives the
  start; move it to the start of the segment (the sentence) that begins the thought.
- The end is the end of the segment that completes the thought, usually one or two
  segments past the payoff line. Leave the speaker room to finish the word.
- Aim for 20 to 60 seconds. Over 60 is a style finding (shorts_clip_length); YouTube
  allows it, the guide does not, and a Reel or TikTok is usually better under 45.
- Every clip must start at 0 or later, end after it starts and end inside the video;
  those three are hard and the write is refused otherwise.

## 4. Write the record

One `set_video_meta(video_id, {"shorts": {...}}, rev)` with the whole block:

```
shorts: {
  "caption": "the hook, then the claim — one or two lines",
  "clip_suggestions": [
    {"start_s": 61.25, "end_s": 95.0, "why": "the number that surprised the room"},
    …
  ]
}
```

The caption is the Shorts caption for the primary channel's video: plain text in the
brief's voice, no URL and no `#Shorts`, because the package appends `Full video:` with
the published URL (or a placeholder until `mark_published`) and the hashtag itself. A
stale rev is answered with the current record; re-read, re-apply, write again. Then
`validate_video(video_id)` and fix anything hard.

## 5. A post per short-form channel

`list_channels()`. For each TikTok or Instagram channel the user publishes to (and X or
LinkedIn when they want the clip there), `get_channel(channel_id)` first — never write
for a channel whose context you have not read — and write that channel's post in its
own voice, from this clip:

- TikTok and Instagram: `caption` and `hashtags`;
- X and LinkedIn: `text` and `hashtags`.

`set_video_meta(video_id, {"posts": {"<channel id>": {"caption": "…", "hashtags":
[…]}}}, rev)` merges per field and leaves the other channels alone; skip a post with
`hidden: true`. The channel's `profile.default_hashtags` are pasted by the package, so
do not repeat them. `validate_video(video_id, channel="<id>")` for each one: a
`<platform>_max_chars` finding means the text will not paste as it is.

Recent posts of a channel are read only when the user asks to take inspiration from
older videos (`include_recent_posts=True`).

## 6. A cover per clip (optional)

When the user wants thumbnail frames for the clips: `grab_frames(video_id, [start_s
of each clip, or the moment its idea is on screen])`, at most eight per call. The
frames join `thumbnail.candidates` and the answer carries a new `rev`. Choosing a
cover is `set_video_meta` with `{"thumbnail": {"cover": "<name>"}}` and that rev,
omitting `candidates`; a clip's cover is only chosen when the user picks one.

## 7. Hand over the cut list

The user cuts the clips, so give them the list in the form an editor needs:

```
#  Start     End       Length  Hook line                         Why
1  01:01.2   01:35.0   34 s    "We lost 40% of our traffic..."   the number
2  07:45.5   08:20.0   35 s    "Watch what happens when..."      the failed demo
```

Say that the captions are already in the rendered video, that the Shorts caption and
the channel posts are in the Publish workspace, and that the full-video link joins the
caption once the video is published. When a clip goes live, `mark_published(video_id,
url, channel="<id>")` records where.
