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
| `transcribe` | Start a transcription (blocks until done) |
| `export` | Export current transcript (srt/ass/json/…) |
| `get_ui_state` | Current style + display groups + preset names |
| `set_style` | Change global style (camelCase StudioSettings patch) → live UI |
| `apply_preset` | Apply a built-in style preset by name → live UI |
| `emphasize` | Style individual words (size/animation/color) → live UI |
| `render_frame` | CLASSIC (Pillow) frame at time `t` (composited over video) — agent SEES it |
| `preview_hyperframes_frame` | ONE HyperFrames frame at `t` (native/custom caption) — fast preview, agent SEES it |
| `check_layout` | Caption bbox + frame-edge + advisory safe-zone check at `t` |
| `find_moments` | Find transcript moments (word timings) matching a phrase — where to time a composition or caption change |
| `find_semantic_moments` | Find moments by category: `numbers` / `cta` / `speaker_change` (diarization) |
| `render_hyperframes` | Render captions via HyperFrames → output path |
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
