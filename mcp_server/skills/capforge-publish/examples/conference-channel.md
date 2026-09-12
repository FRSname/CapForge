# Example: a conference channel

A filled-in **Channel notes** block for a channel that publishes recorded conference
sessions, plus an optional second destination. Copy what fits into your own
`SKILL.md`; the workflow and YouTube rules stay as they are.

## Channel notes

```
Channel:            Update Conference session recordings
Audience:           .NET and web developers who attended or wanted to; they know
                    the tools, they want the specific technique the speaker showed
Voice:              plain, third person, no marketing filler
Language:           English
Footer:             Update Conference, Prague
                    Session: "{{official title}}"
                    {{category}} | {{day}} | {{hall}}
Recorded-at line:   Recorded at Update Conference {{year}}, {{day}}, {{hall}}.
Speaker block:      SPEAKER
                    2 to 3 sentences from the speaker bio, then profile and social
                    links, one per line
Default hashtags:   #UpdateConference #dotnet #softwaredevelopment
Link rows:          Rate this session: {{feedback URL}}
House rules:        No em dashes or en dashes as punctuation (a hyphen inside a time
                    range is fine). Description body 1800 to 2200 characters. Add a
                    "Keywords:" line with 12 to 20 comma-separated search terms,
                    lowercase except proper nouns, above the hashtags. Add a
                    "COVERED IN THE SESSION" one-line list of the tools and concepts
                    named, and a "QUOTE" block with the most memorable verbatim line.
```

The values in `{{braces}}` are per-video facts the agent fills from the session
record or asks for once.

## Optional second destination

If the channel also keeps a session database, add a step after **Saving** that maps
the package into it. The CapForge note stays the source of truth; push from it, never
the other way round. For example, with a conference MCP that exposes
`set_session_enrichment`:

```
youtubeDescription       ← DESCRIPTION section (whole text, at most 5000 bytes)
youtubeShortDescription  ← SHORT DESCRIPTION (at most 200 characters)
highlights               ← WHAT YOU'LL LEARN bullets, as plain strings
customLinks              ← LINKS rows, as {label, url}
youtubeThumbnailHooks    ← THUMBNAIL IDEAS headlines (at most 5)
videoUrl                 ← the published video URL, once known
```

Record the push in NOTES with the target system and the record id, so a later
session knows the note was already published.
