# Shorts

CapForge trims nothing and exports no clips — that is a locked decision. A Short is
**a caption and candidate timestamps**; the user cuts the clip elsewhere.

## The shape

```
shorts: {
  "caption": "one or two lines, the hook, then the claim",
  "clip_suggestions": [
    {"start_s": 61.25, "end_s": 95.0, "why": "the number that surprised the room"},
    …
  ]
}
```

## The caption

At most a few lines. The package appends `Full video:` with the published URL (or
the `[FULL VIDEO URL]` placeholder until `mark_published` has been called) and
`#Shorts`, so do not write those yourself. Plain text; the brief's voice.

The Shorts caption belongs to the video (`shorts.caption` at the root), and its link is
the primary channel's published URL. A TikTok or Instagram channel's post has its own
`caption` under `posts` (`publish_guide("channels")`). It may start from the Shorts
caption, but write it in that channel's voice after reading `get_channel`, and record
where it went live with `mark_published(video_id, url, channel=…)`.

## Clip candidates — 2 or 3, self-contained

A candidate is a passage that works with no setup: a surprising number, a demo that
failed instructively, a quotable line, a question the speaker answers in one
breath. Each needs `start_s`, `end_s` and one line of `why`. Time them with
`find_video_moments(video_id, query="<the line>")` or `kind="numbers"` /
`kind="cta"`; the `end_s` is the end of the sentence that completes the thought,
which is usually one or two segments past the match. Keep them under 60 seconds.

## What a clip is checked against

- **Hard — the write is refused:** a clip starts at 0 or later and before it ends
  (`clip_order`), and it does not end past the end of the video (`clip_past_end`).
  Fix the named clip and write again.
- **Style — advice:** a clip longer than 60 seconds (`shorts_clip_length`). YouTube
  allows longer Shorts; the guide does not.

The user edits the caption and the clips in the app's Shorts card, so read
`get_video` before writing and send the whole `shorts` block back: a patch replaces
it, and a clip you leave out is gone.

## When the whole video is the Short

Under 60 seconds the video *is* the clip: write the caption, one description
paragraph, no chapters, and no clip candidates (or one that spans the whole thing).
Under 30 seconds there is nothing to chapter at all — say so instead of forcing it.
