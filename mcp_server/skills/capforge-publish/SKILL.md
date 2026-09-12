---
name: capforge-publish
description: "Turn the video open in CapForge into a copy-ready YouTube upload package (title options, description with chapters, tags, hashtags, short description, Shorts caption and clip candidates) and save it as notes/youtube.txt in that video's CapForge workspace. Use when the user asks for a YouTube description, title ideas, chapters, tags, a Shorts caption, or an upload package for the video open in CapForge."
---

# CapForge publish package

CapForge holds the word-level transcript of the open video. This skill turns it into
one plain-text package the user pastes into YouTube Studio, and stores that package
next to the video so a later session can pick it up.

This file is yours to adapt. Everything channel-specific lives in **Channel notes**
below; the rest is the workflow and YouTube's own limits. See
`examples/conference-channel.md` for a filled-in copy that also pushes to a second
system.

## Channel notes (edit me)

Leave a field empty to skip its slot in the output.

```
Channel:            (name, one line)
Audience:           (who watches, what they already know)
Voice:              (plain / technical / playful; first or third person)
Language:           (default: the transcript language)
Footer:             (lines that end every description: links, credits, series)
Recorded-at line:   (template, e.g. "Recorded at {{event}}, {{date}}")
Speaker block:      (how a speaker is introduced: bio length, which links)
Default hashtags:   (5 to 10 tags every video carries)
Link rows:          (label: URL, one per line)
House rules:        (optional, e.g. "no em dashes", "description 1800 to 2200
                     characters", "keywords line with 12 to 20 terms")
```

## Requirements

CapForge must be running with the video open; the package is keyed to that video.
Tools used, all from the `capforge` MCP server:

- `get_status` to confirm a transcript is loaded and which file it is.
- `get_transcript(segments_only=True)` for the text with segment timings. Ask for the
  full shape only when you need word-level timing for a quote.
- `find_semantic_moments(kind)` with `numbers`, `cta`, `speaker_change` for chapter
  and highlight candidates; `find_moments(phrase)` to time a specific line.
- `get_workspace`, `read_workspace_file`, `write_workspace_file` for the notes.

If CapForge is not connected or reports no transcript, say so and stop. Do not
invent content from a title alone.

## Input

1. `get_status`, then `get_transcript(segments_only=True)`.
2. `read_workspace_file("notes/youtube.txt")`. If it exists, show its title and date
   and ask whether to refresh it or start over. Reuse what still holds.
3. Ask for the published video URL only if the user wants the Shorts caption to link
   to it; otherwise use `[FULL VIDEO URL]` and flag it in NOTES.

## Hard rules

These are YouTube's limits and the honesty rules. Breaking one makes the output
wrong, not merely different.

1. **Title** at most 100 characters; aim under 70 so it survives mobile truncation.
2. **Description** at most 5000 bytes. The first 150 characters appear before
   "more" and must work alone.
3. **No `<` or `>`** anywhere in title, description or tags.
4. **Tags** are one comma-separated line, at most 500 characters in total.
5. **Chapters**: the first is `00:00`, at least three, ascending, at least 10 seconds
   apart, all inside the video's duration. Timestamps come from the transcript
   (`find_semantic_moments`, segment starts) and are never invented. Format
   `MM:SS`, or `H:MM:SS` past an hour.
6. **Every claim traces to the transcript.** Name only tools, numbers, people and
   promises the speaker actually said. No filler ("dive into", "unlock").
7. Plain text. It gets pasted into a form, so no markdown.

## Output

One text package, in this order. Sections in `{{braces}}` come from Channel notes
and are dropped when the note is empty.

```
TITLE OPTIONS
1. [hook-led, under 70 characters]
2. [search-friendly alternative]
3. [third angle]

=====================================================================
DESCRIPTION
=====================================================================

[Opening paragraph, 2 to 3 sentences. Lead with the problem or the claim,
not with "In this video". The first 150 characters have to work alone.]

[Second paragraph, 2 to 4 sentences. What is actually shown, in order.
Name the demo, the repo, the numbers, as said.]

{{Recorded-at line}}

WHAT YOU'LL LEARN
- [4 to 6 concrete points, each useful on its own]

CHAPTERS
00:00 [label, at most 6 words]
[one line per chapter]

LINKS
[Resources named in the video, one per line]
{{Link rows}}

{{Speaker block}}

{{Footer}}

#Hashtag #Hashtag [8 to 15, {{Default hashtags}} first]

=====================================================================
TAGS
=====================================================================
[one comma-separated line, at most 500 characters, specific before broad]

=====================================================================
SHORT DESCRIPTION
=====================================================================
[One sentence under 150 characters for cards, playlists and social.]

=====================================================================
SHORTS
=====================================================================
CAPTION
[Line 1: the single claim or question, under 100 characters.]
[Lines 2 to 3: context, who is speaking. Under 300 characters in total.]

Full video: [FULL VIDEO URL]

#Shorts #Hashtag [6 to 10]

CLIP CANDIDATES
[2 to 3 moments, each: start-end timestamp, one line on why it stands alone.
Self-contained claims, surprising numbers, a demo that failed instructively,
a quotable line. Timestamps from the transcript.]

=====================================================================
THUMBNAIL IDEAS
=====================================================================
[2 to 3 briefs: headline of at most 4 words, one line of visual suggestion.
Text only; CapForge does not generate images.]

=====================================================================
NOTES
=====================================================================
Source: CapForge transcript, [file name], [duration]
Description: [n] characters, [n] bytes
Shorts caption: [n] characters
Chapters: [n], first 00:00, minimum gap [n]s
[Placeholders still open, e.g. the full video URL]
[House-rule checks and their result]
```

## Chapters

Candidates, in order of preference: speaker changes, long pauses between segments,
a topic shift you can name in a few words, a number or demo the speaker announces.
Snap each chapter to the start of the segment where the topic begins. Do not pad to
reach a count; six good chapters beat twelve thin ones.

## Before you finish

State the result of each check in NOTES.

1. Title options are all at most 100 characters.
2. Description is at most 5000 bytes, and the first 150 characters stand alone.
3. No `<` or `>` in title, description or tags; tags line at most 500 characters.
4. Chapters: `00:00` first, at least three, ascending, gaps of at least 10 seconds,
   all inside the duration.
5. Shorts caption body under 300 characters and the full-video line is present.
6. Every tool, number and claim appears in the transcript.
7. Every House rule in Channel notes is applied.

## Saving

1. `write_workspace_file("notes/youtube.txt", package)`. The folder is keyed to the
   open video and survives across sessions; CapForge never deletes it. If the file
   already exists and the user did not ask to refresh it, write
   `notes/youtube-2.txt` instead of overwriting.
2. Tell the user the workspace path from `get_workspace` so they can find the file.
3. Present the package in the conversation as well, ready to copy.

In a later session with the same video open, `read_workspace_file("notes/youtube.txt")`
brings the package back for edits, a Shorts caption, or a second platform.

If CapForge is not open but the user has a transcript file, you can still write the
package to the working folder as `<video name>-youtube.txt`; say that it was not
stored in CapForge.
