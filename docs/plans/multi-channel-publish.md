# Multiple channels: per-channel publish text

Status: **APPROVED** (2026-09-16). PR 1 (channels) in progress.

## 1. What Filip asked for

- Settings holds **many channels**: several YouTube channels plus TikTok, Instagram, LinkedIn and X.
- On a video's Publish page, **each channel is a tab**. Each tab's text is **independent**: a YouTube title, an Instagram caption and a LinkedIn post are written separately and never generated from one another.
- A channel has a **main language** (a Czech channel posts in Czech), and **one video can differ**.
- Still **copy-paste only**. No posting APIs (vision D6, §8).
- X stays.

## 2. What exists today (verified against main `6547383`)

- **One global brief** (`backend/library/brief.py`, `brief.json`) holds the channel's name, audience, voice, footer, links, default hashtags, house rules, description template and slots. Settings → Channel edits it. Collections override it (`collection_store.effective_brief`).
- **One set of publish text per record** (`schemas.AuthoredFields`): `title`, `title_options`, `description`, `short_description`, `tags`, `hashtags`, `keywords`, `shorts.caption`, `thumbnail.cover`, `localized`, and `publish.youtube`.
- **Consumers of that text:**
  - `validate.py`, `validate_localized.py`, `validate_media.py`
  - `package.py` (the YouTube upload package), `platform_posts.py` / `platform_package.py` (Part C: LinkedIn/X/Instagram text *generated on the fly*)
  - `store._index_record` (FTS over title + description + tags)
  - `schemas.derive_status`: `published` ⇐ `publish.youtube.videoId`, `drafted` ⇐ `description`
  - MCP `set_video_meta`, `get_upload_package`, `validate_video`, `mark_published`, `get_brief`/`set_brief`
  - publish guide topics and the `capforge-publish` skill
- **Records have no schema version.** `VideoRecord` ignores unknown keys and defaults missing ones. So *adding* a field is safe, but *moving* one needs a read-time upgrade, or the next write silently drops the old text.
- **Renderer limits:** `usePublishRecord.ts` is at 399 lines and `App.tsx` at 602 (must not grow). Drafts are keyed by field name (`lib/publishDrafts.ts`). `violationsForField` already matches dotted sub-fields, so `posts.<channel>` works unchanged.

## 3. Platform facts (the rules each tab is held to)

