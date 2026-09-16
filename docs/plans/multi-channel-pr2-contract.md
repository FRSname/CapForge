# Multi-channel PR 2: posts in the record

Companion to [multi-channel-publish.md](multi-channel-publish.md) §4.2, §4.3, §5, §6 and §8 item 2, building on [PR 1](multi-channel-pr1-contract.md) (channels, primary channel, `platforms.py`).

**Exit:**
- Every real record on this Mac upgrades, and its YouTube package is **byte-identical** to before. Never edit an existing package, validate, localized, frames or record test expectation to make this pass.
- A TikTok post over 2200 UTF-16 units → 422 under `posts.<id>.caption`.
- The renderer is **not changed** in this PR, and today's Publish page keeps working against the new backend (PR 3 builds the tabs).

## Deviation from the plan: the root fields become the primary post's view

Plan §5 dropped root `description`/`short_description`/`tags`/`hashtags`/`localized`/`publish` from `AuthoredFields`. **They stay** instead, as the **primary channel's post**, exactly as PR 1 made the brief the primary channel's profile:

- **Stored** (`record.json`, `schema: 2`): the per-video text lives only in `posts`. The projected fields below are never written at the root.
- **In memory and on the wire**: the projected root fields hold the primary channel's post, so every existing reader (package, validators, `localized.py`, frames, the renderer, MCP `set_video_meta`) keeps working unchanged.
- **A root write is a write to the primary post** (created when absent, un-hidden when hidden).
- The projection is permanent, not a PR 2 shim. It is the legacy alias for any caller that doesn't name a channel.

### Projected fields (root ↔ `posts[<primary_id>]`)

| Root (wire) | Post field |
|---|---|
| `description` | `description` |
| `short_description` | `short_description` |
| `tags` | `tags` |
| `hashtags` | `hashtags` |
| `localized` | `localized` |
| `thumbnail.cover` | `cover` (root `thumbnail.candidates` / `ideas` stay stored at the root) |
| `publish.youtube` `{videoId, url, publishedAt}` | `published` `{id, url, at}` (root `publish.pushes` stays stored at the root) |

