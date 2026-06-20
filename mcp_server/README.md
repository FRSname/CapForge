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
| `preview_hyperframes_frame` | ONE HyperFrames frame at `t` (native/custom caption + effects) — fast preview, agent SEES it |
| `check_layout` | Caption bbox + frame-edge + advisory safe-zone check at `t` |
| `find_moments` | Find transcript moments (word timings) matching a phrase — where to place effects |
| `find_semantic_moments` | Find moments by category: `numbers` / `cta` / `speaker_change` (diarization) |
| `list_effect_types` | Available effect types (logo, lower_third, kinetic_stat, highlight, b_roll) + their variable schemas |
| `list_effects` | Effect clips currently on the timeline |
| `add_effect` | Place an animated effect (logo / lower_third / kinetic_stat / highlight / b_roll) at a time — the AI video director |
| `remove_effect` | Remove an effect clip by id |
| `render_hyperframes` | Render captions + placed effects via HyperFrames → output path |
| `list_effect_templates` | List saved reusable effect templates (cross-project looks) |
| `save_effect_template` | Save a timeline effect (by id) as a reusable template — "save this so we can reuse it" |
| `apply_effect_template` | Drop a saved template onto the timeline at a time → live UI |
| `delete_effect_template` | Delete a saved effect template by name |
| `list_caption_styles` | List caption styles: `classic` + native HyperFrames registry styles |
| `set_caption_style` | Set the caption look (classic / `caption-pill-karaoke` / …) → live UI |
| `get_custom_caption_contract` | Contract + starter template for authoring your OWN caption style from scratch |
| `set_custom_caption_style` | Set a brand-new agent-authored caption style (full HTML); validated on the way in → live UI |

## Tests

```bash
.venv-dev/bin/python -m pytest mcp_server -q
```
