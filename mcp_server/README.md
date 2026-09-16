# CapForge MCP Control Layer

Lets a local Claude agent operate a **running** CapForge app. The agent reads and
edits the transcript through token-guarded endpoints; the backend broadcasts
changes so the open UI updates live.

This is **Milestone A**: live transcript editing (spelling/homophone fixes and
filler removal). Style/emphasis and vision QA come in later milestones — see
`docs/plans/mcp-control-layer.md`.

## How it works

1. On startup the backend writes `~/.capforge/backend.json` = `{port, token}`
   (`backend/agent_bridge.py`).
2. This MCP server reads that file, then calls the backend over loopback HTTP with
   the token in the `X-CapForge-Agent-Token` header.
3. Agent writes hit `/api/agent/result`, which broadcasts `result_updated`; the
   renderer re-fetches and applies the change (soft-locked while you're editing).

**CapForge must be open** with a transcription loaded for the edit tools to work.

## Connecting (end users — one click)

In CapForge: **Settings → Claude AI integration → Connect Desktop** (and/or **Connect Code**),
then restart Claude. CapForge bundles its own Python runtime (with `mcp`+`httpx`) and writes the
client config for you — no terminal, no pip, no hand-edited JSON. If a client isn't detected, use
**Copy config manually**.

Implementation: `electron/claude-connect.js` (merges a `capforge` entry into
`claude_desktop_config.json` / `~/.claude.json`), exposed via `window.subforge.claude.*`.

## Manual / dev setup

Deps are bundled automatically in the packaged app; for dev:

```bash
.venv-dev/bin/pip install -r mcp_server/requirements.txt
.venv-dev/bin/python -m mcp_server.server      # run over stdio
```

Manual registration (grab the real, fully-escaped JSON from Settings → Copy
config manually — it bakes in the absolute paths for you):

```json
{
  "mcpServers": {
    "capforge": {
      "command": "<bundled python>",
      "args": ["-c", "import sys; sys.path.insert(0, \"<folder containing mcp_server/>\"); from mcp_server.server import main; main()"],
      "cwd": "<folder containing mcp_server/>",
      "env": { "PYTHONPATH": "<folder containing mcp_server/>" }
    }
  }
}
```

The `-c` bootstrap puts the package folder on `sys.path` explicitly. Plain
`["-m", "mcp_server.server"]` only works when the client honours `cwd` (Claude
Desktop on Windows does not) **and** the python honours `PYTHONPATH` (the Windows
embeddable build ignores it) — so it silently failed to launch on Windows.

**Windows config location matters.** The standard Claude Desktop installer reads
`%APPDATA%\Claude\claude_desktop_config.json`, but the **Microsoft Store** build
is sandboxed — Windows virtualizes that into the package container at
`%LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\Claude\claude_desktop_config.json`.
Connect writes to every install it finds (`desktopTargets()` in
`electron/claude-connect.js`); if you hand-edit, pick the file your build
actually reads.

## Tools

| Tool | What it does |
|------|--------------|
| `get_status` | Backend job status |
| `get_hyperframes_status` | Preflight the HyperFrames CLI before rendering (`cli_version`, `compat_ok`, remediation reasons) |
| `get_transcript` | Transcript with segment + word indices |
| `update_words` | Replace tokens (spelling/homophone fixes) → live UI |
| `remove_filler_words` | Drop um/uh/er… (timing preserved) → live UI |
| `load_video` | Load a video into the **open app** and start transcribing — the entry point of a batch run |
| `transcribe` | Start a transcription headlessly, bypassing the UI (blocks until done) |
| `export` | Export current transcript (srt/ass/json/…). `track_id` exports that caption track's own text and timings as `<name>.<lang>.srt` |
| `get_ui_state` | Current screen + style + display groups + preset names + resolved render config, plus the caption-track inventory (`tracks`, `activeTrackId`) — groups and render bodies stripped; use `get_track` for groups |
| `list_presets` | Style presets available in the app: `{user, builtin}` |
| `set_style` | Change global style (camelCase StudioSettings patch) → live UI. `track_id` styles one caption track (default: the active one) |
| `apply_preset` | Apply a **user-saved or built-in** style preset by name → live UI; blocks until the app confirms. Optional `track_id` |
| `create_track` | Add a translated caption track (a language tab) and get back its blank group ids paired with the source text to translate. Switches the app to the new tab |
| `set_track_text` | Write translations onto a track, one caption per group; word timings are derived proportionally across each group's existing span |
| `get_track` | A track's captions with their `clean`/`stale`/`untranslated` state — filterable to the ones needing work (`stale_only`) or to a time window |
| `reflow_track` | Rebuild a track's caption skeleton after the source's grouping changed (`reflowNeeded`); carries text through unchanged groups, blanks the rest with their `previousText` |
| `render` | Render the final video with the CLASSIC (Pillow) engine → output path. No approval gate. `track_id` renders that caption track, whose language suffixes the filename (`clip.pl_subtitles.mov`) |
| `emphasize` | Style individual words (size/animation/color) → live UI |
| `render_frame` | CLASSIC (Pillow) frame at time `t` (composited over video) — agent SEES it. Optional `track_id` |
| `preview_hyperframes_frame` | ONE HyperFrames frame at `t` (native/custom caption) — fast preview, agent SEES it |
| `check_layout` | Caption bbox + frame-edge + advisory safe-zone check at `t`. With `scan=True` it instead measures **every** caption group and reports the ones that wrap past `max_lines` or overflow the box — the translation-overflow loop; optional `track_id` |
| `find_moments` | Find transcript moments (word timings) matching a phrase — where to time a composition or caption change |
| `find_semantic_moments` | Find moments by category: `numbers` / `cta` / `speaker_change` (diarization) |
| `render_hyperframes` | Render captions via HyperFrames → output path. Optional `track_id` |
| `list_caption_styles` | List caption styles: `classic` + native HyperFrames registry styles |
| `set_caption_style` | Set the caption look (classic / `caption-pill-karaoke` / …) → UI dropdown; becomes visible only in HyperFrames preview/render |
| `get_custom_caption_contract` | Contract + starter template for authoring your OWN caption style from scratch |
| `set_custom_caption_style` | Set a brand-new agent-authored caption style (full HTML); validated on the way in → UI dropdown; becomes visible only in HyperFrames preview/render |
| `enter_coauthor_mode` | Take ownership of the HyperFrames project to author it freely; seeds a working starter, then CapForge stops regenerating index.html |
| `exit_coauthor_mode` | Hand control back to CapForge's generated composition |
| `sync_captions` | Refresh the CapForge-owned transcript + captions sub-composition into the co-author project (never touches your index.html) |
| `install_caption_component` | Install a HyperFrames registry caption component (e.g. `caption-kinetic-slam`) into the co-author project, fed with the current transcript — additive-only, never touches your index.html; wiring it in via `data-composition-src` stays your job |
| `get_workspace` | The co-author project path + file tree the agent authors in |
| `read_workspace_file` | Read a text file from the co-author workspace (sandboxed) |
| `write_workspace_file` | Write/overwrite a file in the co-author workspace (sandboxed: extension allowlist + size cap) |
| `import_into_workspace` | Import an effect pack (folder: a top-level `<name>.html` + optional README/registry-item.json + assets) into the workspace, layout preserved |
| `run_hyperframes_cli` | Run an allowlisted HyperFrames CLI check (lint/inspect/compositions/info/docs) in the workspace — the dev loop |
| `hyperframes_guide` | The HyperFrames **creative library** — caption craft, motion, type, the text-highlight vocabulary, transitions, palettes. Call with no topic for the operating model + index, then a topic id to pull on demand |

### Caption tracks (translations)

`create_track` → `set_track_text` → `check_layout(track_id, scan=True)` → shorten what
overflows → re-write → re-scan. The renderer owns tracks; every write here is a command
the app confirms, so **CapForge must be open**. See
[`docs/caption-tracks.md`](../docs/caption-tracks.md) for the data model, the staleness
rules and what is deliberately absent (there is no `delete_track`, and no batch render —
loop over `render(track_id)`).

## Library (the video record)

A **record** is CapForge's durable dossier for one video, kept on disk under
`$CAPFORGE_HOME/library/<id>/` (default `~/.capforge`): `record.json` (the authored
fields — title, description, chapters, tags, publish info — plus system fields and a
`rev`), the last saved session snapshot (`project.capforge`) and the transcript derived
from it. It is **not** the open project: these tools answer with the app idle on the
drop screen, and with its window closed, because the backend owns them.

| Tool | What it does |
|---|---|
| `list_videos` | The library, filtered by `status` (`imported` → `transcribed` → `captioned` → `drafted` → `published`), `collection`, or a full-text `q`; scratch records hidden unless asked for |
| `search_library` | Full-text search over titles, descriptions and transcript text — a thin alias for `list_videos(q=…)` |
| `get_video` | One record's full dossier plus its `rev`, by `video_id` **or** by media `path` (exactly one) |
| `get_video_transcript` | The record's stored transcript as `{rev, source: "record", transcript}`; `segments_only` by default to keep the token budget |
| `set_video_meta` | Write authored fields, conditional on the `rev` you read; the lone `{"scratch": false}` promotes a throwaway drop into a kept video |
| `mark_published` | Record where a video went live (CapForge uploads nothing); merges over `publish.youtube` and never restamps an existing `publishedAt` |
| `find_video_moments` | Moments in the *stored* transcript by literal `query` or by `kind` (`numbers`/`cta`/`speaker_change`/`pause`) — chapter hunting without opening the app |
| `open_video` | Restore a record's saved session in the CapForge window, making it the open project |

**Reading is not editing.** `set_video_meta` cannot touch transcript text, and
`update_words` / `remove_filler_words` / the caption-track tools / `render` all act on
the *open* session. To edit a video you found in the library, call `open_video` first.

Two errors are worth telling apart:

- `CapForge is not running — launch it (the window can stay closed) and retry.` — the
  backend process is down, so nothing here can answer.
- `CapForge is running but no window is open — click the Dock icon, then retry
  open_video` — only `open_video` needs a window, because the renderer is what restores
  a session.

`open_video` also needs the record to *have* a snapshot: until the app has saved a
session for it (record autosave arrives with the library screen), it answers `Record
<id> has no session snapshot yet — open it in CapForge once`.

### Publish

Turning a record into a YouTube upload package is a loop with one direction: **write
fields → validate → read the package**. The fields are the source; the package is a
rendering of them, so its text is never written back into a field.

| Tool | What it does |
|---|---|
| `get_brief` | The channel brief — audience, voice, footer, default hashtags, link rows, house rules. One brief for the whole library; the user edits it under Settings → Channel |
| `set_brief` | Merge top-level brief fields (channel-wide statements only — a video's own text belongs on its record) |
| `validate_video` | Run the publish rules over a record: `{hard, style, ok}`, each finding naming the `field`, the `rule` and a message |
| `check_chapters` | Dry-run a chapter list against the record's duration before writing it — nothing is stored |
| `get_upload_package` | The rendered package: the primary channel's, or `channel=`'s own post (a channel names its platform): `{text, violations}`, plain text, ready to paste |
| `grab_frames` | Grab still JPEG frames at the given seconds as thumbnail candidates: `{frames, failed, rev}` (≤ 8 per call, ≤ 24 per record, ≤ 1280 px long edge, ≤ 2 MB). Then set `thumbnail.cover` with `set_video_meta`; omit `candidates` (and `cover`) to leave them unchanged |

**Hard rules** are YouTube's own limits (title ≤ 100 characters, description ≤ 5000
bytes, tags line ≤ 500 characters, no angle brackets, chapters starting at 0, at least
three, ascending, ≥ 10s apart, inside the duration; Shorts clips in order and inside the
video; a thumbnail cover that is one of the grabbed frames, and no explicit change to
`thumbnail.candidates`). They live in Python once
(`backend/library/validate.py`) and `set_video_meta` is *refused* when one is broken —
that refusal comes back as `{"status": "error", "reason": "violations", "violations":
[…]}`, so fix the named field and write again. **Style rules** come from the brief and
are advice: they never block a write.

### Collections (events)

A **collection** states an event's shared boilerplate once: `slots` (`{{event}}`,
`{{sponsor}}`, …) and `overrides` of the channel brief (footer, recorded-at line,
default hashtags, `description_template`, …). A video joins by its record's
`collection_id` (`set_video_meta`). Every member's package is rendered at read time
from its record plus the collection's **effective brief**, so changing the collection
changes every member's package with no per-video write.

