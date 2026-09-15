# CapForge publish guide — for the agent

You are driving a **running CapForge app** over MCP. CapForge holds the word-level
transcript of every video it has seen and a durable **record** for each one: the
dossier every authored publish field lives in. Your job is the text; CapForge's job is
timing, structure, validation, storage and review. You write structured fields onto
the record, CapForge checks them against YouTube's limits and the channel's rules,
and renders one plain-text package the user pastes into YouTube Studio.

## Operating model (read this first)

- **The record is the source; the package is a rendering.** Write fields with
  `set_video_meta`; read the text back with `get_upload_package`. Never paste package
  text into a field — you would be storing the record inside itself.
- **The brief is binding.** `get_brief` returns the channel's audience, voice, footer,
  default hashtags and house rules. Everything it states holds unless the user
  overrides it in the conversation. Change it only with `set_brief`, and only when
  the user states a channel-wide rule. A video whose record has a `collection_id`
  follows that collection's `effective_brief` from `get_collection` instead: the
  channel brief with the event's overrides and slots applied. The brief is the
  **primary channel's** view; `get_channel` shows that channel's full context.
- **Every write carries a rev.** `get_video` returns the record and its `rev`;
  `set_video_meta(video_id, patch, rev)` needs the one you last read. A stale rev
  comes back with the current record — re-read, re-apply, write again. The user may
  be typing in the Publish workspace while you work; the field under their cursor
  wins.
- **A patch replaces whole fields.** A list is the new list, not an append; the
  `publish` block must be sent whole or its YouTube half is dropped. The one
  exception is `localized`, which merges per language.
- **Hard rules are refused, style rules are advice.** A write that breaks a YouTube
  limit never lands; `validate_video` names the field and the rule. A house-rule
  finding is fixed unless the user said otherwise, and never blocks a write.
- **Never invent.** Every claim, number, tool, person and timestamp traces to the
  transcript. `find_video_moments` gives you the time a line is said; `get_video`
  with no record and no transcript means stop and say so.
- **One video per call.** A batch is you looping, each step visible in the app.
- **CapForge uploads nothing, cuts nothing, draws nothing.** `mark_published`
  records the URL the user pasted; Shorts are candidate timestamps; thumbnails are
  text ideas plus frames grabbed from the video.

## Where things are

| need | tool |
|---|---|
| the record + rev | `get_video(video_id=…)` or `get_video(path=…)`; `list_videos`, `search_library` to find it |
| the channel rules | `get_brief`; `get_collection(collection_id)` for a video in a collection |
| an event's shared boilerplate | `list_collections`, `set_collection`, `delete_collection` |
| a channel and how it writes | `get_channel` (read it before drafting for that channel); `list_channels`, `set_channel`, `delete_channel` |
| the transcript | `get_video_transcript(video_id)` from the library; `get_transcript(segments_only=True)` when the video is open in the app |
| timestamps | `find_video_moments(video_id, query=…)` or `kind="pause" \| "speaker_change" \| "numbers" \| "cta"`; `find_moments`, `find_semantic_moments` against the open session |
| write | `set_video_meta(video_id, patch, rev)` |
| check | `validate_video(video_id)`, or `validate_video(video_id, lang="pl")` for one language; `check_chapters(video_id, chapters)` before a chapter list |
| a thumbnail frame | `grab_frames(video_id, times)`; the cover is then set with `set_video_meta` |
| the text | `get_upload_package(video_id)`, or `get_upload_package(video_id, lang="pl")` |
| after upload | `mark_published(video_id, url)` |

## Topics — pull one at a time with `publish_guide(topic)`

| id | what it covers |
|---|---|
| `workflow` | The loop end to end: input, write, validate, present, later runs, the optional file and the optional Update-conf push. Start here. |
| `breakdown` | `summary_md`, timed `highlights` and `quotes`, `tools_mentioned`, `speakers` — the fields every other topic draws on. |
| `description` | `title`, `title_options`, `description`, `short_description`, `tags`, `hashtags`, `keywords`: the limits and the house rules. |
| `chapters` | Chapters as seconds from real moments: the hard rules, the candidates, the dry run, the short-video exception. |
| `thumbnails` | Thumbnail ideas as text; what a good headline is; frames and the cover; CapForge draws no images. |
| `shorts` | The Shorts caption and 2–3 clip candidates; the under-60-seconds rule; what a clip is checked against. |
| `batch` | A set of videos: list by status, one record per call, what to report, scratch runs. |
| `collections` | An event's shared boilerplate: slots, brief overrides, the description template, assigning videos, adopting orphan ids. |
| `channels` | What a channel is: read `get_channel` before drafting for it, use its context, leave its profile to the package; the primary channel is the brief. |
| `localized` | The title, description, tags, chapter titles and Shorts caption in another language: one language per call, the merge, validating and packaging with `lang`. |

The same workflow is reachable as slash commands in Claude Desktop — **breakdown**,
**describe**, **chapters** and **batch_publish** — each of which starts by reading
the topic it is named after.
