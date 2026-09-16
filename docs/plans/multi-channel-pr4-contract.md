# Multi-channel PR 4: import checklist, "Start from…", and dropping `platform=`

Companion to [multi-channel-publish.md](multi-channel-publish.md) §4.2, §5 and §7, finishing the work [PR 1](multi-channel-pr1-contract.md) (channels), [PR 2](multi-channel-pr2-contract.md) (posts) and [PR 3](multi-channel-pr3-contract.md) (tabs) shipped in #45–#47.

**Exit:**
- Dropping two videos onto the library asks once which channels they publish to, and both records come back with a post per ticked channel.
- An empty Instagram tab offers "Start from…", and picking the YouTube tab fills the caption without saving anything until the user edits or the autosave fires.
- `GET …/package?platform=` no longer exists, and the YouTube package is still **byte-identical**.

## Part A — "Start from…"

### Backend: `POST /api/library/{video_id}/posts/{channel_id}/draft?from=<source_channel_id>`

Renders adapted text and **never stores it**: no write, no `rev` bump, no history. Registered with the publish routes (before the `/{video_id}` record routes), beside the existing `/{video_id}/frames` and `/{video_id}/relink` POSTs.

- **Resolution and refusals**, reusing `publish_channels.py`:
  - both channels through `require_channel` → 404 for an unknown id, 500 for an unreadable `channels.json`
  - a `from` the record has no post for → 404 `{reason: "no_post", detail}` (`REASON_NO_POST`, `NO_POST_DETAIL`)
  - the target channel likewise (a tab always has a post; this keeps the two symmetrical)
  - `from == channel_id` → 422, with a sentence saying a tab cannot start from itself
- **The source view:**
  - a YouTube source is `record_for_channel(record, from)` — the renderers read `title`, `description`, `short_description`, `hashtags`, `chapters` and the video URL, which that view supplies
  - a non-YouTube source is the same view with its body mapped onto the fields the renderers read: `description` = that post's `caption`/`text` (`body_field`), `short_description` = `""`, `hashtags` = the post's own
- **The target decides the shape:**
  - **non-YouTube target:** `render_platform_post(view, brief_from_channel(target), target.platform, collection=…)`, then split its text: the trailing hashtag line becomes `hashtags`, everything above it becomes the body. The channel's `profile.default_hashtags` must **not** be baked into the body — `pasted_text` adds them at paste time, and doubling them is the bug this split exists to prevent.
  - **YouTube target:** no package rendering. `description` = the source body, `short_description` = the source's short description (or `""`). `title` is never copied: a tab's title is its own, and the primary tab's is the library name.
- **Answer:** `{channel, from, platform, fields: {…}}`, where `fields` holds only that platform's writable body fields plus `hashtags`.
- Findings are **not** returned: the text is a draft the user has not accepted yet, and `POST /validate` judges it once it lands.

### Renderer

- **`lib/postsApi.ts`:** `draftPostFrom(videoId, channelId, fromChannelId)`, parsed through a guard like the other calls there.
- **`lib/publishStartFrom.ts` (pure, tested):**
  - `startFromOptions(record, tab, channels)` — the visible posts with a non-empty body, minus this tab, each labelled by channel name and platform
  - plus the **legacy Shorts caption** when the target is TikTok or Instagram and `record.shorts.caption` is non-empty (PR 2 deliberately left it at the record root; no tab claims it)
  - `startFromPatch(fields, platform)` — the post draft a chosen option becomes
- **`components/publish/StartFromStrip.tsx`:** shown in `ChannelSection` above the cards **only** when this tab's body field is empty and at least one option exists. Picking an option fetches (or takes the local Shorts caption) and writes through `view.setField`, so it lands as an ordinary draft the user can edit or undo before the debounced save. Failures are toasted through `channels.notify`, never swallowed.
- `ChannelSection` has no empty state today (a fresh tab shows placeholders), so this is an addition, not a rework: the cards themselves do not change.

## Part B — remove `platform=`

PR 3 moved the footer to per-tab copying, so the old platform path is now dead weight. **The YouTube package must stay byte-identical**; do not edit an existing YouTube package expectation to make anything here pass.

