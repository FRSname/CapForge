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

## Install

```bash
.venv-dev/bin/pip install -r mcp_server/requirements.txt
```

## Run (stdio)

```bash
.venv-dev/bin/python -m mcp_server.server
```

## Register with Claude Desktop / Claude Code

```json
{
  "mcpServers": {
    "capforge": {
      "command": "/Users/tobbot/capforge/CapForge/.venv-dev/bin/python",
      "args": ["-m", "mcp_server.server"],
      "cwd": "/Users/tobbot/capforge/CapForge"
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

## Tests

```bash
.venv-dev/bin/python -m pytest mcp_server -q
```
