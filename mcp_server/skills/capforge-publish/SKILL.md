---
name: capforge-publish
description: "Turn a video CapForge knows about into a copy-ready YouTube upload package: title options, a description with chapters, tags, hashtags, a short description, a Shorts caption and clip candidates, thumbnail ideas. The text is written onto the video's library record, so it survives the session and the user can edit it in the Publish workspace. Use when the user asks for a YouTube description, title ideas, chapters, tags, a Shorts caption, or an upload package, including the post for each of the video's other channels (TikTok, Instagram, LinkedIn, X)."
---

# CapForge publish package

CapForge holds the word-level transcript of a video and a durable **record** for it:
the dossier every authored field lives in. This skill fills that record in, has
CapForge check it against YouTube's limits, and then reads back one plain-text
package the user pastes into YouTube Studio.

The direction matters: **fields are the source, the package is the rendering.** You
write structured fields; CapForge renders them. Never paste package text back into a
field.

Channel-level style — audience, voice, footer, default hashtags, house rules — lives
in the **brief**, not in this file. The user edits it in CapForge under
Settings → Channels; you read it with `get_brief()` (and only change it with
`set_brief(patch)` when the user states a channel-wide rule). The brief is the
primary channel's view; every channel, the primary included, is read in full with
`get_channel(channel_id)`.

## Requirements

CapForge must be running. The video either is **open in the app** or already has a
**record in the library** — both work, and the record is what you write to. All
tools come from the `capforge` MCP server.

- `get_video(video_id=…)` or `get_video(path=…)` for the record and its rev.
- `get_brief()` for the channel style contract.
- `get_transcript(segments_only=True)` when the video is the open session;
  `get_video_transcript(video_id)` when it is only in the library.
- `find_video_moments(video_id, kind=…)` for timestamps; `find_semantic_moments(kind)`
  and `find_moments(phrase)` do the same against the open session.
- `set_video_meta`, `validate_video`, `get_upload_package`, `mark_published`.
- `get_channel(channel_id)` for each channel the video has a post for (see Channels).

If you have no record and no transcript, say so and stop. Do not invent content from
a title alone. `list_videos()` and `search_library(q)` find the record when the user
names the video rather than a path.

## Input

1. Read the record: `get_video(...)`. Keep its rev — every write needs the one you
   last read. Fields already filled in (by an earlier run or by the user in the
   Publish workspace) are the starting point; show them and ask before replacing
   anything the user wrote.
2. `get_brief()`. Everything it states is binding unless the user overrides it here.
   If the record has a collection_id, read `get_collection(collection_id)` instead
   (see Collections, below).
3. The transcript: `get_transcript(segments_only=True)` for the open video, else
   `get_video_transcript(video_id)`. Ask for word-level timing only when you need it
   for a quote.
4. Chapter and highlight candidates: `find_video_moments(video_id, kind="pause")` and
   `kind="speaker_change"`. Use `find_moments` / `find_video_moments(query=…)` to time
   a specific line.
5. Ask for the published video URL only if the user wants the Shorts caption to link
   to it; otherwise leave the placeholder and say so.

## Collections (events)

A record with a collection_id belongs to an event or series that states its shared
boilerplate once: slots such as the event name or the sponsor, and overrides of the
brief's fields such as the footer and the recorded-at line.

- Read `get_collection(collection_id)` once per collection and follow its effective
  brief instead of `get_brief()`: the channel's brief with the event's overrides and
  slots applied.
- **Never paste boilerplate the template renders** (the recorded-at line, the sponsor
  footer, the feedback link, the hashtags, links and speaker blocks) into the
  description. Write only this video's paragraph; the package assembles the rest.
- An unknown {{slot}} in the package is a collection problem, not a record problem.
  Tell the user, or fix the collection with `set_collection`; never edit the video
  to hide it.
- When the event's boilerplate changes, it is one `set_collection` write, then
  re-read each member's `get_upload_package`. No description is rewritten.
- `publish_guide("collections")` covers setting up an event, the built-in slots and
  adopting orphan ids.

## Channels (one post per channel)

A video can go to more than one channel: a YouTube channel, a TikTok or Instagram
account, a LinkedIn page, an X account. `get_video` returns posts: the video's text per
channel, keyed by channel id. The root fields (description, short_description, tags,
hashtags, localized, publish.youtube) are the **primary channel's** post. When the
record has no posts, or only the primary channel's, follow the single YouTube flow in
the rest of this file: root fields, `get_brief()`, no channel argument anywhere.

