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

## Clip candidates — 2 or 3, self-contained

A candidate is a passage that works with no setup: a surprising number, a demo that
failed instructively, a quotable line, a question the speaker answers in one
breath. Each needs `start_s`, `end_s` and one line of `why`. Time them with
`find_video_moments(video_id, query="<the line>")` or `kind="numbers"` /
`kind="cta"`; the `end_s` is the end of the sentence that completes the thought,
which is usually one or two segments past the match. Keep them under 60 seconds.

## When the whole video is the Short

Under 60 seconds the video *is* the clip: write the caption, one description
paragraph, no chapters, and no clip candidates (or one that spans the whole thing).
Under 30 seconds there is nothing to chapter at all — say so instead of forcing it.
