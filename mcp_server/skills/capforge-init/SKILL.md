---
name: capforge-init
description: "Set up CapForge's channels by interviewing the user: which YouTube, TikTok, Instagram, LinkedIn and X accounts they publish to, what each one is about, who it is for, how it sounds, how its titles and names are built, and the footer, links, hashtags and house rules its upload package pastes. Fills in Settings → Channels from the answers. Use when the user runs /capforge-init, is setting CapForge up for the first time, or asks to set up, fill in or redo their channel details."
---

# CapForge channel setup

Every text CapForge's agent writes for a video (titles, descriptions, captions, posts)
is written for a **channel**, and a channel is only as good as what the user told it.
This skill is the interview that fills the channel details in: the same fields the
user sees in CapForge under Settings → Channels, written through the `capforge` MCP
server.

You are asking, not authoring. **Never invent** a channel, a handle, a URL, an
audience, a sponsor, a hashtag or a rule. Every value you write is something the user
said, pasted or approved as your wording of it. A field the user has nothing for stays
empty: empty is a valid answer, and the publish agent falls back to the transcript and
the platform's norms.

## Requirements

CapForge must be running (the window can be closed). Tools, all from `capforge`:

- `list_channels()` for what exists and which channel is primary.
- `get_channel(channel_id)` to read one channel in full before changing it.
- `set_channel(channel_id, …)` to create or change one.
- `publish_guide("channels")` if you need the full reference for a field.

If `list_channels()` fails because CapForge is not reachable, say so and stop.

## How to run the interview

- **A few related questions per turn** (two to four), in plain words, never a form of
  twenty fields at once. Say which channel and which part you are on.
- **Offer something to react to.** When the user pastes real material (a channel
  description, five recent titles, an old video description), draft the field from it
  and ask "is this right?" rather than asking them to describe their style from
  scratch.
- **Skipping is always allowed.** "Skip", "don't know" or "later" leaves the field as
  it is, and you move on.
- **Confirm before every write.** Show exactly what you are about to write for that
  channel, field by field, then write it only after the user agrees. One
  `set_channel` call per confirmed part is fine.
- **Their words win.** Keep the user's phrasing for about, audience, voice and notes;
  tighten it only when they ask you to.

## 1. See what is there

Call `list_channels()`.

- **A fresh library** has one YouTube channel named "YouTube channel" with an empty
  context. That is a placeholder: fill it in (rename it with name=…) rather than
  creating a second YouTube channel. Its id stays what it is; ids are internal.
- **Channels already filled in:** show a short summary (name, platform, handle, which
  parts are empty) and ask what to update. Read `get_channel(channel_id)` before
  changing any of them, and ask before replacing anything that is already filled in.

## 2. Where they publish

Ask which places they publish videos to. For each one:

| ask | field | note |
|---|---|---|
| Which platform? | platform | youtube, tiktok, instagram, linkedin or x. It can never change later. |
| What do you call it? | name | Shown in CapForge's tabs and lists. |
| Handle and link? | handle, url | "@handle" and the full https URL. |
| Which language do you post in? | language | A code such as en or cs. Empty means the video's transcript language, which is right for a channel that posts in several. |

- **The id** for a new channel is lowercase letters, digits and hyphens, built from the
  name (update-conference, filip-linkedin). Propose it; the user rarely cares.
- **The primary channel** is the one the brief and the default upload package use, and
  it must be a YouTube channel. With more than one YouTube channel, ask which is the
  main one and call `set_channel(channel_id, primary=True)` on it. A user with no
  YouTube channel keeps the placeholder as primary; tell them it is only there because
  CapForge needs one.

Create each new channel with `set_channel(channel_id, platform=…, name=…, handle=…,
url=…, language=…)` once the user confirms the list.

## 3. About the channel (context), one channel at a time

This is what the publish agent reads before writing anything for the channel, so it
is the part worth the user's time. Start with the primary channel. For each channel:

