# Channels — who you are writing for

A **channel** is a place a video is published: a YouTube channel, a TikTok or
Instagram account, a LinkedIn page, an X account. CapForge keeps each one as a small
entity with two halves, and they are used very differently.

## `context` — read it before you draft anything for the channel

`get_channel(channel_id)` is the read before writing any text for a channel. Its
`context` is the style reference the user wrote down so you can sound like the channel:

| field | how to use it |
|---|---|
| `about` | What the channel is, who runs it, what it covers. Keep a draft inside that scope. |
| `audience`, `voice` | Who reads it and how it sounds. Hold to both unless the user overrides them in the conversation. |
| `title_style` + `example_titles` | How titles or captions are built: length, casing, emoji, a series prefix, "Speaker — Talk" order. Match the pattern the examples show; never reuse an example title. |
| `naming` + `example_slugs` | How videos are named and slugged: URL slugs, series and episode codes, file names. Build a new name the same way. |
| `keywords` | The channel's recurring keywords and tags. Reuse the ones that are true of this video; never force one in that isn't. |
| `notes` | Anything else: calls to action, words to avoid, pinned-comment habits. Treat it as binding. |

Read the channel **once per session** before you draft for it, and never write for a
channel whose context you have not read. An empty field means the user has not said:
fall back to the transcript and the platform's norms, not to another channel's context.

## `profile` — the package pastes it, you don't

`profile` holds the footer, the recorded-at line, the speaker block, the default
hashtags, the link rows, the house rules, the description template and its slots. The
upload package renders them on its own around the video's own text, so **never copy
any of it into a video's fields**: it would print twice. The house rules are what
`validate_video` reports as style findings.

## The primary channel is the brief

There is always exactly one **primary** channel, and it is always a YouTube channel
(`list_channels` shows `primary_id`). `get_brief` and `set_brief` are an alias onto it:
the brief's `channel` is its name, `audience` and `voice` come from its context, and
the rest is its language and profile. The upload package, `validate_video` and a
collection's effective brief all render with it. Prefer `get_channel` over `get_brief`:
it shows the context fields the brief does not.

- `set_channel(channel_id, primary=True)` moves the primary to another YouTube channel.
  A TikTok, Instagram, LinkedIn or X channel is refused with `primary_not_youtube`.
- `delete_channel` refuses the primary channel with `channel_is_primary`; move the
  primary first, and delete only when the user asked.

## Creating and changing channels

- `set_channel(channel_id, platform=…, name=…)` creates one; both are required. The id
  is lowercase letters, digits and hyphens, and the platform can never change later.
- On an existing channel only the arguments you pass are sent. `context` and `profile`
  merge per field, but a list inside them is replaced whole: read the channel first and
  send back the items you want to keep.
- Change a channel only for what the user tells you about the *channel*. Anything about
  one video belongs on its record with `set_video_meta`, and the user can edit every
  channel in Settings → Channels.
