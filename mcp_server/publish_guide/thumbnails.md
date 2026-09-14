# Thumbnail ideas

CapForge generates no images and scores none — YouTube Studio's Test & Compare and
the thumbnail tools own that. What the record holds is **ideas as text**, so the
user or a designer can build one and the Update-conf push can carry them as hooks.

## The shape

```
thumbnail: {"ideas": [
  {"label": "Budget", "type": "face",
   "headline": "80% cheaper", "subtext": "one line of context",
   "visual_suggestion": "speaker mid-gesture, the number large, dark background",
   "recommended": true},
  …
]}
```

- `label` — a two-word handle for the idea.
- `type` — what the frame is built around: `face`, `text`, `diagram`, `screen`,
  `object`.
- `headline` — at most 4 words, the thing the viewer reads at phone size. A number,
  a contrast, a promise the transcript keeps.
- `subtext` — one line, optional, the qualifier.
- `visual_suggestion` — one line a designer can act on.
- `recommended` — exactly one idea, the one you would ship.

Two to five ideas. When pushed to Update-conf they become `youtubeThumbnailHooks`,
capped at five.

## What makes a headline

- It is on the transcript: the number the speaker gave, the claim they made.
- It reads in a glance: no clause, no punctuation beyond a question mark.
- It is not the title. The thumbnail and the title say two different things; the
  pair is the hook.

## Frame grabs

The user can grab frames in the app; a future deliverable adds a thumbnail strip.
Until then, `visual_suggestion` can name a timestamp — "the whiteboard at 12:40" —
found with `find_video_moments(video_id, query=…)`.