For each channel the video has a post for, skipping posts with hidden: true:

1. Call `get_channel(channel_id)` first and treat its context as the style reference for
   that post: about, audience, voice, title style and example titles, naming, keywords,
   notes. Match the examples' shape; never reuse an example. Its profile (footer, links,
   default hashtags) is pasted by the package, so never copy it into the post.
2. Never write a post for a channel whose context you have not read in this session,
   and never carry one channel's voice into another channel's post.
3. Never pass include_recent_posts to get_channel unless the user asked you to take
   inspiration from older videos. By default each post is written from this video
   alone: old posts pull a draft toward a copy of them.
4. Write the post with `set_video_meta(video_id, {"posts": {"<channel id>": {...}}}, rev)`,
   using only the fields that platform has:

   ```
   YouTube            title, description, short_description, tags, hashtags, localized
   TikTok, Instagram  caption, hashtags
   LinkedIn, X        text, hashtags
   ```

   Posts merge per channel and per field: send only what you change, one channel per
   call is fine. A channel set to null removes its post; hidden: true hides it and keeps
   the text, so never do either unless the user asked. Never send a root field and the
   same field under the primary channel's post in one patch.
5. `validate_video(video_id, channel="<channel id>")`: fix every hard finding (they name
   posts.<channel id>.<field>) and write again.
6. `get_upload_package(video_id, channel="<channel id>")`: show each post's text under
   its channel's name. Pass channel alone, never together with platform.
7. When the user says where a post went live:
   `mark_published(video_id, url, channel="<channel id>")`.

## Hard rules

CapForge validates these — `validate_video(video_id)` names the field and the rule,
and a write that breaks one is refused. Breaking one makes the output wrong, not
merely different.

1. **Title** at most 100 characters; aim under 70 so it survives mobile truncation.
2. **Description** at most 5000 bytes. The first 150 characters appear before "more"
   and must work alone.
3. **No `<` or `>`** anywhere in title, description or tags.
4. **Tags** join into one comma-separated line of at most 500 characters.
5. **Chapters**: the first starts at 0, at least three, ascending, at least 10 seconds
   apart, all inside the video's duration. Times come from the transcript and are
   never invented. You write seconds; CapForge formats MM:SS and H:MM:SS.
6. **Every claim traces to the transcript.** Name only tools, numbers, people and
   promises the speaker actually said. No filler ("dive into", "unlock").
7. Plain text in every field. It gets pasted into a form, so no markdown — except the
   summary field, which is markdown by definition.
8. **Short videos.** Under 30 seconds there is no room for three chapters 10 seconds
   apart: write no chapters at all and say why. Under 60 seconds the video *is* the
   Short: one description paragraph, and the Shorts block carries only the caption
   (the whole video is the clip).
9. **Unknown speaker.** If nobody is named in the transcript and the brief carries no
   speaker, do not stop to ask. Leave the speaker's name empty on the record, tell
   the user it is open — CapForge prints `[SPEAKER NAME]` in the package and lists it
   under the open placeholders — and move on. When the user supplies the name later,
   write it and re-read the package.

## Write

One call per batch of fields: `set_video_meta(video_id, patch, rev)`. A patch replaces
whole fields (a list patch is the new list, not an append), and the rev must be the
one you just read — if the write comes back stale, re-read the record, re-apply and
write again. The user may be typing in the Publish workspace while you work.

The fields, with their exact shapes:

```
title              one line, at most 100 characters
title_options      3 angles: hook-led, search-friendly, a third; each at most 100
description        plain text, at most 5000 bytes, first 150 characters stand alone
short_description  one sentence, at most 200 characters, for cards and social
chapters           [{"start_s": 61.25, "title": "The budget problem"}]
tags               ["kubernetes", "cost control"]  (specific before broad)
hashtags           ["#Kubernetes", "#DevOps"]      (8 to 15, the brief's defaults first)
keywords           ["autoscaling", "spot instances"]  (the brief may set a count)
summary_md         a markdown summary for reuse elsewhere
highlights         [{"text": "What you'll learn line", "start_s": 61.25, "end_s": 74.0}]
quotes             [{"text": "verbatim line", "start_s": 61.25, "end_s": 74.0}]
tools_mentioned    ["kubectl", "k9s"]  (only what the speaker named)
links              [{"label": "Repo", "url": "https://example.com"}]
speakers           {"SPEAKER_00": {"name": "Ada Lovelace", "handle": "@ada", "url": "https://…"}}
shorts             {"caption": "…", "clip_suggestions": [{"start_s": 61.25, "end_s": 95.0, "why": "…"}]}
thumbnail          {"ideas": [{"label": "Budget", "type": "face", "headline": "≤4 words",
                               "subtext": "one line", "visual_suggestion": "one line",
                               "recommended": true}]}
```