**`title` is special.**
- Root `title` stays **stored**: it is the video's name in the library and search.
- The post has its own `title`.
- A root `title` write also sets `posts[primary].title` (the bridge, so today's Title card keeps the package in step).
- A channel view uses `post.title`, falling back to root `title` when that is empty.

### The one invariant

- `project(record, primary_id)` fills the projected root fields from `posts[primary_id]`, or defaults when there is no such post.
- `unproject(record, primary_id)` moves them back into `posts[primary_id]` and strips them for storage. It creates the post only when a projected value is non-default or the post already exists.
- `_load` projects and `_persist` unprojects.
- **Any write that changes `posts[primary_id]` directly re-projects before persisting**, or `unproject` would overwrite it with the stale root. Put this in one helper (`with_post(record, channel_id, post, primary_id)`) and use it everywhere.
- The primary is read once per operation (`_iter_records` resolves it once, not per record).

## Models (`schemas.py`)

```python
class PostPublished(BaseModel):   # extra="forbid"
    url: Optional[str] = None
    id: Optional[str] = None       # YouTube video id, derived from url when absent
    at: Optional[str] = None       # ISO-8601

class Post(BaseModel):            # extra="forbid"; one model for every platform
    title: str = ""                # youtube
    description: str = ""          # youtube
    short_description: str = ""    # youtube
    tags: list[str] = []           # youtube
    caption: str = ""              # tiktok, instagram
    text: str = ""                 # linkedin, x
    hashtags: list[str] = []
    cover: Optional[str] = None    # one of thumbnail.candidates
    language: Optional[str] = None # null = the channel's language
    localized: dict[str, LocalizedFields] = {}   # youtube
    published: PostPublished = PostPublished()
    hidden: bool = False

class PostPatch(Post):            # every field Optional; only model_fields_set applies
```

- `AuthoredFields.posts: dict[str, Post] = {}`.
- `RecordPatch.posts: Optional[dict[str, Optional[PostPatch]]]`.
- `SystemFields.schema: int = 1`; the store always writes `2`.
- `test_library_record_contract.py`:
  - `posts` is authored and `schema` is system.
  - Add a pinned `PROJECTED_FIELDS` set (the table above) and assert that no projected field appears at the root of a persisted `record.json`.

## Upgrade (`backend/library/record_upgrade.py`, pure)

`upgrade_record(raw: dict, primary_id: str) -> dict`: a dict with no `schema` (or `schema == 1`) becomes schema 2.

- **Moved** into `posts[primary_id]`:
  - root `description`, `short_description`, `tags`, `hashtags`, `localized`
  - `thumbnail.cover` → `cover`
  - `publish.youtube` → `published` (`videoId` → `id`, `url`, `publishedAt` → `at`)
- **Copied:** root `title` → the post's `title` (root kept).
- **Kept:** `shorts.caption` stays at the root, untouched (a legacy value PR 3 offers as "Start from Shorts caption").
- **When to create the post:** only when at least one moved or copied value is non-default. A record with an empty title and nothing else gets no post.
- Pure and idempotent: a schema-2 dict is returned unchanged. The input is never mutated.
- **Backup:** `_persist` checks the file currently on disk. When it has no `schema` and `record.v1.json` does not exist beside it, it copies the file to `record.v1.json` first, once. Reads never write.

## Merge (`backend/library/store_posts.py` mixin + pure helpers)

- **`PATCH /api/library/{id}` with `posts`** merges per channel and per field under the store lock (the `localized` precedent, including the fresh re-read in `locked_refusal`):
  - an omitted channel is kept, and `{channel: null}` removes that post
  - within a post, sent fields replace and omitted ones are kept
  - `localized` inside a post merges per language, like root `localized`
- **Unknown channel id** in `posts` → 422 violation `{field: "posts.<id>", rule: "unknown_channel"}`.
- **Ambiguous patch:** sending a projected root field *and* the same field under `posts[primary]` in one patch is a 422 `ambiguous_post_field`.
- **History:** one entry per changed channel, `field: "posts.<id>"`.
- **No-op:** a patch that changes nothing doesn't bump `rev`.
- **YouTube `published.url`** without an `id` → the id is derived from the URL (reuse or move the MCP's `youtube_id_from_url` logic into the backend, one copy).
- **`record.publishedAt`** = the earliest `published.at` over visible posts, else unchanged legacy behaviour.
- **Covers:**
  - `post.cover` must be one of `thumbnail.candidates` (the existing `cover_not_a_candidate` rule, applied per post)
  - deleting a frame clears it from **every** post that uses it
  - an uploaded frame becomes the primary post's cover (today's behaviour through the projection)

## Validation (`backend/library/validate_posts.py`)

- **YouTube post:**
  - build the channel view (`record_for_channel(record, channel_id)`: the record with the projected fields and title taken from that post)
  - run today's `hard_violations` / `validate_record` over it with that channel's brief view (`brief_from_channel(channel)`, under the record's collection via `effective_brief`)
  - readdress each finding's `field` to `posts.<id>.<field>`
  - for the primary channel through root writes, keep today's root names (the existing tests pin them)
- **TikTok / Instagram / LinkedIn / X:** limits from `platforms.py` (import the numbers, never restate them).
  - Measured on the **pasted text**: `body` + (`"\n\n"` + the hashtags line when there are hashtags). The line is `package.hashtags(channel.profile.default_hashtags, post.hashtags)` joined by spaces.
  - Findings: `posts.<id>.caption` / `posts.<id>.text` (`<platform>_max_chars`, hard), `posts.<id>.hashtags` (instagram > 30 hard; tiktok > 5 style; linkedin < 3 or > 5 style), instagram mentions > 20 hard, instagram URL in the caption style.
- **Field on the wrong platform:** a non-empty field the platform doesn't have (a TikTok `title`, a YouTube `caption`, `localized` off YouTube) → hard `field_not_on_platform` under `posts.<id>.<field>`.
- **Hidden posts** are skipped by status, search, `recent_posts` and the record-wide validate, but still validated when written.
- **`POST /validate`** accepts `channel` (with `video_id`): it judges that channel's post (the body's `fields` are that post's draft fields). Without `channel` it behaves as today.

## Package and publish state

- **`GET /{id}/package?channel=<id>&lang=`:**
  - A YouTube channel renders today's layout from `record_for_channel` + `brief_from_channel(channel)`.
  - Any other channel answers `{channel, platform, text, violations, description: null}`, where `text` is the pasted text above.
  - No `channel` means the primary channel, byte-identical to today.
  - `channel` with `platform` → 422.
  - `platform=` keeps working unchanged in this PR (the renderer still calls it; PR 3 removes it).
  - An unknown channel → 404. A channel the video has no post for → 404 `no_post`.
- **Published:** no new route. `PATCH posts: {<id>: {published: {url}}}` is the write, with `If-Match` like every record write. The root `publish.youtube` projection keeps today's writers working.

## Derived state

- **`status`:** `published` ⇐ any visible post with `published.url` or `published.id`; `drafted` ⇐ any visible post with a non-empty `description`, `caption` or `text`. The rest of the ladder is unchanged.
- **Search index text:** root `title` + every visible post's title/description/caption/text + tags/hashtags/keywords.
- **List summary** gains the derived `publishedOn: [channel ids]` (visible posts with a published url or id). `cover` stays the primary post's cover.

## Channels

- **Deleting a channel** that any record (scratch included) has a post for → 409 `{reason: "channel_in_use", detail, posts: <count>}`. This supersedes PR 1's "any non-primary channel may be deleted". `channel_is_primary` is still checked first.
- **`GET /api/library/channels/{id}?include_recent_posts=true&limit=10`** adds `recent_posts`. They are the channel's latest visible published posts across the library, newest `published.at` first: `[{video_id, title, text, hashtags, url, at}]`, where `text` is description/caption/text truncated to 500 chars. The default is false, so the key is absent without the flag. `limit` runs 1–50.

## Import

`POST /api/library` (`CreateVideoRequest`), `POST /import-paths` and `POST /import-folder` accept an optional `channels: [id]`.
- A **newly created** record gets an empty post per id.
- An **existing** record (a fingerprint hit or relink) is left alone.
- An unknown id → 422 `{reason: "unknown_channel", detail}` before anything is imported.
- The watch folder and the agent's `load_video` send none.

## MCP (tool count stays 61)

- **`get_video`** returns `posts` (it passes the record through; document it).
- **`set_video_meta`** documents `posts`:
  - per-channel, per-field merge; send only what you change
  - `null` removes a post, while `hidden: true` hides it and keeps the text
  - root fields are the primary channel's post
  - one channel per call is fine
- **`validate_video(video_id, lang=None, channel=None)`**, **`get_upload_package(video_id, platform="youtube", lang=None, channel=None)`**: `channel` and a non-default `platform` together are refused client-side.
- **`mark_published(video_id, url, channel=None)`**: with a channel it writes `posts.<channel>.published`, and without one it keeps today's root write.
- **`get_channel(channel_id, include_recent_posts=False, limit=10)`:** the docstring says to set it **only when the user explicitly asks** to take inspiration from older videos.
- **Guide:** update `publish_guide/channels.md` (posts per channel, `recent_posts` opt-in), `workflow.md`, `localized.md`, `shorts.md`, `batch.md` where they name root fields. Keep the root-field wording valid, since it's the primary channel.
- **Skill `mcp_server/skills/capforge-publish/SKILL.md`:**
  - for each channel the video has a post for, call `get_channel` first and treat `context` as the style reference
  - never write a post for a channel whose context wasn't read in the session
  - write with `set_video_meta` `posts`
  - **never pass `include_recent_posts` unless the user asked for inspiration from older videos**
  - `test_bundled_skills.py` pins that the skill text contains that rule and names `get_channel`
