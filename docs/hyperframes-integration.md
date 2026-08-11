# HyperFrames integration — connection-layer contract

> Extracted from `CLAUDE.md`. This covers the *bridge* to the HyperFrames Node CLI subprocess, which is hardened separately from the caption-parity contract in [caption-parity.md](caption-parity.md).

These are the invariants that keep the bridge reliable across CLI version drift, backend crashes, and the preview loop.

## CLI version gate

`backend/exporters/hyperframes_version.py`. `MIN_SUPPORTED = "0.7.21"` is the floor — `check_cli_compat()` refuses to render below it (`HyperframesVersionError`) and only *warns* when the probe fails (unknown version proceeds). `SNAPSHOT_EXTRA_FRAME_SINCE = "0.7.25"` is the version from which the CLI auto-saves an extra end-of-timeline frame (why the snapshot picker exists).

Bump `MIN_SUPPORTED` only alongside a green parity run at the new pin. The weekly `parity-nightly.yml` job tests `@latest` but is **never a required check**.

## Structured errors

`hyperframes_render.py`. All failures subclass `HyperframesRenderError`:

| Error | Meaning |
|---|---|
| `HyperframesUnavailableError` | no bundled Node/CLI |
| `HyperframesVersionError` | below the version gate |
| `HyperframesTimeoutError` | render/snapshot deadline exceeded; process tree killed |
| `HyperframesCancelledError` | user cancelled via the `cancel_event` |

Catch the base class; surface `.detail` (stderr tail) to the user.

## Durable co-author marker

`COAUTHOR_MARKER = ".capforge-coauthor.json"` (`hyperframes_project.py`) is the on-disk source of truth for "is this project co-authored?", so the mode survives a backend crash/restart — the in-memory `current_coauthor` global is only a fast path.

Written atomically, resolved *through* the workspace sandbox (`resolve_in_workspace`), kept as history (`active: false`) on exit, never deleted. Guards `CoauthorClobberError`: scaffolding refuses to overwrite an agent-authored `index.html` while the marker says active. A missing/corrupt marker degrades to `None` (= "not co-authored"), so writes must never leave truncated JSON.

## Scaffold fingerprint (the preview-loop cache)

`SCAFFOLD_FINGERPRINT_FILE = ".capforge-scaffold.json"` + `SCAFFOLD_VERSION`: a sidecar next to `index.html` letting `ensure_hyperframes_project()` skip re-scaffolding when inputs are unchanged.

The cache keys on `(fingerprint, SCAFFOLD_VERSION)` — **bump `SCAFFOLD_VERSION` whenever `_build_index_html` or the caption runtime it embeds changes shape**, or an old byte-identical input set will serve a stale-shape preview.

## Snapshot picker

`hyperframes_render.py` picks the PNG whose `frame-NN-at-<t>s.png` filename time is closest to the requested `t`. It falls back to newest `st_mtime` **only** for pre-`0.7.25` CLI filenames lacking the `-at-<t>s` suffix.

Never pick a snapshot by mtime otherwise — the CLI writes the extra end-of-timeline frame *after* the requested one.

## CLI subcommand allowlist

The co-author agent may only run read-only dev-loop subcommands:

```python
CLI_ALLOWED_SUBCOMMANDS = {"lint", "inspect", "compositions", "info", "docs"}
```

Render/snapshot/networked/stateful commands have dedicated endpoints, never the passthrough.

## Effect packs (no template library)

Reusable effects are plain folders (`<name>.html` + optional `README.md`/`registry-item.json` + assets), **not** a CapForge-managed store. The MCP `import_into_workspace` tool copies one into `compositions/<name>/` (or `compositions/components/<name>/`), and the co-author agent reads its usage rules and wires it by hand via `data-composition-src`. See `mcp_server/README.md`.