- **Backend `router_publish.py`:** `get_package` loses its `platform` parameter, the `platform_package` branch and the `channel`+`platform` 422 (`CHANNEL_WITH_PLATFORM`). No `channel` still means the primary channel's package.
- **`platform_package.py`** loses its only caller and goes with it (`PACKAGE_PLATFORMS`, `unsupported_platform_detail`). **`platform_posts.py` stays** — it is now Part A's renderer, and its own tests (`test_library_platform_posts.py`) keep their expectations unchanged.
- **`test_library_platform_routes.py`** is rewritten against the draft route: the same three platforms, now reached as "start an Instagram post from the YouTube tab".
- **Renderer:** `api.getUploadPackage(id, lang?)` drops `platform` (its one caller, `CollectionPreview.tsx:63`, already passes none). Delete the exports of `lib/publishPlatforms.ts` that have **zero** non-test uses since #47 — `PUBLISH_PLATFORMS`, `DEFAULT_PUBLISH_PLATFORM`, `isPublishPlatform`, `copyButtonText`, `copyButtonTitle`, `copiedWhat`, `packageCopiedToast` — with their tests; keep the `channel*` helpers the footer uses and whatever `publishTypes.UploadPackage` still needs.
- **MCP:** `get_upload_package(video_id, lang=None, channel=None)` drops `platform` and `SUPPORTED_PLATFORMS`; the docstring explains that a channel names its platform. Update `publish_guide/workflow.md` and `channels.md` wherever they show `platform=`, and the tool tests. Tool count stays **61**.

## Part C — the import "Publish to:" checklist

The backend already takes `channels: [id]` on `POST /api/library` (`CreateVideoRequest`), `import-paths` and `import-folder`, refusing an unknown id with 422 `unknown_channel` before importing anything.

### Where the ask goes — two places, not one

1. **Batch imports** (a drop of folders / several files / `.capforge`, and "Import…"): both funnel through `hooks/useLibraryActions.ts` `runImport(plan)`, which is entered once per batch and makes **no HTTP call** until `executeImportPlan`. The ask goes there, between `importPlan(picked)` and `executeImportPlan`, and the chosen ids ride into every request body.
2. **Single-media paths** (one media file dropped on the library, "Add video", the drop screen): no record exists until Start — the drop only sets `filePath`. The ask belongs on the Start path, with the ids passed **into** `ensureRecordFor`.
   - **Never inside `ensureRecordFor` itself:** the agent's `load_video` and a project restore both call it and must stay channel-less (§4.2). Pass channels down from Start instead.
   - `App.tsx` is at 601 lines and **must not grow**, so this lives in a hook (extend `useLibrarySession`, or a small `useImportChannels`), with `App.tsx` net-zero.

### Backend gap to close

`POST /api/library/import-project` (`router_admin.py`) is the one create route with no `channels` parameter. Add it, with the same `unknown_channel` refusal — otherwise a mixed batch (media + a `.capforge`) applies the user's choice to some of its records and silently not to others.

### Clients

`api.createLibraryRecord(path, channels?)`, and in `lib/libraryApi.ts` `importLibraryFolder(…, channels?)`, `importLibraryPaths(paths, channels?)`, `importLibraryProject(path, channels?)`. An empty choice sends **no** `channels` key at all, so the request is byte-identical to today's.

### The sheet

- **Lift PR 3's `PublishToChecklistView`** (`components/publish/PublishToChecklist.tsx`) into a shared `ChannelChecklist`, used by both PR 3's empty Publish state and the new sheet. Its header comment already says the remembered choice arrives here; delete that note as part of this.
- New `components/library/PublishToSheet.tsx`: scrim + `role="dialog" aria-modal="true"` + `useFocusTrap`, the `ShortcutOverlay` / `RenderProgressModal` precedent (there is no `Modal` primitive in `components/ui/`).
- Three outcomes: **Import** with the ticked ids, **Skip** (import with none), **Escape / scrim** cancels the whole batch — nothing is imported, and that difference must be obvious in the copy.
- The sheet loads its own `listChannels` + `listPlatforms`: nothing caches channels outside Settings and `usePublishChannels` (PR 3) refetches per entry.

### Remembering the choice

- `app-state` via `window.subforge.getState` / `setState` (`electron/app-state.js`, tmp+rename), new key `lastPublishChannels: string[]` — added to that file's documented key list, following the `lastOutputDir` shape.
- Pre-read **before** the sheet opens (it is async), written on confirm, including a deliberate empty choice.
- Ids that no longer exist in Settings are dropped at read time, so a deleted channel can never be silently re-imported into.

### Skipped entirely

- No channels in Settings → no sheet, import proceeds with none, and one line points at Settings → Channels (`requestSettingsCategory('channels')`).
- The watch folder and the agent's `load_video` send no channels; those records arrive with no posts, and Publish shows PR 3's checklist instead of tabs.

### Tests

- `lib/importChannels.ts` (pure): preselection from the remembered list, dropping unknown ids, what each outcome sends.
- `useLibraryActions`: the request bodies carry the ids (the existing `executeImportPlan` fake-`ImportRequests` pattern), and an empty choice sends no key.
- The sheet's static markup, and PR 3's empty Publish state still rendering from the shared checklist.

## Gates

`npm run typecheck`, `npm test`, `npm run lint` (0 errors), `pytest backend/tests`, and the MCP suite. Plus a live check that the draft route adapts a real YouTube post into an Instagram caption without writing to the record.