| Tool | What it does |
|---|---|
| `list_collections` | Every collection with its member count, plus `orphans`: ids videos carry that no collection defines |
| `get_collection` | One collection with `members` and its `effective_brief`, the brief a member video follows instead of `get_brief` |
| `set_collection` | Upsert: creates the collection when the id is new (`name` required, and an orphan id is adopted), else patches only the arguments given. Overrides replace the channel's value (lists and blocks too) and `null` inherits; slots merge key-wise over the channel's slots |
| `delete_collection` | Delete an empty collection; refused with the member count while any video still belongs to it |

The `publish_guide("collections")` topic is the agent-facing walkthrough: setting up
an event, the built-in template slots, the `unknown_slot` violation, adopting an orphan.

The bundled `capforge-publish` skill is the whole flow in prose: read the record,
the brief and the transcript, find timestamps with `find_video_moments`, write the
structured fields with `set_video_meta`, validate, then show what `get_upload_package`
renders — and `mark_published` once the user pastes the live URL. Saving the package to
`notes/youtube.txt` is now optional; the record is the source of truth. The skill ends
with an optional mapping for pushing a record to a conference site's own MCP
(description → youtubeDescription, short description → youtubeShortDescription,
highlights → highlights, links → customLinks, thumbnail ideas → youtubeThumbnailHooks,
summary → longDescriptionMd, the published URL → videoUrl), recorded back onto the
record's `external_refs` and `publish.pushes`.

