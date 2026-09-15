# Thumbnails

CapForge designs no thumbnail: it draws no text onto an image and scores none —
YouTube Studio's Test & Compare and the design tools own that. What the record holds
is **ideas as text**, so the user or a designer can build one, and **frames grabbed
from the video** to build it on, one of which can be marked the cover.

## The shape

```
thumbnail: {
  "ideas": [
    {"label": "Budget", "type": "face",
     "headline": "80% cheaper", "subtext": "one line of context",
     "visual_suggestion": "speaker mid-gesture, the number large, dark background",
     "recommended": true},
    …
  ],
  "candidates": ["<32 hex>.jpg", …],
  "cover": "<one of the candidates>" or null
}
```

- `label` — a two-word handle for the idea.
- `type` — what the frame is built around: `face`, `text`, `diagram`, `screen`,
  `object`.
- `headline` — at most 4 words, the thing the viewer reads at phone size. A number,
  a contrast, a promise the transcript keeps.
- `subtext` — one line, optional, the qualifier.
- `visual_suggestion` — one line a designer can act on.
- `recommended` — exactly one idea, the one you would ship. Zero or several is
  reported as a style finding (`thumbnail_recommended`).
- `candidates` — frame files on the record. **Only `grab_frames` adds one and only
  the user deletes one** (in the app); leave it out of a patch.
- `cover` — the candidate the user uploads, or null.

Two to five ideas. When pushed to Update-conf they become `youtubeThumbnailHooks`,
capped at five.

## What makes a headline

- It is on the transcript: the number the speaker gave, the claim they made.
- It reads in a glance: no clause, no punctuation beyond a question mark.
- It is not the title. The thumbnail and the title say two different things; the
  pair is the hook.

## Frames

`grab_frames(video_id, times)` grabs still JPEGs from the video at the given seconds
and appends them to `candidates`. Take the times from the transcript, never a guess:
`find_video_moments(video_id, query="<the line>")` for the moment an idea is about,
or a highlight's `start_s`. At most 8 times per call and 24 frames per record, every
time inside the video. A frame is at most 1280 px on its long edge (a vertical video
gives a vertical frame) and at most 2 MB, YouTube's limit.

It answers with the frame names, the times it could not use (each with a reason; the
rest still land) and the record's new `rev`.

## Choosing the cover

Set it with `set_video_meta`, using the `rev` that `grab_frames` returned (or a fresh
`get_video`): `{"thumbnail": {"cover": "<name>"}}`. Omit `candidates` (and `cover`) to
leave them unchanged, so `{"thumbnail": {"ideas": [...]}}` touches only the ideas.
`grab_frames` adds frames, and only an explicit changed `candidates` list is refused
(`candidates_managed`). A cover that is not one of the candidates is refused with
`cover_not_a_candidate`; `null` clears it.

The upload package prints the cover's file path under THUMBNAIL IDEAS, so the user
knows which file to upload. If the user deletes the cover frame in the app, the cover
is cleared with it.
