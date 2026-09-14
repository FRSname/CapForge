# v3.0 #5 — Publish guide topics, prompts, and the guide↔tool test

**Status:** implemented 2026-09-14 on `feat/v3-publish-guide`. Plan row: creator-hub-vision §7 #5 ("core, small — the workflow ships with the app"), spec §3.4.

## Why

The agent driving CapForge over MCP never sees the bundled `capforge-publish` skill — that is Claude Code's copy, installed from Settings → Skills. Over MCP it sees only tool docstrings, so the publish loop (record → fields → validate → package) exists nowhere the Desktop agent can read it. The HyperFrames creative library already solved this shape (`knowledge.py`: a manifest-as-allowlist, a guide tool, `hyperframes://` resources, pull one topic at a time); this deliverable reuses it for the publish workflow and adds the `@mcp.prompt()` entry points Claude Desktop lists as slash commands.

## What

- **`knowledge.py`** grows a `TopicSet` dataclass (directory + manifest + index file, with `list_topics` / `read_index` / `read_topic`). The HyperFrames set becomes `HYPERFRAMES = TopicSet(...)`; the module-level functions stay as thin wrappers so `server.py` and `test_knowledge.py` are untouched.
- **`mcp_server/publish_guide.py`** (no import of `server`, same `TOOLS` + `register(mcp)` shape as `publish.py`): the seven-topic manifest, `GUIDE = TopicSet(...)`, the `publish_guide(topic?)` tool, the `capforge://publish` and `capforge://publish/{topic}` resources, and the four prompts `breakdown(video_id)`, `describe(video_id)`, `chapters(video_id)`, `batch_publish(status="transcribed")`. Each prompt returns the user turn and **starts by naming the topic it is built on**, so the prompt and the guide cannot drift apart. `server.py` gains one import and one `publish_guide.register(mcp)` line.
- **`mcp_server/publish_guide/`**: `INDEX.md` (the operating model — record is the source, package is a rendering, the brief is binding, revs, hard vs style, never invent, one video per call, CapForge uploads/cuts/draws nothing — plus the where-things-are table and the topic index) and the seven topics `workflow`, `breakdown`, `description`, `chapters`, `thumbnails`, `shorts`, `batch`, carved from the `capforge-publish` skill and vision §2.4/§3/§8. The skill stays the Claude Code copy; the guide is the MCP copy of the same loop.
- **`tests/test_publish_guide.py`**: manifest ↔ files ↔ index consistency, traversal refusal, **every backticked tool a topic or prompt names exists on the server** (reusing `test_bundled_skills._registered_tools`, which now also reads `publish_guide.py`'s `TOOLS`), each prompt sends the agent to `publish_guide` first, a recorder-based `register()` check (1 tool, 2 resources, 4 prompts in order), and a real-FastMCP check (`importorskip`) that the prompts list with the right required arguments, a prompt renders its argument, and both resources serve.

## Deliberately not here

- The "install a SKILL.md from Connect Code must be opt-in with a visible path" clause of §3.4 is the skills editor's job (v3 week 0, `electron/skills-store.js`) — unchanged.
- No new backend route; the guide is static text on the MCP server.
- `CLAUDE.md`'s MCP paragraph is updated for the count and the guide.