## Batch runs (a folder of videos, one style)

CapForge must be **open** — the app owns the style, presets and fonts, and the
agent drives the visible UI. Per video:

```
load_video("/clips/01.mp4")        # app moves to the progress screen
poll get_status() until done       # transcription runs in the app
remove_filler_words()              # any transcript cleanup
apply_preset("Mettro")             # user preset; returns only once confirmed
render()                           # writes next to the source video
```

Two ordering rules make this reliable:

1. **`apply_preset` before `render`, and check its status.** The app applies the
   preset and mirrors its state back on a short debounce; `apply_preset` polls
   for that echo and returns `{"status": "ok", "applied": …}` only once it
   lands. A `"unconfirmed"` status means the style is *not* what you think it
   is — read the `hint` and fix it rather than rendering. `set_style` tweaks
   after a preset are fine; the preset stays the recorded basis.
2. **One video at a time.** `load_video` refuses while a job is running, and
   resets the previous video's groups, style and overrides when it accepts a new
   one, so nothing leaks between items.

`render` uses the classic Pillow engine and needs no approval. `render_hyperframes`
is the other engine and deliberately **blocks on a human Approve/Cancel prompt**,
so it is not suitable for an unattended loop.

To find preset names first: `list_presets()` → `{"user": [...], "builtin": [...]}`.
User presets are the ones saved from the app's Presets menu, and are the only
ones that can carry a custom font.

