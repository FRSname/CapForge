# Library as a Finder: views, nested collections, selection

The library home screen today is a single card grid with a collection `<select>`, three overlapping "add" entry points (title-bar **Open**, **Add video**, **Import…**) and flat collections. This plan turns it into something that behaves like the macOS Finder: a sidebar of nested collection folders, grid **or** list, an icon-size slider, sorting, search, multi-select, drag to move and inline rename.

Decisions already made by Filip (2026-09-16):

1. The library keeps **Add video** and **Import…**. The title-bar **Open** goes.
2. In scope: view options, collections as folders, multi-select, inline rename, search. **Not** in scope: spacebar Quick Look.
3. Collections **nest** (a collection can live inside another).

Everything else below is a proposed default, and the ones worth a second look are collected in §7.

## 1. Model: what a "folder" is

- A folder **is** a collection. No second entity, no rename of the backend concept, so `collection_id` on the record, `collections.json`, the effective brief, template slots and the MCP collection tools all keep their meaning.
- A video lives in **at most one** folder (`collection_id`, unchanged). That is already Finder's rule.
- **Unfiled videos live at the root.** The sidebar's root node ("Library") shows the top-level folders plus every video whose `collection_id` is `null`. The old "No collection" filter option disappears into it.
- **"All videos"** is a separate, flat smart view: every video regardless of folder, like Finder's Recents. The Continue hero lives here and at the root.
- Orphan ids (a `collection_id` no collection defines) keep today's behaviour: they show at the root with their id as the folder label, and creating a collection with that exact id adopts them.

## 2. Backend: nested collections (PR 2)

### 2.1 Stored shape

`Collection`, `CollectionCreate` and `CollectionPatch` gain `parent_id: Optional[CollectionId] = None`.

- `collections.json` stays `version: 1`: the field is optional with a `null` default, so an old file reads unchanged. A top-level collection is **written without the key**, so a library with no nesting keeps the exact pre-nesting file an older build can read. A file that really nests is unreadable to an older build (its `Collection` forbids unknown keys) — accepted, since downgrades are not supported.
- **Ids stay globally unique.** Records point at a collection by id alone, so two "Day 1" folders under different events get `day-1` and `day-1-2` exactly as they would today. Moving or renaming a folder never changes its id.
- `CollectionPatch.parent_id`: sent `null` moves to the root, omitted leaves it where it is (the `model_fields_set` idiom `patched_collection` already uses).

### 2.2 Integrity rules, enforced under the store lock

