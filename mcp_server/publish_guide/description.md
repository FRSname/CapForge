# Title, description, tags

The fields YouTube reads, with YouTube's limits and the channel's rules. CapForge
refuses a write that breaks a limit and reports a house-rule finding as advice.

## The hard rules

1. **`title`** at most 100 characters. Aim under 70 so it survives mobile truncation.
2. **`description`** at most 5000 **bytes** (not characters — accents and emoji
   count more). The first 150 characters appear before "more" and must work alone.
3. **No `<` or `>`** in title, description or tags; YouTube strips markup.
4. **`tags`** join into one comma-separated line of at most 500 characters.
5. Plain text everywhere; the description keeps its line breaks, nothing else.

## The house rules (from `get_brief`)

Whatever the brief states: no em dashes, a description length window, a keyword
count, a hook in the first 150 characters, the footer, the default hashtags. They
are advice — `validate_video` lists them under `style` — and you follow them unless
the user overrides them in the conversation.

## `title` and `title_options`

Three angles in `title_options`: hook-led, search-friendly, and a third (a number,
a contrarian claim, the speaker's own phrase). Put the one you recommend in
`title`; the package prints it first. Each at most 100 characters, none with a claim
the transcript does not support.

## `description`

- The opening paragraph leads with the problem or the claim, never with "In this
  video". It has to make sense on its own, cut at 150 characters.
- The second paragraph says what is actually shown, in order.
- The "what you'll learn" block is rendered from `highlights` (see `breakdown`);
  the chapter block from `chapters`; links from `links` and the brief; the speaker
  block from `speakers`; the footer and the hashtags from the brief. Do not write
  those into the description text — CapForge assembles them, and writing them twice
  prints them twice.
- No filler: "dive into", "unlock", "game-changing". Name the thing.

## `short_description`

One sentence, at most 200 characters, for cards, social posts and the Update-conf
push. A claim, not a teaser.

## `tags`, `hashtags`, `keywords`

- `tags`: specific before broad — the product names and the exact problem first,
  the category last. Only what the transcript supports.
- `hashtags`: 8 to 15, the brief's defaults first, then the video's own. With the
  `#`.
- `keywords`: the terms this video should rank for; the brief may set a count.

## Check, then read

`validate_video(video_id)` after the write; fix `hard`, follow `style`. Then
`get_upload_package(video_id)` for the assembled text.
