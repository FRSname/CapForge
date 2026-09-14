# The publish loop

Six steps, one direction. Fields go onto the record; text comes out of it.

## 1. Requirements

CapForge must be running. The video either is open in the app or already has a
record in the library — both work, and the record is what you write to. Find it with
`get_video(video_id=…)`, `get_video(path=…)`, `list_videos(q=…)` or
`search_library(q)`. A video CapForge has never seen needs `load_video` (opens it
in the app and creates the record) or `transcribe` first.

If there is no record and no transcript, say so and stop. Do not write content from
a title alone.

## 2. Input

1. `get_video` — keep the `rev`. Fields already filled in, by an earlier run or by
   the user in the Publish workspace, are the starting point: show them and ask
   before replacing anything the user wrote (the record's `history` says who wrote
   what).
2. `get_brief` — binding unless the user overrides it here.
3. The transcript: `get_video_transcript(video_id)` from the library, or
   `get_transcript(segments_only=True)` for the open video. Ask for word-level
   timing only when you need it for a quote.
4. Candidates: `find_video_moments(video_id, kind="pause")` and
   `kind="speaker_change"` for chapters and highlights; `query=…` to time a specific
   line.
5. Ask for the published URL only if the user wants the Shorts caption to link to
   it; otherwise leave the placeholder and say so.

## 3. Write

One `set_video_meta(video_id, patch, rev)` per batch of fields. The shapes:

```
title              one line, at most 100 characters
title_options      3 angles: hook-led, search-friendly, a third; each at most 100
description        plain text, at most 5000 bytes, first 150 characters stand alone
short_description  one sentence, at most 200 characters
chapters           [{"start_s": 61.25, "title": "The budget problem"}]
tags               ["kubernetes", "cost control"]          (specific before broad)
hashtags           ["#Kubernetes", "#DevOps"]              (8–15, the brief's defaults first)
keywords           ["autoscaling", "spot instances"]
summary_md         markdown, for reuse elsewhere
highlights         [{"text": "…", "start_s": 61.25, "end_s": 74.0}]
quotes             [{"text": "verbatim", "start_s": 61.25, "end_s": 74.0}]
tools_mentioned    ["kubectl", "k9s"]                      (only what the speaker named)
links              [{"label": "Repo", "url": "https://…"}]
speakers           {"SPEAKER_00": {"name": "…", "handle": "@…", "url": "https://…"}}
shorts             {"caption": "…", "clip_suggestions": [{"start_s": …, "end_s": …, "why": "…"}]}
thumbnail          {"ideas": [{"label": "…", "type": "face", "headline": "≤4 words",
                               "subtext": "…", "visual_suggestion": "…", "recommended": true}]}
```

Plain text in every field — it is pasted into a form — except `summary_md`, which is
markdown by definition. No `<` or `>` anywhere.

## 4. Validate

`validate_video(video_id)` answers `{hard, style, ok}`. Fix every hard finding and
write again (a write that breaks one is refused, so a hard finding never sits
unnoticed). Fix style findings unless the user told you otherwise. Only `ok: true`
means the record is ready.

## 5. Present

`get_upload_package(video_id)` returns the rendered text plus any violations still
open. Show the text ready to copy and name what is left in `violations` instead of
hiding it. Tell the user the same package lives in CapForge's Publish workspace,
where every field is editable and "Copy upload package" copies the same text.

A file copy is optional: `write_workspace_file("notes/youtube.txt", text)` stores
it beside the video and `get_workspace` says where. The record, not the file, is
the source of truth; `read_workspace_file("notes/youtube.txt")` brings a snapshot
back, and the record wins wherever they differ.

## 6. Later

- When the user pastes the published URL: `mark_published(video_id, url)`. That is
  what moves the record to `published`; CapForge uploads nothing.
- A later run starts by reading the record again, not by regenerating. Fill the
  placeholder the user has now answered, or change the one field they asked about,
  and read the package again.

## Optional: push to Update-conf

Only when the user asks, and only if a conference-site MCP with
`set_session_enrichment` is connected. It is a mapping, not a copy:

```
description         → youtubeDescription
short_description   → youtubeShortDescription   (at most 200 characters)
highlights[].text   → highlights
links               → customLinks
thumbnail.ideas     → youtubeThumbnailHooks     (at most 5)
summary_md          → longDescriptionMd
publish.youtube.url → videoUrl
```

Then record the push on the record with `set_video_meta`: `external_refs` gains
`{"updateconf": {"sessionId": "…", "url": "…"}}` and `publish.pushes` gains
`{"target": "updateconf", "at": "<ISO time>", "fields": [...]}`. Read the record
first and send the whole `publish` object back.