## Effect packs (co-author mode)

Reusable effects are plain folders, not a CapForge-managed library — this mirrors
how HyperFrames itself organizes reusable compositions. An **effect pack** is a
folder containing a top-level `<name>.html` effect file, plus optional
usage rules (`README.md` and/or `registry-item.json`) and optional assets
(images, fonts, etc.). There is no built-in registry or `hyperframes import`
command — a pack is placed by copying the folder in, then wired by hand:

1. `import_into_workspace(src)` copies the pack folder into the co-author
   workspace under `compositions/<name>/` (or
   `dest_subdir="compositions/components"` for a component), preserving its
   internal layout so relative asset paths keep resolving.
2. `read_workspace_file` its `README.md` / `registry-item.json`, or the HTML's
   own comment header, to learn how it expects to be wired.
3. Wire it:
   - **Block** (a standalone sub-composition with its own dimensions/duration):
     reference it from `index.html` via
     `<div data-composition-src="compositions/<name>/<name>.html"
     data-composition-id="…" data-start data-duration data-track-index
     data-width data-height>`.
   - **Component** (a snippet with no own dimensions): paste its HTML into your
     composition's markup, its CSS into `<style>`, and its JS before the
     timeline — merging its exposed GSAP timeline calls into yours. Prefix its
     element IDs with 2-3 letters to avoid collisions with your own.
