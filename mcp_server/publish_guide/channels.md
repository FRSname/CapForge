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

## Posts — the video's text, one post per channel

A record keeps the video's text **per channel** under `posts`, keyed by channel id;
`get_video` returns it. Each post has only the fields its platform has:

| platform | fields |
|---|---|
| YouTube | `title`, `description`, `short_description`, `tags`, `hashtags`, `localized` |
| TikTok, Instagram | `caption`, `hashtags` |
| LinkedIn, X | `text`, `hashtags` |

Every post also carries `cover` (one of the record's thumbnail frames), `language`
(empty means the channel's), `published` `{url, id, at}` and `hidden`.

- **Read the context per channel.** For each channel the video has a post for, call
  `get_channel(channel_id)` first and write that post in that channel's voice. Never
  write a post for a channel whose context you have not read this session, and never
  carry one channel's voice into another channel's post.
- **Skip hidden posts.** `hidden: true` means the user set the post aside. Leave it
  alone unless they ask.
- **Write** with `set_video_meta(video_id, {"posts": {"<channel id>": {…}}}, rev)`.
  Posts merge per channel and per field: send only the fields you change, one channel
  per call is fine, and every channel you omit is kept. `{"posts": {"<channel id>":
  null}}` removes a post, while `{"hidden": true}` hides it and keeps its text. A field
  the platform does not have (a TikTok `title`) is refused with `field_not_on_platform`,
  and an id that is not a channel with `unknown_channel`. `localized` inside a YouTube
  post merges per language, like the root one.
- **The root fields are the primary channel's post.** The root `description`,
  `short_description`, `tags`, `hashtags`, `localized`, `thumbnail.cover` and
  `publish.youtube` read and write the primary channel's post, so everything written
  without a channel keeps working. Never send a root field and the same field under the
  primary's post in one patch: that is refused with `ambiguous_post_field`.
- **Check and read per channel.** `validate_video(video_id, channel="<channel id>")`
  judges that post by its platform's limits, measured on the pasted text (findings name
  `posts.<channel id>.<field>`), and `get_upload_package(video_id, channel="<channel
  id>")` renders the text the user pastes; a channel names its platform, so there is no
  `platform` argument. A channel the video has no post for answers `no_post`.
- **After upload.** `mark_published(video_id, url, channel="<channel id>")` records
  where that post went live.

## Older posts — only when the user asks

`get_channel(channel_id, include_recent_posts=True, limit=10)` adds `recent_posts`: the
channel's latest published posts, newest first (`limit` runs 1 to 50). Set it **only
when the user explicitly asks** to take inspiration from older videos. By default every
post is written from this video alone: a description should say what is specific to
this video, and a draft written beside old posts drifts toward a copy of them. When you
do read them, borrow structure and tone, never sentences.

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
