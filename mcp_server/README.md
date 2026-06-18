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

Manual registration (grab the real paths from Settings → Copy config manually):

```json
{
  "mcpServers": {
    "capforge": {
      "command": "<bundled python>",
      "args": ["-m", "mcp_server.server"],
      "env": { "PYTHONPATH": "<folder containing mcp_server/>" }
    }
  }
}
```

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
| `render_frame` | Render the frame at time `t` (composited over video) — agent SEES it |
| `check_layout` | Caption bbox + frame-edge + advisory safe-zone check at `t` |

## Tests

```bash
.venv-dev/bin/python -m pytest mcp_server -q
```