| Platform | Fields in a tab | Hard limits | Style findings |
|---|---|---|---|
| YouTube | title, description, tags, hashtags, cover, translations | title ≤ 100 chars; description ≤ 5000 bytes, no `<` `>`; tags ≤ 500 chars; chapters rules (today's) | today's house rules |
| TikTok | caption, hashtags, cover | caption ≤ 2200 UTF-16 units ([TikTok Content Posting API](https://developers.tiktok.com/doc/content-posting-api-reference-direct-post)) | more than 5 hashtags (only the first 5 count) |
| Instagram | caption, hashtags, cover | caption ≤ 2200 chars, ≤ 30 hashtags, ≤ 20 @mentions ([Meta IG media reference](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media)) | a URL in the caption (not clickable) |
| LinkedIn | post text, hashtags, cover | ≤ 3000 chars | fewer than 3 or more than 5 hashtags |
| X | post text, hashtags | ≤ 280 weighted, URL = 23 (today's `platform_posts`) | — |

- Some guides quote 4000 for TikTok's in-app caption. We hold to the documented 2200.
- These live **once, in Python** (`backend/library/platforms.py`) and are served by `GET /api/library/platforms`, so the renderer meters from the served table instead of a TS twin (the "validators live in Python, once" rule).
- A field the platform doesn't have (a TikTok `title`) is a hard `field_not_on_platform`.

## 4. Data model

### 4.1 Channels (`channels.json`, library root, like `collections.json`)

```jsonc
{ "version": 1, "channels": [
  { "id": "update-conf-yt",            // slug, stable
    "platform": "youtube",              // youtube | tiktok | instagram | linkedin | x
    "name": "Update Conference", "handle": "@updateconf", "url": "https://…",
    "language": "cs",                   // main language; "" = the transcript's
    "context": {                        // §4.1a — read by the agent before it writes
      "about": "", "audience": "", "voice": "",
      "title_style": "", "example_titles": [],
      "naming": "", "example_slugs": [],
      "keywords": [], "notes": "" },
    "profile": {                        // pasted into the text by the package renderer
      "footer": "", "recorded_at_line": "", "speaker_block": "",
      "default_hashtags": [], "link_rows": [],
      "house_rules": { … }, "description_template": "", "slots": {} },
    "createdAt": "…", "updatedAt": "…" } ] }
```

- **Bootstrap:** if `channels.json` is missing, one YouTube channel is created from `brief.json` with the brief's `channel` text as its name, or the placeholder **"YouTube channel"** when that is empty. Filip names it in Settings whenever he's ready; nothing asks for a name up front. It is the **primary channel**, and `brief.json` is left on disk untouched (the backend never deletes a user file).
- **The primary channel** is what legacy callers (`get_brief`/`set_brief`, a package request with no channel) resolve to. It is the first YouTube channel, reassignable in Settings. Deleting the last YouTube channel is refused while any record has a post for it.
- **Collections** keep overriding profile fields and slots on top of *whichever* channel is rendered. Per-channel collection overrides are out of scope (§9).

### 4.1a A channel is context for the agent first

Filip's framing (2026-09-16): the channel settings exist so that an agent writing a post **for that channel** can read how the channel looks and write like it. Most of a channel is therefore description, not machinery:

| `context` field | What it tells the agent |
|---|---|
| `about` | what the channel is, who runs it, what it covers |
| `audience`, `voice` | who reads it and how it sounds (moved here from the brief) |
| `title_style` + `example_titles[]` | how titles or captions are built (length, casing, emoji, series prefix, "Speaker — Talk" order), with real examples |
| `naming` + `example_slugs[]` | how videos are named and slugged (URL slugs, series and episode codes, file names) |
| `keywords[]` | the channel's recurring keywords and tags to reuse |
| `notes` | anything else, free text (CTAs, words to avoid, pinned-comment habits) |

- **Past posts are opt-in, never default context.** `get_channel(channel_id, include_recent_posts=False, limit=10)` returns `recent_posts` only when asked: the channel's latest published posts across the library (title/caption, hashtags, URL), derived at read time.
  - **Why** (Filip, 2026-09-16): descriptions should be specific to *this* video, and old posts in the context pull the draft toward generic copies of past ones.
  - The agent asks for them **only when the user explicitly asks** to take inspiration from older videos.
- **`profile`** holds only what the package renderer pastes mechanically (footer, links, default hashtags, template, slots, house rules), plus the style rules the validators run.
- **Most of this already exists** in today's Settings → Channel pane: channel, audience, voice, language, recorded-at line, speaker block, footer, description template, slots, default hashtags, link rows and house rules. Per channel they move **as they are**, filled from the brief at bootstrap. The only new fields are `about`, `title_style` + `example_titles`, `naming` + `example_slugs`, `keywords` and `notes`.

### 4.2 Per-video posts (`record.posts`, new authored field)

```jsonc
"posts": {
  "update-conf-yt": { "title": "…", "description": "…", "tags": [], "hashtags": [],
                      "cover": "<32hex>.jpg" | null, "language": null,
                      "localized": { "en": { "title": "…", "description": "…" } },
                      "published": { "url": null, "id": null, "at": null } },
  "filip-ig":       { "caption": "…", "hashtags": [], "cover": null, "language": "en",
                      "published": { … } } }
```

- **The keys are the channels a video is published to.** A post has `hidden: bool`:
  - removing a tab **hides** it and keeps its text
  - adding the channel back un-hides it with the text intact
  - a hidden post is skipped by status, search, validation and `recent_posts`
  - adding a channel the video never had creates an empty post
- **One `Post` model for all platforms.** Per-platform validation decides which fields may be non-empty.
- `language: null` means the channel's language.
- `localized` is YouTube-only (Studio's per-video translations) and replaces today's root `localized`.
- `cover` names one of the **shared** `thumbnail.candidates` frames, so frames stay one strip per video and each channel picks its own cover.
- **Stays video-level** (shared by every tab): `title` (the video's name in the library and search), `title_options`, `keywords`, `chapters`, `summary_md`, `highlights`, `quotes`, `links`, `tools_mentioned`, `speakers`, `collection_id`, `thumbnail.candidates` / `thumbnail.ideas`, `shorts.clip_suggestions`, `external_refs`.
- **`PATCH posts` merges per channel and per field** under the store lock, like `localized` (4s part B):
  - an omitted channel is kept, and `{channel: null}` removes it
  - within a post, sent fields replace and omitted fields are kept
  - a key that isn't a known channel id is a 422 `unknown_channel`
- **Channels are chosen at import.** `POST /api/library`, `import-paths` and `import-folder` accept an optional `channels: [id]`, and the record is created with an empty post per id.
  - **The renderer asks** ("Publish to:" checklist) on drop, Add video and Import…, **once per batch**, preselecting the previous choice (remembered in `app-state`). Picking nothing is allowed.
  - **Imports with no UI** (the watch folder, the agent's `load_video`) create a record with no posts. Opening Publish on a video with no channels shows the same checklist in place of the tabs.

### 4.3 Upgrading existing records (schema 2)

- A new system field `schema: int` (absent = 1). `store._load` upgrades the **raw dict before `model_validate`**:
  - root `description`, `short_description`, `tags`, `hashtags`, `localized`, `thumbnail.cover`, `publish.youtube` → `posts[<primary>]`
  - root `title` is **copied** into the post and kept as the video name
  - `shorts.caption` is kept as a read-only legacy value, offered as "Start from Shorts caption" in an empty TikTok/Instagram tab
- **Writes:** the upgraded record is written on its next write, not on read. The first such write saves `record.v1.json` beside it once.
- **Downgrade risk:** an older CapForge build would read a schema-2 record, ignore `posts`, and drop it on its next write. Mitigation: the backup above, plus a note in the release notes. There is no in-app downgrade path.

## 5. Backend changes

| Area | Change |
|---|---|
| `platforms.py` (new) | platform ids, field sets, limits, counting (UTF-16 for TikTok, weighted for X); `GET /api/library/platforms` |
| `channel_store.py` + `router_channels.py` (new) | `GET/POST /api/library/channels`, `GET/PATCH/DELETE …/{id}`, bootstrap from `brief.json`, primary channel; `brief.py` stays as the bootstrap source and the `get_brief`/`set_brief` alias onto the primary channel's profile |
| `schemas.py` | `Post`, `PostPublished`, `posts`, `schema`; drop root `description`/`short_description`/`tags`/`hashtags`/`localized`/`publish` from `AuthoredFields` (kept only as upgrade input); contract test re-partitioned |
| `record_upgrade.py` (new) | the v1 → v2 dict transform, pure, fixture-tested against real v1 records |
| `store.py` (484 lines, so split first) | `_load` calls the upgrade; `posts` merge in a `store_posts.py` mixin (the `store_localized.py` precedent); index text = title + every post's text + tags; `status_of`: `published` ⇐ any post published, `drafted` ⇐ any post with text |
| validators | `validate_posts.py` (new): per-platform hard limits + `field_not_on_platform` under `posts.<channel>.<field>`; house rules from the channel's effective profile; `validate_localized` retargeted to `posts.<yt>.localized` |
| package | `GET /{id}/package?channel=<id>&lang=`: YouTube channels render today's layout from the post + effective profile; others render the post text + hashtags; `platform=` removed (the renderer is the only other caller) |
| Part C generators | `platform_posts.py` becomes **"Start from…"**: `POST /{id}/posts/{channel}/draft?from=<channel>` returns (never stores) adapted text for a one-time copy into an empty tab |
| publish state | `POST /{id}/posts/{channel}/published {url}`; the YouTube id is still parsed from the URL; `record.publishedAt` = the earliest post's `at` |
| list summary | derived `publishedOn: [channel ids]` for the card |
| import / create | optional `channels: [id]` on `POST /api/library`, `import-paths`, `import-folder`; unknown id → 422 `unknown_channel` |

## 6. MCP (57 → 61)

- **New tools:** `list_channels`, `get_channel`, `set_channel` (upsert), `delete_channel` (mirrors `collection_tools.py`, in `mcp_server/channel_tools.py`).
- `get_brief` / `set_brief` stay as aliases onto the primary channel's profile, with a docstring pointing at the channel tools.
- **Changed tools:**
  - `set_video_meta` documents the `posts` per-channel merge (send only what you change; `null` removes a tab)
  - `get_upload_package(video_id, channel=None, lang=None)`
  - `validate_video(video_id, channel=None, lang=None)`
  - `mark_published(video_id, url, channel=None)`
  - `get_video` includes `posts`
- **Guide and skill:**
  - a new `publish_guide/channels.md`; `localized.md`, `shorts.md`, `workflow.md` and `batch.md` updated
  - the `capforge-publish` skill writes per channel. For each tab the video has, it calls `get_channel` first and treats `context` as the style reference before drafting. It never writes a post for a channel whose context it hasn't read in that session.
  - The skill **never sets `include_recent_posts`** unless the user asked for inspiration from older videos. `test_bundled_skills.py` pins the skill text saying so.
  - `get_channel` is the agent's main read. Its docstring says so, and `publish_guide/channels.md` explains how to use `example_titles`, `naming` and `keywords`, and when (only on request) to pull `recent_posts`.
  - `EXPECTED_TOOL_COUNT` 61; `test_publish_guide.py` / `test_bundled_skills.py` keep every named tool real
- **Mirror:** `UiStateCore.activeChannelId` so an agent knows which tab is open.

## 7. Renderer

- **Settings → Channels** replaces Settings → Channel. It is a list + detail pane copying `CollectionsSettings` / `CollectionEditor`:
  - **Identity:** platform picker, name, handle, url, language, primary toggle
  - **"About this channel — for Claude"** (first, largest section): about, audience, voice, title style + example titles (a list editor), naming + example slugs, keywords, notes.
  - **"Pasted into posts"** (collapsed): footer, links, default hashtags, template, slots, house rules. The editors reuse `BriefFields` / `SlotFields`, and YouTube-only fields (template, footer) are hidden for other platforms.
- **Import checklist** ("Publish to:"): a small sheet after a drop, Add video or Import…, listing the Settings channels with platform icons, preselected with the last choice. It's also shown inside Publish for a video that has no channels yet. With no channels in Settings it is skipped, with a one-line hint pointing to Settings → Channels.
- **Publish aside:**
  - a **channel tab strip** under the header: one tab per post, platform icon + channel name, a published dot
  - a **+** menu listing the Settings channels the video isn't on (hidden tabs listed first as "Show again"), and × on a tab to hide it (no confirm needed: nothing is lost)
  - **Tab section** (per channel, only the platform's fields):
    - Title/Caption, Description/Post text, Tags (YouTube), Hashtags
    - Cover (picks from the shared frame strip)
    - Translations (YouTube)
    - Language chip (channel default, changeable)
    - Published link
  - An **empty tab** offers "Start from…": another tab's text adapted for this platform (the Part C generators), or the legacy Shorts caption.
  - **Video section** (shared, below the tabs): Collection, Chapters, Shorts clips, Thumbnail frames + ideas, Speakers, Summary.
  - **Footer:** "Copy <YouTube package | Instagram caption | …>" for the **active tab**, the language select as today, plain transcript and SRT/VTT unchanged. The platform dropdown is removed.
- **Plumbing** (all outside `usePublishRecord.ts` and `App.tsx`):
  - `lib/channelTypes.ts`: wire shapes + boundary guards
  - `lib/platformSpecs.ts`: parses the served table and meters counts only
  - `lib/publishPosts.ts`: per-channel draft **delta** composed at send time beside `withLocalizedDraft`; soft-lock merge per channel+field
  - `hooks/usePublishChannels.ts`: channel list + active tab, joins the mirror

## 8. Delivery — three PRs, each usable alone

1. **Channels.** `channels.json` + bootstrap + routes + `platforms.py` + Settings → Channels + MCP channel tools. Records unchanged: the package still renders from the primary channel's profile.
   - Exit: two YouTube channels and an Instagram channel exist, the existing package is byte-identical.
2. **Posts in the record.** Schema 2 + upgrade + `posts` merge + per-platform validators + per-channel package / validate / published + index/status + MCP record tools + guide + skill.
   - Exit: every real record on this Mac upgrades, and its YouTube package is **byte-identical** to before (the package-template precedent: never edit those expectations).
   - Also: a TikTok post over 2200 → 422 under `posts.<id>.caption`.
3. **Publish tabs.** Tab strip, per-channel cards, add/remove, Start from…, per-tab footer, `activeChannelId`.
   - Exit: write different YouTube and Instagram text for one video, copy each, restart, both survive.

Tests follow the repo's constraints: vitest node env and static markup; backend fixtures from real v1 records; one live uvicorn run per PR.

## 9. Not in this plan

- Posting to any platform, and OAuth (D6).
- Per-channel collection overrides, and per-channel chapters or clip suggestions.
- Scheduling, and per-channel analytics.
- Auto-generating tab text without the user asking (§8 "no baked prompts"). "Start from…" is an explicit one-time copy.

## 10. Decisions (Filip, 2026-09-16)

1. **Tabs come from an import-time choice.** Channels are set up in Settings; each import asks "Publish to:"; more can be added later from the tab strip.
2. **The existing channel isn't named yet.** Bootstrap uses the brief's channel text or a placeholder, renamed in Settings later.
3. **Removing a tab hides it** and keeps the text.
4. **Past posts are opt-in.** `get_channel` never includes them by default; the agent pulls them (`include_recent_posts=True`) only when the user asks for inspiration from older videos.
