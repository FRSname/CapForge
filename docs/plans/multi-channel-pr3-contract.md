# Multi-channel PR 3: Publish tabs

Companion to [multi-channel-publish.md](multi-channel-publish.md) §7 and §8 item 3, on top of [PR 1](multi-channel-pr1-contract.md) (channels) and [PR 2](multi-channel-pr2-contract.md) (posts).

**Exit:** write different YouTube and Instagram text for one video, copy each, restart, and both survive.

## Scope change: PR 3 is split

- **PR 3 (this):**
  - channel tab strip, per-channel cards, add / hide tabs, per-tab footer copy
  - the "Publish to:" checklist **inside Publish** for a video with no posts
  - `activeChannelId` in the mirror
- **PR 4 (next):**
  - the import-time "Publish to:" sheet (drop, Add video, Import…, remembered choice)
  - "Start from…" with its backend draft route
  - removing the package route's `platform=` and the old platform dropdown's last callers

## What the backend already gives (PR 2)

- `record.posts: {<channel_id>: Post}` on `GET /api/library/{id}`. `Post` has `title, description, short_description, tags, caption, text, hashtags, cover, language, localized, published {url, id, at}, hidden`.
- `PATCH posts` merges per channel and per field:
  - `{id: null}` removes a post
  - `{id: {hidden: true}}` hides it and keeps its text
  - `{id: {}}` creates an empty post, or un-hides a hidden one when sent `{hidden: false}`
- The root `description`, `short_description`, `tags`, `hashtags`, `localized`, `thumbnail.cover` and `publish.youtube` are the primary channel's post.
  - Sending one of them **and** the same field under `posts[primary]` in one patch → 422 `ambiguous_post_field`.
  - Root `title` stays the library name, and a root title write is bridged into the primary post.
- `GET /api/library/{id}/package?channel=<id>&lang=` renders one channel's post. A YouTube channel gets today's layout; any other answers `{channel, platform, text, violations, description: null}`.
- `POST /api/library/validate {video_id, channel, fields}` judges that channel's post. `fields` are the post's draft fields, and findings are named `posts.<id>.<field>`.
- A PATCH 422 for a post names `posts.<id>.<field>`.
- `GET /api/library/platforms` is the limits table (`lib/channelTypes.ts` `PlatformSpec`).

## The one rule for writes

**Every field on every tab writes `posts.<channel_id>.<field>`, with one exception: the Title on the primary channel's tab writes the root `title`.** That is the library name, which the backend bridges into the primary post. The UI never sends a projected root field, so it can never trigger `ambiguous_post_field`. Video-level fields (collection, chapters, shorts clips, thumbnail frames and ideas, speakers, summary, title options, keywords) keep writing their root fields, as today.

## Renderer plumbing (new modules, not in `usePublishRecord.ts` or `App.tsx`)

`usePublishRecord.ts` is at 399 lines and `App.tsx` at 602; **neither may grow**. Put the logic in:

- **`lib/publishPosts.ts` (pure), with tests.**
  - `parsePosts` / `parsePost`: boundary guards. Wire them into `parsePublishRecord` as `posts`.
  - `PostsDraft = Record<string, PostDraft | null>`: a **delta** of changed channels and fields, like `localized`.
  - `applyPostsDraft(posts, draft)` builds the display.
  - `composePostsPatch(draft, latest)` builds the wire. Inside a post, `localized` reuses `composeLocalizedPatch`.
  - `survivingPosts(draft, local, remote, locked)` is the soft lock **per channel and field**. An agent push replaces every channel/field the user isn't editing.
  - `visibleChannelIds(posts, channels)` gives tab order: the channels.json order, then any post whose channel no longer exists, labelled by its id.
  - Add `posts` to `PublishAuthored`, plus its special merge in `mergeDrafts` / `survivingDrafts` / `mergeAgentUpdate` (the `localized` / `thumbnail` precedent), and compose at send time in `usePublishWriter` beside `withLocalizedDraft`. Never send the whole `posts` dict from a draft.
- **`lib/platformSpecs.ts` (pure), with tests.** Metering only, no rulings.
  - `countUnits(unit, text)`: `chars` = code points, `bytes` = UTF-8, `utf16` = `.length`, `weighted` = X with each URL counting 23, `items` = list length.
  - `limitFor(specs, platform, field)`.
  - `bodyFieldFor(platform)`: `description` for YouTube, `caption` for TikTok/Instagram, `text` for LinkedIn/X.
  - `pastedText(body, hashtags, defaultHashtags)`: the same shape the backend measures (body + `"\n\n"` + hashtags line).
  - Violations still come only from the backend.
- **`lib/postsApi.ts`:** a sibling of `collectionsApi.ts`, through `api.sendWithLocalToken`.
  - `getChannelPackage(videoId, channelId, lang?)`
  - `validateChannelPost(videoId, channelId, fields)`
  - both parsed through guards
