# v3.0 4s (part 1) — Collections: brief overrides + description template slots

**Status:** planned 2026-09-15 on `feat/v3-collections` (stacked on `feat/v3-folder-import`, PR #37). Plan row: creator-hub-vision §7 **4s**, exit test "a 40-session event regenerates its footers in one pass"; dossier §2.4 "Collections / events"; brief §3.2; decision **D2** (global brief + per-collection overrides, general enough for any channel).

## Why

A conference is forty videos sharing most of their boilerplate: recorded-at line, sponsor footer, speaker-block format, hashtags, feedback URL, playlist link. Today the brief is one global file, so an event's boilerplate either pollutes the channel brief or gets pasted into forty `description` fields. Pasted copies can't be updated when a sponsor line changes.

`collection_id` already exists on every record (authored, settable by `set_video_meta`, filterable by `list_videos`), but it names nothing.

## Decisions (made here, not open)

1. **A collection is a small entity** (`id`, `name`, `slots`, `overrides`, timestamps) stored in one file, `<library_root>/collections.json`, written atomically under the store's `write_lock`. There are few collections, and they are edited by one person or one agent at a time. Like the brief, there is **no `If-Match`**. A `PATCH` merges top-level fields, and `overrides` merges **per field**. An override set to `null` means "inherit the channel".
2. **Overrides live on the collection, never on the video** (vision §2.4). Every `Brief` field can be overridden. A list or block override **replaces** the channel's value (`default_hashtags`, `link_rows`, `house_rules`, the "a list patch is the new list" rule). `slots` are the exception: they merge **key-wise** over the channel's slots, because an event adds variables rather than restating the channel's.
3. **The package is rendered at read time from the record plus the effective brief.** That is how "regenerates its footers in one pass" is met: nothing is stored per video, so changing a collection's footer changes every member's package on the next `get_upload_package`. No bulk-write tool, no stored copies (tier rule §3.5: no tool mutates more than one video).
4. **Template slots.** `Brief.description_template` (channel-wide, overridable) lays out the DESCRIPTION block with `{{slot}}` placeholders. It is empty by default, and **empty means today's layout, byte-identical**: the built-in default template reproduces `_description_section`'s current order and blank-line joining, and the existing package tests are the proof. Built-in slots:
   - `description`, `title`, `short_description`
   - `recorded_at`, `highlights` (the "WHAT YOU'LL LEARN" block), `chapters` (the "CHAPTERS" block), `links` ("LINKS"), `speakers` (the speaker blocks), `footer`, `hashtags`
   - `channel`, `collection` (the collection's name, empty with none)

   Custom slots come from `Brief.slots` merged with `Collection.slots`. Slot names match `^[a-z][a-z0-9_]{0,31}$` and may not shadow a built-in (422).
   - **Slots also expand inside `footer` and `recorded_at_line`** (e.g. `Recorded at {{event}}, {{city}}`). Expansion is one pass: a slot's value is never re-expanded, so there is no recursion and no injection loop.
   - **An empty slot's line collapses**: the result runs of more than one blank line are squeezed to one, and the text is stripped.
   - **An unknown slot is never shipped silently**: it stays verbatim in the text, is listed under NOTES, and is reported as a violation (field `package.description`, rule `unknown_slot`, severity `hard`). It does not block `set_video_meta` writes, because it is a brief/collection problem, not a record field.
   - `speaker_block` keeps its own per-speaker `{{name}}/{{handle}}/{{url}}` and is untouched.
5. **The assembled description is validated.** Today `description_max_bytes` and the angle-bracket rule only run on the record's `description` field, but the pasted text adds the recorded-at line, highlights, chapters, links, speakers, footer and hashtags. The package route now also runs both rules on the **assembled** DESCRIPTION body (field `package.description`, rules `description_max_bytes` / `angle_brackets`). A long collection footer is exactly what would push a video over 5000 bytes.
6. **Membership stays `record.collection_id`.** `PATCH /api/library/{id}` with a `collection_id` that names no collection answers `422 {violations: [{field: "collection_id", rule: "unknown_collection", …}]}`; `null` is always allowed. Records that already carry a dangling id stay readable and are listed as **orphans** (`GET /collections` → `orphans: [{id, members}]`), so the UI and the agent can adopt them by creating a collection with that exact id.
7. **Collection ids** match `^[a-z0-9][a-z0-9-]{0,63}$`. When `id` is omitted on create it is slugified from `name`, with `-2`, `-3`… on a clash. An explicit id that is taken is `409`.
8. **Delete refuses a collection with members** (`409 {reason: "collection_in_use", members}`). Emptying one is a per-video `collection_id: null` write, visible and revertable, never a bulk side effect.
9. **Not in this change:** the Shorts, thumbnail and localized editors, `grab_frames`, the thumbnail strip, per-language packages, non-YouTube formatters and the Transcript tab (the rest of 4s). Also out: a per-video escape hatch (vision: "if ever wanted it is one named field, with a reason"), and pushing to Update-conf.

## Backend

### `backend/library/collection_store.py` (new; deliberately not `collections.py`, which would shadow the stdlib `collections` module whenever the package folder lands on `sys.path`)
- `SLOT_NAME_RE`, `COLLECTION_ID_RE`, `COLLECTIONS_FILE = "collections.json"`, `BUILTIN_SLOTS: frozenset[str]` (named constants).
- `BriefOverrides` (pydantic, `extra="forbid"`): every `Brief` field except `slots` as `Optional[...] = None`.
- `Collection` (`extra="forbid"`): `id`, `name` (1..120 chars), `slots: dict[str, str]`, `overrides: BriefOverrides`, `createdAt`, `updatedAt`.
- `CollectionCreate` and `CollectionPatch` request models: patch has `name?`, `slots?` (replaces the collection's slot dict), `overrides?` (merged per field over the stored overrides, using `model_fields_set` so an absent field is untouched and `null` clears).
- Store-level functions taking the `LibraryStore` (or methods on the store's admin mixin, whichever keeps `store.py` from growing; it is 465 lines): `list_collections`, `get_collection`, `create_collection`, `patch_collection`, `delete_collection`, `members_of(collection_id) -> int`, `orphan_collection_ids() -> list[{id, members}]`. Every write goes under `write_lock`. A corrupt `collections.json` is an error (500 with the parse message), never silently reset (the brief's rule). A missing file is empty.
- `effective_brief(brief: Brief, collection: Optional[Collection]) -> Brief`: the pure override merge from decision 2.
- Errors: `CollectionNotFound` (404), `CollectionExists` (409), `CollectionInUse(members)` (409).

### `backend/library/template.py` (new, pure)
- `DEFAULT_DESCRIPTION_TEMPLATE`: the built-in layout.
- `render_template(template: str, slots: Mapping[str, str]) -> Rendered` (frozen dataclass: `text`, `unknown: tuple[str, ...]`): one-pass `{{name}}` substitution (whitespace inside the braces is tolerated: `{{ event }}`), blank-line collapse, strip. A `{{` with no valid name is left alone and is not reported.
- `validate_slot_names(slots)`: raises `ValueError` for a bad or built-in-shadowing name.

### `package.py` changes
- `_description_section` builds the slot map: the built-in blocks it already renders, plus `Brief.slots` merged with `Collection.slots`. It then expands custom slots inside `footer` and `recorded_at_line` first, and renders the effective `description_template` (or `DEFAULT_DESCRIPTION_TEMPLATE`).
- `render_youtube_package` gains `collection: Optional[Collection] = None` (for `{{collection}}` and slot merging). It keeps its return type, and a new `package_violations(...)` returns the assembled-description findings from decisions 4 and 5. Unknown slots also go into NOTES.
- **Byte-identity:** with an empty template and no slots, every existing `test_library_package*.py` assertion passes unchanged. Do not edit those expectations.

### `brief.py`
- `Brief` gains `description_template: str = ""` and `slots: dict[str, str] = {}`, with names validated by `validate_slot_names`. `BriefPatch` follows. `validate.py`'s style rules take the **effective** brief.

### Routes: `backend/library/router_collections.py` (new, registered by `build_router` **before** `/{video_id}`)
All sit behind the router's existing actor guard. Every request model is `extra="forbid"`.
- `GET /api/library/collections` → `{collections: [Collection & {members}], orphans: [{id, members}]}`
- `POST /api/library/collections` `{id?, name, slots?, overrides?}` → `201` collection & `{members}`; `409 {reason:"collection_exists"}`; `422` for a bad id or slot name.
- `GET /api/library/collections/{cid}` → collection & `{members, effective_brief}`; `404`
- `PATCH /api/library/collections/{cid}` → same shape as GET; `404`, `422`
- `DELETE /api/library/collections/{cid}` → `204`; `409 {reason:"collection_in_use", members}`; `404`
- `GET /api/library/{id}/package` resolves the record's collection (an orphan id means no collection) and merges `package_violations` into its `violations`.
- `POST /api/library/validate` accepts an optional `collection_id` (unsaved panel drafts) and uses the effective brief. With a `video_id` and no `collection_id`, the record's own collection is used.
- `PATCH /api/library/{id}` refuses an unknown `collection_id` with the `422 {violations}` shape (decision 6).

### Tests (write first)
- `test_library_collections.py`: CRUD, slug derivation and clash suffix, explicit-id clash, the per-field override merge with `null` clearing, key-wise slot merge, the list/block replace semantics of `effective_brief`, corrupt file → error, orphans and member counts, delete with members refused, writes under the lock (reuse the forced-interleaving pattern from `test_library_store_lock.py` for one create against one patch).
- `test_library_template.py`: one-pass substitution (a slot value containing `{{x}}` is not re-expanded), whitespace in braces, blank-line collapse, unknown slots reported, malformed braces ignored, bad and shadowing slot names.
- `test_library_package_collections.py`:
  - The default template is byte-identical to today on the existing fixtures.
  - A collection footer with `{{event}}` renders into every member's package, and **changing the collection changes the package with no record write**. This is the exit test, over several records.
  - An unknown slot → NOTES + violation.
  - The assembled description over 5000 bytes → `package.description` violation, with the record's own `description` still under the limit.
- Route tests for every status code above, plus the `PATCH` unknown-collection 422 and orphan adoption (create with the orphan's id → it disappears from `orphans`).
- `test_library_record_contract.py` stays unchanged: no new record field.

## MCP (`mcp_server/collection_tools.py`, a `TOOLS` tuple like `library.py`; the same stdlib-shadowing reason rules out `collections.py`)
- `list_collections()`, `get_collection(collection_id)` (includes `effective_brief` and `members`), `set_collection(collection_id, name=None, slots=None, overrides=None)` (upsert: create when missing, which needs `name`; otherwise PATCH), `delete_collection(collection_id)`. Client methods go in `client.py`, errors mapped like `library_errors.py` (409 in use → a sentence naming the member count and how to move videos out).
- Tool count 52 → **56**: `EXPECTED_TOOL_COUNT`, README tools table, CLAUDE.md MCP paragraph.
- `publish_guide/`:
  - A new `collections` topic: setting up an event, template slots, "write only this video's paragraph", adopting an orphan id.
  - `batch.md`: read `get_collection` once per collection instead of `get_brief`; regenerating footers means re-reading packages, never rewriting descriptions.
  - `description.md`: slots and the effective brief.
  - `workflow`: mention `collection_id`.
  - `batch_publish(status, collection?)` prompt: the new optional argument.
  - INDEX lists the topic. `test_publish_guide.py` drift test passes; field names go in `NOT_TOOLS` as needed.
- `mcp_server/skills/capforge-publish/SKILL.md`: one short section on collections (read `get_collection` when the video has `collection_id`; never paste boilerplate the template renders). `test_bundled_skills.py` passes.
- Tests: tool registration and count, the upsert's create-vs-patch branch, error mapping. Run with `uv run --no-project --python 3.12 --with pytest --with pydantic --with fastapi --with httpx --with 'mcp<2' python -m pytest mcp_server/tests -q`.

## Renderer
- `lib/collectionTypes.ts`: `Collection`, `CollectionSummary` (+members), `CollectionsList` (+orphans), `CollectionDetail` (+effective_brief), and boundary guards. `Brief` in `lib/publishTypes.ts` gains `description_template` + `slots` (guard defaults `''` / `{}`).
- `lib/collectionsApi.ts` (new sibling; `api.ts` is past its ceiling): the five calls through `api.sendWithLocalToken`, with 409 reasons mapped to typed errors like `libraryApi.ts`'s `RelinkRefusedError`.
- `lib/collections.ts` (pure):
  - `overriddenFields(overrides)`, for "Uses 3 overrides".
  - `slotNameProblem(name)`, an inline hint only; the backend is the authority.
  - `BUILTIN_SLOTS`, a display copy pinned to the backend by a shared fixture `backend/tests/fixtures/builtin_slots.json` asserted from both sides.
  - `slugPreview(name)`, a display hint only.
- **Settings → Collections** (new category in `SettingsDialog.tsx`, `components/settings/CollectionsSettings.tsx`, split as needed to stay under 400 lines):
  - A list with member counts, and orphans shown as "N videos use `uck26` — Create collection".
  - Create by name.
  - An editor with: name; slots (key/value rows); the override fields, each with an "Inherit from channel" toggle whose value editor reuses the Channel pane's field components (extract them from `BriefSettings.tsx` into a shared module rather than copying); the description template (textarea plus a chip palette of built-in and custom slot names that inserts `{{name}}`); a **preview** that picks a member video and shows its package DESCRIPTION through `GET /api/library/{id}/package`, including its violations.
  - Delete, disabled with the member count while it has members.
- **Settings → Channel:** `description_template` (same editor and palette) and channel-level `slots`.
- **Publish workspace:** a `CollectionCard` (select: None or each collection) writing `collection_id` through the existing immediate writer path, with provenance like every field, "Uses N overrides from X", and "Manage collections…" opening Settings on that category. Add the card id to `PUBLISH_FIELDS`/`PublishCardId`.
- **Library screen:** a collection filter in the toolbar (All / each collection / No collection; client-side over the loaded list, pure `filterByCollection` in `lib/libraryView.ts`), and a small collection chip on the card.
- Tests (node env, static markup): the guards, `collections.ts`, the fixture pin, `CollectionsSettings` markup (list, orphan row, inherit toggles, delete disabled), `CollectionCard` markup, `filterByCollection`, and the Channel pane's new fields.

## As built — deviations and additions

- **Module names:** `backend/library/collection_store.py` and `mcp_server/collection_tools.py`. A module named `collections` shadows the stdlib one whenever its folder lands on `sys.path`.
- **Where things live:** `BUILTIN_SLOTS` is in `template.py` (re-exported from `collection_store.py`), because `brief.py` needs it and importing it from the store would be a cycle. `package_violations` is in `validate.py`, not `package.py`, for the same reason: `validate.py` already imports `package.py`.
- **The package response** is `{platform, text, violations, description}`. `description` is the pasteable DESCRIPTION body alone, exactly what the `package.description` rules check. The Collections preview renders it and never scrapes `text` by its rule lines.
- **The assembled-description angle-bracket rule is `no_angle_brackets`**, the existing rule's name, not `angle_brackets`.
- **Blank-line collapse is narrower than decision 4 says:** only blank lines left by an *empty slot* are squeezed. Blank lines the author typed, or inside a value, are kept, because collapsing every run would have changed today's packages and broken the byte-identity promise.
- **Slots inside `footer` / `recorded_at_line`** may use every slot except `footer` and `recorded_at` themselves (reported as unknown there), which is what rules out recursion. Unknown slots and speaker placeholders are reported only for text the template actually prints.
- **Scratch records** count as neither members nor orphans.
- **Slugs skip orphan ids:** a collection created without an explicit id never slugs onto an orphan's id, so adopting an orphan always takes an explicit id.
- **A `PATCH` that re-sends the dangling id a record already holds** is a no-op and is allowed.
- **Validate with an explicit unknown `collection_id` answers 404.**
- **The record `PATCH` repeats the collection check under `write_lock`**, just before the write, so a video can't join a collection that is being deleted.
- **When the record's own `description` breaks a rule,** both `description` and `package.description` findings are reported.
- **"Manage collections…"** opens Settings on the Collections category through `lib/settingsNavigation.ts` (SettingsDialog is always mounted and subscribes), so `App.tsx` did not grow. The Brief field editors were extracted to `components/settings/BriefFields.tsx` and are shared by the Channel pane and the Collections editor.

## Nesting (added by docs/plans/library-finder.md §2)

Collections nest, and the UI calls them **folders**; the backend, the routes, the MCP tools and `collection_id` keep "collection".

- **Stored shape:** `Collection`, `CollectionCreate` and `CollectionPatch` gain `parent_id` (`null` = top level). On a `PATCH`, a sent `null` moves to the top level and an omitted key leaves it where it is. `collections.json` stays `version: 1`, and a top-level row is written without `parent_id`, so a file that does not nest is byte-for-byte the old shape an older build can read. A file that does nest is unreadable to an older build, whose `Collection` forbids unknown keys.
- **Integrity, under the store's write lock** (`collection_tree.py`), in this order:
  1. `parent_id` names no collection: 422 `unknown_parent`.
  2. The collection itself or one of its descendants: 422 `collection_cycle`.
  3. Deeper than `MAX_COLLECTION_DEPTH` (8): 422 `collection_too_deep` with `max_depth`. A top-level collection is depth 1, and a move is judged by the depth its deepest descendant would land at.

  Re-sending the current parent is not a move and is never judged. A hand-edited file with a dangling or looping `parent_id` is `CollectionsUnreadable` (500), never flattened.
- **Delete** answers `collection_in_use` (members) **first**, unchanged, then 409 `collection_has_children` with `children` (direct subfolders), so a client that predates nesting meets the refusal it knows first.
- **Inheritance, one seam:** `resolved_collection(collections, id)` folds the ancestor chain, top level first, into one `Collection`: slots merge key-wise (the deeper value wins), each override is the deepest non-null value (`null` inherits through any number of levels), and identity fields are the leaf's. Unknown and `None` ids resolve to `None`. `router_publish.read_collection` (injected into `post_drafts.py`), `_requested_collection` and `router_collections._detail` call it; `effective_brief` and the package, platform-post and validator call sites are unchanged. A top-level collection resolves to itself, so every package expectation above holds byte-identically.
- **Routes:** `GET /collections` stays flat. Every collection answer adds `parent_id`, `path` (names from the top level, itself last) and `total_members` (itself plus every descendant). The detail's `effective_brief` is resolved, while its `slots` and `overrides` stay the collection's own. `GET /api/library?collection=` is still direct members only.
- **MCP:** `set_collection(parent_id=…)` moves or creates under a folder, `""` moves to the top level (MCP arguments cannot tell omitted from `null`), `None` leaves it. The nesting 422s and `collection_has_children` come back with their `reason` and a next step.
- **Settings → Folders:** the tree is indented (`lib/collectionTree.ts`: `buildTree`, `flattenTree`, `ancestorsOf`, `descendantIds`, `canMoveInto`, `moveTargets`, `pathLabel`). The editor gains a **Location** select (Top level plus every folder it may move into, labelled by full path), an inherited field names its source ("From Events › UCK 2026"), delete is disabled while a folder holds videos or subfolders, and a refused move or delete is shown under its control.

## Verification

- **Backend:** 1780 passed; the only failures are the 15 known macOS `test_render_golden.py` deltas. The library tests pass, including the new `test_library_template.py`, `test_library_collections.py`, `test_library_package_collections.py` and `test_library_collections_routes.py`. Existing package test expectations are unchanged (the byte-identity proof).
- **MCP:** 245 passed (`EXPECTED_TOOL_COUNT` 56; guide drift and bundled-skill tests included).
- **Renderer:** 1831 passed, typecheck clean, lint 0 errors. Electron: 26/26.
- **Live, on a temp `CAPFORGE_HOME` with the app's Python and real ffmpeg clips:**
  - `collection_id: "uck26"` before the collection existed: 422.
  - Create `uck26` with slots `event`/`sponsor` and a footer `Recorded at {{event}} - thanks to {{sponsor}}`, then three records join it.
  - All three packages end "thanks to Acme", with record revs 2 2 2.
  - `PATCH` the sponsor slot to Globex: all three packages end "thanks to Globex", and the revs are **still 2 2 2**. This is the exit test: no per-video write.
  - A `{{typo}}` in the footer is printed as written with an `unknown_slot` violation on every member.
  - Delete with 3 members: 409. A custom slot named `title`: 422.
- Backend library tests + full suite (the 15 known golden-frame failures), mcp tests, `npm run typecheck`, `npm test`, `npm run lint`.
- Live, on a temp `CAPFORGE_HOME`: three records in collection `uck26` with a footer `Recorded at {{event}} — thanks to {{sponsor}}`. Read all three packages, `PATCH` the collection's `sponsor` slot, re-read all three (changed, no record rev bumped), add an unknown `{{typo}}` (violation + NOTES), push the footer past 5000 bytes on one video (`package.description` violation), try to delete with members (409), and set `collection_id: "nope"` (422).