4. `preview_hyperframes_frame` to check it, then `render_hyperframes` once the
   user approves.

## Per-video notes (`notes/`)

The co-author workspace is keyed to the **open video** and survives across sessions,
so it doubles as a scratch dossier for that video before CapForge has a real
library record (see `docs/plans/creator-hub-vision.md`, §7 "Week 0"). Co-author
mode does not have to be on; CapForge never deletes this folder (only the
render-to-file scaffold uses a throwaway temp dir).

Convention:

| File | Holds |
|---|---|
| `notes/youtube.txt` | The copy-ready upload package: title options, description, chapters, keywords, hashtags, Shorts caption |
| `notes/summary.md` | The transcript breakdown (summary, highlights, quotes, tools mentioned) |

Recipe, with the video open in CapForge:

1. `get_transcript(segments_only=True)` (plus `find_semantic_moments` for chapter
   candidates) and write the material.
2. `write_workspace_file("notes/youtube.txt", content)` — `.txt` and `.md` are on the
   extension allowlist; parent folders are created.
3. In a later session, with the same video open: `read_workspace_file("notes/youtube.txt")`.

This is the day-zero experiment behind the v3 library: which of these fields an
agent actually reads back decides the record schema, so keep the notes as plain
sections rather than prose.

## Bundled skills (`skills/`)

Each folder under `skills/` with a `SKILL.md` is a workflow Claude runs against
CapForge, shipped with the app and **editable inside it**: Settings → Skills lists
them, and opening one edits CapForge's per-user copy at
`~/.capforge/skills/<name>/` (seeded from the bundle on first open, honouring
`CAPFORGE_HOME`). **Install** copies *that* copy into `~/.claude/skills/<name>/`
for Claude Code; Claude Desktop users use **Reveal** and add the folder through
Desktop's skills settings. When a CapForge update changes a bundled skill, the
editor says so and offers Keep mine / Take new / Open both — a user's edits are
never overwritten silently. `tests/test_bundled_skills.py` pins every tool a
skill names to a registered `@mcp.tool()`, and requires the frontmatter `name`
to equal the folder name.

- **`capforge-publish`** — turns the open video into one copy-ready YouTube upload
  package and saves it as `notes/youtube.txt` (above). Channel-specific prose lives
  in its **Channel notes** block, so one skill serves a personal channel and a
  conference channel alike; `examples/conference-channel.md` shows a filled-in copy
  with a second destination. Per-platform formatters (LinkedIn, X, Instagram) are
  deliberately not part of it yet — see `docs/plans/creator-hub-vision.md` §7 (4s).

## Registry styles in co-author mode

`set_caption_style` is a CapForge-pipeline knob — in co-author mode it never
reaches the render, because the agent-owned `index.html` decides captions on
its own (see the `coauthor_active` hint on that tool's return value). To bring
a registry look (e.g. "make it Kinetic Slam") into a co-authored composition:

1. `install_caption_component("caption-kinetic-slam")` — installs
   `compositions/components/caption-kinetic-slam.html` fed with the current
   transcript. Additive-only; your `index.html` is untouched.
2. Wire it into `index.html` yourself via `data-composition-src` (the tool's
   `path` in its response), and remove/disable any inline caption layer you
   already had so captions don't render twice.
3. `preview_hyperframes_frame` to confirm the look, then tell the user to
   refresh the Studio tab to see it before rendering.

## Creative library (`knowledge/`)

The connected agent isn't the Claude that has the HyperFrames skills installed, so
over MCP it would otherwise only see tool docstrings. `knowledge/` vendors a curated,
verbatim slice of the HyperFrames creative references (caption, motion, type,
text-animation, transitions, palettes), plus a CapForge-specific `INDEX.md` that
rebinds the standalone CLI/project workflow onto these tools. It's served pull-on-demand
via the `hyperframes_guide` tool and the `hyperframes://library` /
`hyperframes://topic/{id}` resources. The `TOPICS` manifest in `knowledge.py` is the
single source of truth (and the allowlist). The `.md` files ship via the
`mcp_server/knowledge/**/*.md` entry in the electron-builder `files` list.

## Tests

```bash
.venv-dev/bin/python -m pytest mcp_server -q
```