| Rule | Refusal |
|---|---|
| `parent_id` must name an existing collection | 422 `unknown_parent` |
| a folder cannot be its own parent or sit under its own descendant | 422 `collection_cycle` |
| depth ≤ `MAX_COLLECTION_DEPTH` (8) | 422 `collection_too_deep` |
| delete refuses a folder with **subfolders** (beside today's "with members") | 409 `collection_has_children` with `children: n` |

`CollectionsFile`'s model validator also rejects a hand-edited file with a dangling parent or a cycle, raising `CollectionsUnreadable` like a duplicate id does today (a loud 500, never a silently flattened tree).

### 2.3 Inheritance: one seam, no call-site changes

`effective_brief(brief, collection)` has **seven** callers (`package.py` ×2, `platform_posts.py`, `validate_posts.py`, `publish_channels.py`, `router_publish.py`, `router_collections.py`). None of them change. Instead:

- A new pure `resolved_collection(collections, collection_id) -> Optional[Collection]` folds the ancestor chain, root first, into **one** `Collection`:
  - `slots` merge key-wise down the chain (a subfolder's `{{day}}` beats its parent's).
  - `overrides` merge per field: the **deepest non-null** value wins, `null` inherits (today's per-field rule, applied once per level).
  - identity fields (`id`, `name`, `parent_id`, timestamps) are the leaf's own.
- `router_publish.read_collection` (the injected reader `post_drafts.py` also takes) and `router_collections._detail` call `resolved_collection` instead of `find_collection`.
- **Byte-identity:** a top-level collection resolves to itself, so every existing package test and `test_library_channels_byte_identity.py` must pass **with unchanged expectations**. New tests pin a three-level chain (slot shadowing, list replacement, `null` inheriting through two levels).
- Consequence worth knowing: moving a folder changes its videos' pasted text with no record write, exactly as editing a collection does today (plan decision 3 of [library-collections.md](library-collections.md)).

### 2.4 Routes

- `GET /collections` stays **flat** (the renderer and the agent build the tree). Each row gains `parent_id`, `total_members` (this folder plus every descendant) and `path` (`["Events", "2026", "Day 1"]`, names root first).
- `GET|PATCH /collections/{id}` answer the same plus `effective_brief` from the resolved chain.
- `GET /api/library?collection=` keeps meaning **direct members only**. Recursive listing is a renderer concern (it already holds every summary).

### 2.5 MCP

- `set_collection` gains `parent_id: Optional[str]`. Because MCP arguments cannot distinguish "omitted" from `null`, **`parent_id=""` moves a folder to the root**, a `None` leaves it put; the docstring says so.
- `list_collections` rows carry `parent_id`, `path` and `total_members`; `get_collection` carries `path` so the agent can tell a user where a folder is.
- `mcp_server/publish_guide/collections.md` gets a "Folders inside folders" section (what inherits from where). No new tools, so `test_publish_guide.py` / `test_bundled_skills.py` need no new entries.

### 2.6 Settings → Collections

`CollectionsSettings.tsx` lists the tree indented, and `CollectionEditor.tsx` gains a **Location** picker (parent folder). The preview (`CollectionPreview.tsx`) already renders from `effective_brief`, so it shows inherited slots with no change. Each field in `CollectionOverrides` should say **where** an inherited value comes from ("from Events › 2026") — that needs the ancestor list, which `GET /collections/{id}` supplies via `path` plus the flat list.

## 3. Renderer: view options (PR 1)

No backend change.

### 3.1 Buttons

- `TitleBar.tsx`: the **Open** button is removed on every screen. `useGlobalShortcuts`' `mod+o` becomes "Import…" on the library screen and does nothing elsewhere. `restoreFromProjectFile` stays (crash recovery and record restore use it), while `handleOpen`, the `project:open` dialog and the already-unused `dialog:open-projects` picker are deleted with their entries in **both** preloads. ⌘O is owned by the library screen (`useLibraryImportShortcut`): the combined picker on macOS, Files… on Windows/Linux.
- A `.capforge` still arrives through Import… (as a card) or by double-clicking the file in Finder (`single-instance.js`, unchanged).

### 3.2 Toolbar

Left to right: **path bar** (PR 3; in PR 1 just the view name), then on the right **search field**, **sort** menu, **grid/list** segmented control (`ui/SegmentedControl`), **icon-size slider** (grid only), **Import…**, **Add video**. The collection `<select>` stays in PR 1 and is removed by PR 3.

### 3.3 Grid and icon size

- The grid's hard `minmax(230px,1fr)` becomes `minmax(var(--library-tile), 1fr)`, with the slider writing `--library-tile` between `LIBRARY_TILE_MIN_PX` (140) and `LIBRARY_TILE_MAX_PX` (360).
- **No keyboard shortcut for size:** Cmd+= / Cmd+− are Electron's `zoomIn` / `zoomOut` roles in the View menu (`electron/main.js`), and menu accelerators fire before the renderer sees the key.
- `LibraryPoster`'s per-record aspect cache is untouched; tall 9:16 cards still work at every size.

### 3.4 List view

`components/library/LibraryList.tsx`: a table with a 16:9 thumbnail (fixed row height, poster letterboxed), **Name**, **Duration**, **Status**, **Folder** (only in All videos and search results), **Published on** (the summary's derived `publishedOn`), **Modified**. Clicking a header sorts by it; clicking again reverses. The Continue hero is hidden in list view.

### 3.5 Sort

`lib/librarySort.ts` (pure, tested): `modified` (default, newest first), `name` (locale compare, numeric), `duration`, `status` (the derived order `imported → … → published`), `created`. Missing values sort last in both directions. Folders sort before videos, by name, whatever the video sort is (Finder's "keep folders on top").

### 3.6 Search

- A search field filters the current view. Typing is debounced (`LIBRARY_SEARCH_DEBOUNCE_MS` = 200) and calls the existing `GET /api/library?q=` (FTS5 over title, description, tags and transcript, with the `LIKE` fallback).
- The renderer intersects the returned ids with the view it is showing. In PR 3 a scope toggle appears under the field: **This folder** (with subfolders, the default inside a folder) | **All videos**.
- Esc clears it.

### 3.7 Remembered preferences

One `app-state` key, `libraryView`, through the existing `state:get` / `state:set` IPC: `{layout, tileSize, sort: {key, direction}, sidebarCollapsed}`. Parsed at read time through a guard in `lib/libraryPrefs.ts`, so a hand-edited or older value falls back per field to the defaults instead of breaking the screen.

## 4. Renderer: folders (PR 3)

### 4.1 Sidebar

`components/library/LibrarySidebar.tsx` (collapsible, fixed width):

```
All videos                     42
Library                        12
  ▾ Events                     30
      ▸ UCK26                  24
        Meetups                 6
    Tutorials                   0
+ New folder
```

- Counts are `total_members`. Disclosure state is remembered per folder in `libraryView.expanded`.
- Right-click a folder: **New folder inside**, **Rename**, **Move to…**, **Folder settings…** (opens Settings → Collections on that folder), **Delete** (disabled with the reason when it has videos or subfolders).
- **+ New folder** creates inside the folder being viewed, then puts its name into inline rename (Finder's "untitled folder" flow), replacing today's `NewCollectionPopover`.
- Tree building lives in `lib/collectionTree.ts` (pure, tested): `buildTree`, `ancestorsOf`, `descendantIds`, `canMoveInto` (the renderer's copy of the cycle guard, used only to grey out drop targets; the backend still rules).

### 4.2 Main area inside a folder

- **Path bar:** `Library › Events › UCK26`; each crumb navigates and is a drop target.
- **Grid:** subfolder tiles (folder glyph, name, count) first, then video cards. **List:** folder rows first. Double-click or Enter opens a folder.
- Empty folder: a quiet "Drop videos here, or drag them from another folder".

### 4.3 Drag and drop

- A card (or the whole selection) drags as `application/x-capforge-videos` (JSON ids); a folder as `application/x-capforge-collection`.
- Drop targets: sidebar folders, the "Library" root (= unfiled), folder tiles and rows, path-bar crumbs. A target that `canMoveInto` rejects shows no drop affordance.
- **The capture-phase file drop must ignore these drags.** `LibraryScreen`'s `onDropCapture` (and its drag-over overlay) proceed only when `dataTransfer.types` includes `Files`; otherwise the event is left for the folder targets. A pure `dragKind(types)` in `lib/libraryDrag.ts` decides it, tested for `Files`, both internal types and a mixed list.
- Moving videos reuses `runMoveToCollection` (read record, `PATCH` `collection_id` with `If-Match`), run for each id with **one** list refresh at the end and one summary toast for failures ("2 of 5 couldn't move: …"). No bulk endpoint: the record route already enforces everything, and a library move is rarely more than a few dozen videos.
- Moving a folder is `PATCH /collections/{id}` `{parent_id}`.

### 4.4 Selection

`lib/librarySelection.ts` (pure reducer, tested exhaustively since the node test environment cannot fire events):

- **Click** selects one. **Cmd-click** toggles. **Shift-click** selects the range in the **visible** order (folders then videos, current sort). **Cmd+A** selects all visible videos. **Esc** or clicking empty space clears.
- **Opening changes: a single click no longer opens a video.** Double-click or Enter opens it, like Finder. Folders open the same way.
- Selection is cleared on navigation and when a selected id leaves the list (a refresh after Remove).
- With 2+ selected, a selection bar replaces the toolbar's right side: `3 selected · Move to… · Remove · Delete`. Delete asks once for the whole selection.
- Keyboard: arrow keys move focus across the grid/list; Cmd+Backspace = Remove (with the inline confirm). Handled on the library container, never globally, so Cmd+A in a Settings text field still selects text.
- Right-click a card: the same menu as its `…` button (for a multi-selection, the bulk actions).

### 4.5 Inline rename

- **Rename** in the context menu, or clicking the name of an already-selected item, turns the name into an input. Enter or blur saves, Esc cancels.
- A video writes `title` (`PATCH /api/library/{id}` with `If-Match`; a 409 re-reads and retries once, then toasts). The title is the library name, bridged by the backend into the primary channel's post as today.
- A folder writes `name`. Its id does not change.
- Empty names are refused inline, never sent.

## 5. Pull requests

| PR | Scope | Backend? | Risk |
|---|---|---|---|
| 1 | Open removed, grid/list, icon size, sort, search (unscoped), remembered prefs | no | low |
| 2 | `parent_id`, integrity rules, `resolved_collection`, route fields, MCP, Settings tree + Location picker | yes | medium: the brief seam, byte-identity |
| 3 | Sidebar, path bar, folder tiles/rows, New folder in place, folder menu, drag and drop, search scope; removes the collection `<select>` | no | medium: drag vs file drop |
| 4 | Selection model, selection bar, bulk move/remove/delete, keyboard, inline rename, double-click to open | no | medium: changes how a card opens |

PR 1 and PR 2 are independent and can run in parallel. PR 3 needs both. PR 4 needs PR 3. All branch from `feat/multi-channel-import` until #48 merges (PR 4 of multi-channel rewrote the import toolbar), then retarget to `main`.

Each PR updates `CLAUDE.md` (the library bullets and the `components/library/` inventory) and the docs its contract touches.

## 6. Testing

- **Pure logic carries the weight** (vitest runs in `node`, no DOM events): `librarySort`, `libraryPrefs` guard, `collectionTree`, `libraryDrag.dragKind`, `librarySelection` reducer, search intersection.
- **Static markup** for `LibraryList`, `LibrarySidebar`, path bar, folder tile, selection bar, TitleBar without Open.
- **Backend**: nesting integrity (every refusal above), `resolved_collection` chains, delete with children, file-level validation, route fields; the existing collection and package suites unchanged.
- **MCP**: `set_collection` with `parent_id` / `""`, list rows carry `path`. Run explicitly (`mcp_server/tests` is outside `testpaths`).
- **In-app QA** per PR, driven with screenshots: specifically a file drop while a card drag is possible (PR 3), and double-click vs single-click on a card (PR 4).

## 7. Decided defaults (accepted 2026-09-16)

1. **Word in the UI:** **"Folder"** everywhere a person sees it (library sidebar, menus, "New folder", Settings → Collections renamed **Folders**). The backend, the REST routes, the MCP tools and `collection_id` keep **collection**.
2. **Single click selects, double-click or Enter opens** (PR 4), Finder's way.
3. **Unfiled videos live at the root** ("Library"); the "No collection" filter option goes.
4. **Deleting a non-empty folder stays refused** (videos or subfolders). "Empty it into the parent, then delete" may come later.