In `thumbnail`, omit `candidates` (and `cover`) to leave them unchanged; `grab_frames`
adds frames and only an explicit changed list is refused.

Notes on the content, not the shape:

- The description's opening paragraph leads with the problem or the claim, never with
  "In this video". The second says what is actually shown, in order.
- Highlights are the "what you'll learn" lines — 4 to 6, each useful on its own, each
  carrying the time it is said.
- Chapter titles are at most 6 words. Do not pad to reach a count; six good chapters
  beat twelve thin ones. Candidates in order of preference: speaker changes, long
  pauses, a topic shift you can name, a number or demo the speaker announces. Snap
  each one to the start of the segment where the topic begins, and dry-run the list
  with `check_chapters(video_id, chapters)` before writing it.
- Clip candidates are 2 to 3 self-contained moments: a surprising number, a demo that
  failed instructively, a quotable line.
- Thumbnail ideas are text only; CapForge does not generate images.
- The speakers map is keyed by the diarized id in the transcript (SPEAKER_00, …).

## Validate

`validate_video(video_id)` after writing. It answers `{hard, style, ok}`:

- **hard** — YouTube's limits and the chapter rules. Fix every one and write again.
  CapForge refuses a write that breaks one, so a hard finding never sits unnoticed.
- **style** — the channel brief's house rules (no em dashes, a description length
  window, a keyword count, a hook in the first 150 characters). Fix them unless the
  user told you otherwise in this conversation; they never block a write.

Only `ok: true` means the record is ready to hand over. With more than one channel,
also run `validate_video(video_id, channel="<channel id>")` for every other channel's
post (see Channels).

## Present

1. `get_upload_package(video_id)` returns the rendered text plus any violations still
   open. Show the text in the conversation, ready to copy, and name anything left in
   `violations` instead of hiding it.
2. Tell the user the package also lives in CapForge's Publish workspace, where every
   field is editable and "Copy upload package" copies the same text.
3. A file copy is optional: if the user wants one,
   `write_workspace_file("notes/youtube.txt", text)` stores it beside the video, and
   `get_workspace()` tells them where that folder is. The record, not the file, is the
   source of truth.

## Later

- When the user pastes the published URL, call `mark_published(video_id, url)`. That
  is what moves the record to `published`; CapForge uploads nothing. That records the
  primary channel's post; for any other channel's post it is
  `mark_published(video_id, url, channel="<channel id>")`.
- A later run starts by reading the record again (`get_video`), not by regenerating.
  Fill the placeholder the user has now answered, or change the one field they asked
  about, and read the package again.
- If an earlier run saved the optional file, `read_workspace_file("notes/youtube.txt")`
  brings that copy back — but it is a snapshot: the record wins wherever they differ.

## Push to Update-conf (optional)

Only when the user asks, and only if a conference-site MCP with
set_session_enrichment is connected. Map the record onto its fields:

```
description                → youtubeDescription
short_description          → youtubeShortDescription   (at most 200 characters)
highlights[].text          → highlights
links                      → customLinks
thumbnail.ideas            → youtubeThumbnailHooks     (at most 5; label, type,
                             headline, subtext, visualSuggestion, recommended)
summary_md                 → longDescriptionMd
publish.youtube.url        → videoUrl
```

Then record the push on the record itself with `set_video_meta`, so the next session
knows it happened:

```
external_refs   {"updateconf": {"sessionId": "…", "url": "https://…"}}
publish         {"pushes": [{"target": "updateconf", "at": "2026-09-14T10:00:00Z",
                             "fields": ["youtubeDescription", "highlights"]}]}
```

Read the record first and send the whole `publish` object back — a patch replaces the
field, so a partial one would drop the YouTube block beside it.