| ask | field |
|---|---|
| What is the channel, who runs it, what does it cover? | about |
| Who watches or reads it? What do they already know? | audience |
| How should it sound? (plain, technical, warm, funny, first or third person) | voice |
| Paste three to five real titles (or captions) you like. | example_titles, then title_style |
| How do you name videos: URL slugs, episode codes, file names? Any real examples? | naming, example_slugs |
| Which keywords or tags come back in most videos? | keywords |
| Anything else: calls to action, words to avoid, what you always or never do? | notes |

- **Derive the style from the examples.** From the pasted titles, describe the pattern
  (length, casing, emoji, a series prefix, "Speaker — Talk" order) as title_style and
  confirm it with the user. Do the same for naming from the slugs.
- **Another channel of the same person** often shares audience or keywords but rarely
  the voice. Ask ("same audience as your YouTube channel?") instead of copying.
- **Older posts are opt-in.** If the channel already has published videos in CapForge,
  you may offer to read them to draft the style, and call `get_channel(channel_id,
  include_recent_posts=True)` only when the user says yes.

Write it as `set_channel(channel_id, context={…})` with the fields they answered.

## 4. What the package pastes (profile)

The profile is pasted **verbatim** around every video's own text, so ask only for what
is true of **every** video on the channel.

**YouTube channels:**

| ask | field |
|---|---|
| A closing block under every description (who you are, subscribe line, sponsor)? | footer |
| A "Recorded at …" line every video carries? | recorded_at_line |
| How should a speaker be introduced when a video has one? | speaker_block |
| Hashtags on every video? | default_hashtags (with the #) |
| Links on every video (website, newsletter, socials)? | link_rows, each a label and a url |
| Any writing rules to check? | house_rules |
| A fixed description layout? | description_template, slots |

**TikTok, Instagram, LinkedIn and X channels** have no description to lay out: ask only
for default_hashtags and link_rows.

- **house_rules** is one object, always sent with all four keys: no_em_dashes (true or
  false), description_chars (a [min, max] character window for the description, or
  null), keywords_terms (a [min, max] count for a keywords line, or null) and
  hook_first_150 (true unless the user objects: the first 150 characters must work
  before YouTube's "more").
- **description_template:** recommend leaving it empty, which is CapForge's built-in
  layout. Only a user with a layout they already use every time needs one. It places
  {{slot}} placeholders: the built-in ones (description, title, short_description,
  recorded_at, highlights, chapters, links, speakers, footer, hashtags, channel,
  collection) and custom slots. A custom slot name is lowercase letters, digits and
  underscores, starts with a letter and may not reuse a built-in name; slots also
  expand inside the footer and the recorded-at line.
- **Event or series boilerplate is not channel boilerplate.** A sponsor, a conference
  name, a feedback link or a "Recorded at UCK 2026" line that holds for one event
  belongs on a **folder** (a collection), not on the channel, or it prints on every
  future video. Note it and offer to set that folder up afterwards, following
  `publish_guide("collections")`.

Write it as `set_channel(channel_id, profile={…})` with the fields they answered.

## Writing rules

- **context and profile merge per field**: send only the fields you are changing, and
  the rest is kept.
- **A list is replaced whole** (example_titles, example_slugs, keywords,
  default_hashtags, link_rows), and so is house_rules. When a channel already has one,
  read `get_channel(channel_id)` first and send the full new list, the kept items
  included.
- **A refusal is information.** Show the user the message and fix what it names (a slot
  name, a non-YouTube primary, an id already taken); never retry the same write
  unchanged.
- **Call `delete_channel` only when the user asks** to remove a channel. The primary
  channel cannot be deleted; move the primary first. Never change a video's record
  here: this skill is about channels only.

## 5. Finish

1. `get_channel(channel_id)` for each channel you wrote, and show the user a compact
   summary: name, platform, primary or not, and which parts are filled and which are
   still empty.
2. Tell them where to edit it by hand: Settings → Channels, "About this channel — for
   Claude" for the context and "Pasted into posts" for the profile.
3. Mention what comes next: any folder boilerplate you noted in step 4, and the
   capforge-publish skill for writing a video's upload package with these channels.