- **`lib/channelPublishView.ts` (pure), with tests.** `channelPublishController(publish, channel, specs, channelViolations)` returns a `PublishController`-shaped object for one tab, so existing cards work unchanged:
  - `fields`: the record as that channel's post, with drafts applied (projected fields and `title` from the post, falling back to the root title).
  - `setField(field, value)`: a projected field goes to `publish.setField('posts', delta)`; `title` goes to the root on the primary channel and to the post elsewhere; everything else is passed through.
  - `violationsFor(field)`: `posts.<id>.<field>` from the PATCH violations and the channel validation.
  - `beginEdit` / `endEdit` go through `'posts'`.
  - Provenance and revert read `posts.<id>` history.
  - `markPublished(url)`: `patchNow({posts: {<id>: {published: {url, at}}}})`, for any URL on non-YouTube platforms.
- **`hooks/usePublishChannels.ts`:**
  - loads channels + platforms (reuse `channelsApi`), refetching when the Publish workspace is entered
  - active tab: the last one used for this video, else the primary if the video has a post for it, else the first
  - debounced per-tab channel validation through `validateChannelPost`
  - exposes `addChannel(id)` / `hideChannel(id)` through `publish.patchNow`
- **Mirror:** `UiStateCore.activeChannelId: string | null` (the `workspace` precedent in `lib/uiStateMirror.ts` / `hooks/useUiStateMirror.ts`). The value comes from `usePublishWorkspace` or the channels hook without adding net lines to `App.tsx`.
  - Check the backend's `PUT /api/ui-state` model. If it forbids unknown keys, add the optional field there, plus a backend test, and mention it in the MCP `get_ui_state` docstring. That is the only backend/MCP edit allowed.

## UI (`components/publish/`)

- **`ChannelTabs.tsx`**, copying `TrackTabs.tsx`'s markup, keyboard handling (including `stopPropagation` on arrow keys) and roving tabindex:
  - one tab per visible post, with `PlatformBadge` + channel name and a published dot when `published.url` or `published.id` is set
  - `×` on a tab hides it, with no confirm
  - `+` opens a menu of Settings channels the video isn't on, hidden ones first as "Show again"
  - mounted under the Publish header (`PublishPanel.tsx`, between the header and the body)
- **The "Publish to:" checklist** (`PublishToChecklist.tsx`) replaces the tabs and tab section when the video has no visible posts:
  - Settings channels with badges, none ticked by default in PR 3 (PR 4 adds the remembered choice)
  - "Add" sends one `patchNow({posts: {<id>: {}, …}})`
  - with no channels in Settings, one line points to Settings → Channels, using the existing settings-navigation request
- **Tab section:** the active channel's cards, in order.
  - **YouTube:** TitleCard, DescriptionCard, a Tags card split so the tab shows **tags + hashtags** (keywords move to the video section), LocalizedCard, a cover picker (choose from the shared `thumbnail.candidates`, writing `posts.<id>.cover`), and PublishStateCard. All of these render against `channelPublishController`.
  - **TikTok / Instagram / LinkedIn / X:** `PostTextCard` (caption or text by platform, with a meter from `platformSpecs` and `FieldViolations`), a hashtags field, a cover picker (not for X), and the published link.
  - **Every tab:** a small language chip showing the channel's language or the post's override (`posts.<id>.language`, `null` = channel default).
- **Video section**, below the tabs, headed "This video":
  - CollectionCard, ChaptersCard, ShortsCard, ThumbnailCard (frames + ideas; the cover choice moves to the tab's picker), SpeakersCard, SummaryCard
  - keywords, and title options if they're not inside TitleCard
  - these keep the plain `publish` controller
- **Footer:**
  - the platform dropdown is removed
  - the copy button copies the **active tab's** package via `getChannelPackage`
  - labels: "Copy YouTube package", "Copy TikTok caption", "Copy Instagram caption", "Copy LinkedIn post", "Copy X post"
  - the language select stays for YouTube tabs
  - plain transcript and SRT/VTT are unchanged
  - the toast reuses `packageCopiedToast`'s wording and style
- A video with no posts disables the copy button, with a hint.

## Tests (vitest node env, static markup, no DOM events)

- **Pure `lib` tests:** `publishPosts` (parse, apply, compose, surviving per channel+field), `platformSpecs` (each unit: an emoji is 2 utf16 units, 1 char and 4 bytes; an X URL weighs 23), `channelPublishView` (routing of `setField` for projected fields vs primary `title` vs non-primary `title` vs video fields, violation readdressing), `postsApi` (mocked fetch, like `channelsApi.test.ts`).
- **Components:**
  - `ChannelTabs` markup: order, published dot, hide button, `+` menu with "Show again" first
  - `PublishPanel` renders the checklist for a record with no posts and tabs otherwise
  - an Instagram tab shows `PostTextCard` and no Description, Tags or Localized card
  - the footer label follows the active platform
- Update existing `PublishPanel.test.tsx` fakes for `posts`. Never weaken an existing assertion to make it pass.
- `uiStateMirror.test.ts`: `activeChannelId`.

## Gates

`npm run typecheck`, `npm test`, `npm run lint` (0 errors), and the backend and MCP suites if the ui-state model is touched.
