# Multi-channel PR 1 — the channels contract

Companion to [multi-channel-publish.md](multi-channel-publish.md) §4.1, §4.1a, §5 (channels rows), §6 (channel tools), §7 (Settings → Channels) and §8 item 1. **Records are unchanged in this PR**: no `posts`, no schema 2, no import checklist, no Publish tabs, no `recent_posts`.

Exit: two YouTube channels and an Instagram channel can exist, and every existing upload package / validate result is **byte-identical** (never edit an existing package test's expectations).

## Files

`<library_root>/channels.json`, written with `fs.write_json_atomic` under the store's `write_lock` (`@writes`), like `collections.json`:

```jsonc
{ "version": 1,
  "primary_id": "update-conference",
  "channels": [ Channel, … ] }
```

- A missing file is **bootstrapped on first access** (any read or write of channels or the brief), under the write lock, re-checking the file inside the lock. It is written once and never overwritten by a bootstrap.
- Bootstrap = one YouTube channel from `load_brief(root)`:
  - `name` = `brief.channel.strip()` or the placeholder `"YouTube channel"`
  - `id` = `slugify(name)` (reuse `collection_store.slugify`)
  - `language` = `brief.language`
  - `context.audience` / `context.voice` = the brief's
  - `profile` = the brief's `footer, recorded_at_line, speaker_block, default_hashtags, link_rows, house_rules, description_template, slots`
  - it becomes `primary_id`
  - `brief.json` is left on disk untouched.
- A corrupt `brief.json` during bootstrap propagates as today (500 with the parse message). A corrupt `channels.json` is `ChannelsUnreadable(LibraryError, ValueError)` → 500. Duplicate ids, an unknown key, or a `primary_id` that names no channel / a non-YouTube channel make the file unreadable.

## Models (Python, `extra="forbid"` everywhere)

- `Platform = Literal["youtube", "tiktok", "instagram", "linkedin", "x"]`, defined in `platforms.py`.
- `ChannelContext`: `about: str = ""`, `audience: str = ""`, `voice: str = ""`, `title_style: str = ""`, `example_titles: list[str] = []`, `naming: str = ""`, `example_slugs: list[str] = []`, `keywords: list[str] = []`, `notes: str = ""`.
- `ChannelProfile`: exactly the brief's `footer, recorded_at_line, speaker_block, default_hashtags, link_rows, house_rules (HouseRules), description_template, slots` with the brief's defaults and the brief's slot-name validator.
- `Channel`: `id` (the collection id pattern `^[a-z0-9][a-z0-9-]{0,63}$`), `platform: Platform`, `name` (stripped, 1–120 chars), `handle: str = ""`, `url: str = ""`, `language: str = ""` (empty = the transcript's), `context: ChannelContext`, `profile: ChannelProfile`, `createdAt`, `updatedAt` (`now_iso`).
- `ChannelCreate`: `id?` (slugified from `name`, deduped with `unique_id`), `platform` (required), `name` (required), and optional `handle, url, language, context, profile`.
- `ChannelPatch`: `name?, handle?, url?, language?, context?, profile?`. `context` and `profile` **merge per field** (fields sent replace, omitted fields are kept; the `patched_collection` overrides precedent). `platform` is **not** patchable (a 422 through `extra="forbid"`). Top-level fields may be omitted but not sent as `null`. A no-op patch writes nothing and keeps `updatedAt`.

## The brief is a view of the primary channel

- `brief_from_channel(channel) -> Brief`: `channel` = `name`, `audience`/`voice` from `context`, `language`, and every profile field. Pure.
- `channel_patch_from_brief(BriefPatch) -> ChannelPatch`: the inverse mapping, only for fields in `model_fields_set`.
- `router_publish.read_brief(store)` now returns `brief_from_channel(primary)`. That is the single change that keeps the package, validators, `platform_posts`, collections' `effective_brief` and `GET /brief` all reading from the primary channel.
- `PATCH /brief` becomes `store.patch_channel(primary_id, channel_patch_from_brief(patch))` and answers the brief view. `save_brief` is no longer called by any route (keep `load_brief` for the bootstrap; delete `save_brief` and its lock only if nothing else uses them).
- **Accepted delta (document it in the module docstring):** a library whose `brief.channel` was empty now renders `{{channel}}` as `YouTube channel` in a *custom* description template until the channel is renamed. The built-in layout does not use `{{channel}}`, so every default package stays byte-identical.

## Primary channel

- Exactly one; always a YouTube channel.
- `POST /api/library/channels/{id}/primary` sets it. A non-YouTube channel → 422 `{reason: "primary_not_youtube", detail}`.
- Deleting the primary → 409 `{reason: "channel_is_primary", detail}`. Make another YouTube channel primary first.
- Channel ids that a record will use are PR 2's concern. In PR 1 any non-primary channel may be deleted.

## Routes (`backend/library/router_channels.py`, registered before `/{video_id}`, behind the actor guard, sync handlers)

| Route | Answer |
|---|---|
| `GET /api/library/platforms` | `{platforms: [PlatformSpec]}` |
| `GET /api/library/channels` | `{primary_id, channels: [Channel & {primary: bool}]}` in file order |
| `POST /api/library/channels` | 201 `Channel & {primary}`; taken explicit id → 409 `{reason: "channel_exists", detail}` |
| `GET /api/library/channels/{id}` | `Channel & {primary}`; 404 unknown |
| `PATCH /api/library/channels/{id}` | `Channel & {primary}`; 404 unknown; 422 invalid |
| `DELETE /api/library/channels/{id}` | 204; 404; 409 `channel_is_primary` |
| `POST /api/library/channels/{id}/primary` | the list shape; 404; 422 `primary_not_youtube` |
| `GET` / `PATCH /api/library/brief` | unchanged shape, now the primary channel's brief view |

Refusals carry `reason` at the top level beside `detail` (the `router_collections` `_refusal` precedent). 422 refusals from Pydantic keep FastAPI's normal body.

## `backend/library/platforms.py` — platform facts, once

```jsonc
PlatformSpec = {
  "id": "tiktok", "label": "TikTok",
  "fields": ["caption", "hashtags", "cover"],
  "limits": [ { "field": "caption", "max": 2200, "unit": "utf16", "severity": "hard" },
              { "field": "hashtags", "max": 5, "unit": "items", "severity": "style" } ]
}
```

| id | label | fields | limits |
|---|---|---|---|
| youtube | YouTube | title, description, tags, hashtags, cover, localized | title 100 `chars` hard; description 5000 `bytes` hard; tags 500 `chars` hard |
| tiktok | TikTok | caption, hashtags, cover | caption 2200 `utf16` hard; hashtags 5 `items` style |
| instagram | Instagram | caption, hashtags, cover | caption 2200 `chars` hard; hashtags 30 `items` hard; mentions 20 `items` hard |
| linkedin | LinkedIn | text, hashtags, cover | text 3000 `chars` hard; hashtags 5 `items` style (min 3 style: `"min": 3`) |
| x | X | text, hashtags | text 280 `weighted` hard (URL weight 23) |

- Units: `chars` (Python `len`), `bytes` (UTF-8), `utf16` (UTF-16 code units), `weighted` (X: a URL counts 23), `items` (list length).
- **No second copy of a number.** YouTube limits import `TITLE_MAX_CHARS`, `DESCRIPTION_MAX_BYTES`, `TAGS_MAX_CHARS` from `validate.py`. Move the LinkedIn / X / Instagram constants out of `platform_posts.py` into `platforms.py`, and have `platform_posts.py` import them (its outputs stay byte-identical).
- Pure `count(unit, value, *, url_weight=23) -> int` helper, tested per unit (an emoji is 2 utf16 units and 4 bytes; an X URL is 23).
- PR 1 only serves and tests the table. The validators that enforce it are PR 2.

## Renderer wire shapes (`src/renderer/src/lib/channelTypes.ts`)

```ts
export type Platform = 'youtube' | 'tiktok' | 'instagram' | 'linkedin' | 'x'
export interface ChannelContext { about: string; audience: string; voice: string; title_style: string; example_titles: string[]; naming: string; example_slugs: string[]; keywords: string[]; notes: string }
export type ChannelProfile = Pick<Brief, 'footer' | 'recorded_at_line' | 'speaker_block' | 'default_hashtags' | 'link_rows' | 'house_rules' | 'description_template' | 'slots'>
export interface Channel { id: string; platform: Platform; name: string; handle: string; url: string; language: string; context: ChannelContext; profile: ChannelProfile; createdAt: string; updatedAt: string; primary: boolean }
export interface ChannelsList { primary_id: string; channels: Channel[] }
export interface PlatformLimit { field: string; max: number; min?: number; unit: 'chars' | 'bytes' | 'utf16' | 'weighted' | 'items'; severity: 'hard' | 'style' }
export interface PlatformSpec { id: Platform; label: string; fields: string[]; limits: PlatformLimit[] }
```

Every response is parsed through a boundary guard (`parseChannel`, `parseChannelsList`, `parsePlatformSpecs`) that fills defaults for missing strings/lists and rejects an unknown platform, the `publishTypes.ts` / `collectionTypes.ts` precedent.

## MCP (57 → 61) — `mcp_server/channel_tools.py`

Mirror `collection_tools.py` exactly (`TOOLS`, `register(mcp, get_client)`, error dicts, no import of `server`):

- `list_channels()` → `{status, count, primary_id, channels}`
- `get_channel(channel_id)` → `{status, channel}`. Its docstring says this is **the agent's main read before writing any text for a channel**: treat `context` (about, audience, voice, title_style + example_titles, naming + example_slugs, keywords, notes) as the style reference, and `profile` is what the package pastes, so never copy it into a video's text.
- `set_channel(channel_id, platform=None, name=None, handle=None, url=None, language=None, context=None, profile=None, primary=None)` — an upsert. Create needs `platform` and `name`. On an existing channel only passed arguments are sent. `context` / `profile` merge per field. `primary=True` calls the primary route after the write. Changing `platform` on an existing channel is refused client-side with a clear message.
- `delete_channel(channel_id)` — refused for the primary channel, relaying the reason.
- `get_brief` / `set_brief` docstrings: now an alias onto the **primary channel** (name ↔ `channel`, context audience/voice, language, profile); prefer `get_channel` / `set_channel` for channel work.
- `EXPECTED_TOOL_COUNT = 61`.
- New guide topic `mcp_server/publish_guide/channels.md` (+ `TOPICS` + `INDEX.md`): what a channel is, read `get_channel` before drafting for it, how to use `example_titles` / `naming` / `example_slugs` / `keywords` / `notes`, the primary channel as the brief. No `recent_posts` yet.
