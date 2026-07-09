# Plan: MCP transcript-editing UX hardening

**Motivation.** A Claude Cowork session used the CapForge MCP to spell/grammar-check a
241-segment transcript. The final edits landed correctly, but the agent was forced into
three avoidable detours and shipped one latent defect — every one traceable to a gap in
the agent-facing API, not to agent error:

1. `get_transcript` returned ~335 KB / 16,298 lines (full per-word timing for every
   segment) → blew the LLM token budget → agent improvised a file-dump + `jq` fallback,
   and hit the same wall again when verifying.
2. `update_words` cannot delete or merge tokens. To merge `"chat GPT"→"ChatGPT"` and
   `"the blue sky"→"Bluesky"` the agent set the extra tokens to `""`, leaving empty word
   slots with orphaned time ranges. `_rebuild_text` space-joined them into **double
   spaces** in the shipped caption text (`"said to ChatGPT  hey"`, `"trying with  Bluesky"`).
3. `sync_captions` returned a bare `400` on a non-co-author project. It was never needed —
   `update_words` had already pushed the change live via the `result_updated` broadcast.

Goal: close these gaps so an agent doing routine transcript cleanup never has to guess.

---

## Phase 0 — Discovery (COMPLETE; Allowed-APIs list)

Grounding read on 2026-07-09. Exact, verified surfaces the implementation phases build on.
Do not invent methods beyond these.

**`get_transcript` path (3 layers):**
- MCP tool — `mcp_server/server.py:69–90`. Always builds `words[]` with per-word
  `{index, word, start, end}`. No params.
- Client — `mcp_server/client.py:78–79` `get_result()` → `GET /api/agent/result`.
- Backend — `backend/main.py:604–609` returns the `current_result` (`main.py:121`)
  `TranscriptionResult` verbatim via FastAPI serialization.
- **Compact-shape precedent to copy:** `find_moments` / `find_semantic_moments`
  (`mcp_server/server.py:241–260`, `backend/engine/moments.py:21–68`) already return
  `{text, start, end, word_id}` with NO words array. Follow this shape.

**`update_words` path:**
- MCP tool + `WordEdit` schema — `mcp_server/server.py:26–30`, `95–105`.
- Pure transform — `mcp_server/cleanup.py:81–104` `apply_word_edits`. Replaces
  `words[wi]["word"]` only; never mutates the array length.
- Text rebuild — `mcp_server/cleanup.py:41–42` `_rebuild_text` = `" ".join(...).strip()`
  (the double-space source).
- **Delete-and-rebound precedent to copy:** `remove_fillers` (`cleanup.py:52–78`) already
  filters `seg["words"]`, calls `_rebuild_text`, recomputes bounds via `_segment_bounds`
  (`cleanup.py:45–49`), and drops now-empty segments. A delete/merge op is this same shape.
- Write path — `PUT /api/agent/result` (`backend/main.py:612–619`) sets `current_result`
  and broadcasts `result_updated`, so the open renderer updates live with no extra sync.

**`sync_captions` path:**
- MCP tool — `mcp_server/server.py` `sync_captions` (client `client.py:187–188`).
- Backend — `backend/main.py:1447–1451` → `_coauthor_sync_captions` (`main.py:1415–1430`).
  Failure modes: `404` (no result), `409` (UI config not mirrored), `400`
  (`FileNotFoundError`/`ValueError` deep in `sync_companions`). **No upfront co-author
  guard** — hence the opaque `400` on non-co-author projects.
- Co-author truth source: the `.capforge-coauthor.json` marker + helper (search for
  `coauthor_active` / `current_coauthor` in `main.py` / `hyperframes_project.py`) — confirm
  the exact predicate name during Phase 3 before using it.

**Test surface:** pure transforms live in `mcp_server/cleanup.py`; look for an existing
`mcp_server/tests/` or `backend/tests/` cleanup test to copy structure from. Run with
`.venv-dev/bin/python -m pytest`.

---

## Phase 1 — `update_words`: stop the double-space + add real delete/merge

Highest correctness value; fixes the one defect that actually shipped. Touches only the
pure transform layer (`cleanup.py`) plus the tool schema/docstring.

### 1a. Immediate defect fix — filter empty tokens in `_rebuild_text`
- **Copy nothing new; one-line change.** In `mcp_server/cleanup.py:41–42`, skip empty
  tokens so a blank slot can never produce a double space:
  `return " ".join(w["word"] for w in words if w["word"].strip())`
- This alone makes the exact cowork output (`"ChatGPT  hey"`) render correctly, even before
  the API grows a delete op.

### 1b. Add a delete/merge operation to `update_words`
Decide the API shape (see "Open decision" below), then:
- **Copy the delete-and-rebound pattern from `remove_fillers` (`cleanup.py:52–78`)** into
  `apply_word_edits` (`cleanup.py:81–104`): after applying edits, for any token flagged for
  deletion, remove it from `words`, then recompute `seg["text"]` via `_rebuild_text` AND
  `seg["start"]/["end"]` via `_segment_bounds` (`cleanup.py:45–49`) — exactly as
  `remove_fillers` already does. Drop a segment that ends up wordless (mirror lines 69–70).
- A **merge** is "replace token A with the merged text, delete token B, and widen A's time
  range to `[A.start, B.end]`" — implement it as a replace + delete in one edit so the agent
  never leaves an orphan or needs a second corrective call (this is what would have made the
  `"GPT,"` comma-drop re-fix unnecessary).

### Verification checklist
- [ ] New unit test: replacing a token with `""` yields NO double space in `seg["text"]`.
- [ ] New unit test: deleting a token removes it from `words[]`, rebuilds `text`, and
      recomputes `start`/`end` (assert bounds shrink when an edge word is deleted).
- [ ] New unit test: merging two adjacent tokens → one token, correct text, time range
      `[first.start, second.end]`, no orphan token.
- [ ] Replaying the cowork edits (ChatGPT / Bluesky merges) produces clean single-spaced text.
- [ ] `apply_word_edits` still raises loudly on out-of-range indices (keep the
      IndexError/KeyError contract from the docstring at `cleanup.py:86–87`).

### Anti-pattern guards
- Do NOT shift surviving words' timestamps — CapForge is a finishing tool; only the deleted
  token's range disappears (`cleanup.py:18–20` documents this invariant).
- Do NOT mutate the input dict — every `cleanup.py` transform is pure (`copy.deepcopy` first).
- Do NOT special-case punctuation/capitalization heuristically; the agent supplies the merged
  text explicitly.

### Open decision (shapes 1b — recommend before coding)
How to expose delete/merge on `update_words`. Recommendation: extend `WordEdit` with an
optional `op: Literal["replace","delete"] = "replace"` (merge = a `replace` on the survivor
+ a `delete` on the neighbor in the same `edits` list). Keeps one tool, one round-trip,
backward-compatible. Alternative: separate `delete_words` / `merge_words` tools (more
discoverable, more surface). Confirm with the user.

---

## Phase 2 — `get_transcript`: segments-only mode to kill the token blowout

Highest UX value; removes the file-dump/`jq` detour for both the initial read and
verification. Three layers, backward-compatible.

- **Backend** `backend/main.py:604–609`: accept a query param (e.g. `include_words: bool =
  True`); when false, strip each `seg["words"]` before returning. Copy the compact
  `{text, start, end, ...}` shaping style from the `find_moments` endpoint.
- **Client** `mcp_server/client.py:78–79`: `get_result(words: bool = True)` → pass
  `params={"include_words": words}` through `_request` (confirm `_request` forwards `params`;
  add it if not).
- **MCP tool** `mcp_server/server.py:69–90`: add `segments_only: bool = False`; when true,
  call the client without words and emit segments as
  `{index, start, end, text, speaker}` — no `words[]`. Update the docstring to tell the agent
  to use `segments_only=True` for review/grammar passes and the full form only when it needs
  word indices for `update_words`.

### Verification checklist
- [ ] `get_transcript(segments_only=True)` on a 241-segment transcript returns well under the
      token ceiling (target ~20 KB vs ~335 KB) and contains no `words` key.
- [ ] `get_transcript()` (default) is byte-compatible with today's output — no regression for
      callers that need word indices.
- [ ] `update_words` still works after an agent reads segments-only then re-reads full for
      indices (the intended two-step flow).

### Anti-pattern guards
- Do NOT drop `text` or segment indices in compact mode — the agent needs them to locate a
  fix and to call the full read for word indices.
- Do NOT add offset/limit pagination in this phase (YAGNI — segments-only already fits the
  budget; revisit only if a transcript exceeds it without words).

---

## Phase 3 — `sync_captions`: clear guard instead of an opaque 400

Removes the "call it to be safe → 400 → rationalize" cycle.

- **Docstring** (`mcp_server/server.py` `sync_captions`): state plainly that it is
  co-author-only and is NOT needed after `update_words` (which already updates the live UI via
  the `result_updated` broadcast). This alone stops most needless calls.
- **Backend upfront guard** in `_coauthor_sync_captions` (`backend/main.py:1415–1430`): before
  touching the filesystem, check the co-author predicate (confirm exact name — `coauthor_active`
  / `current_coauthor` / the `.capforge-coauthor.json` marker) and, if not active, raise a
  clear `400`/`409` like: *"Not in co-author mode — transcript edits already updated the live
  UI via update_words; sync_captions is only for co-author projects."*

### Verification checklist
- [ ] Calling `sync_captions` on a non-co-author project returns the explicit message, not a
      generic `FileNotFoundError`-derived 400.
- [ ] Co-author path is unchanged (existing co-author sync tests still pass).

### Anti-pattern guards
- Do NOT weaken the existing `404` (no result) / `409` (UI not mirrored) branches — only add
  the co-author guard ahead of them.
- Reuse the existing co-author predicate; do not re-implement marker parsing.

---

## Phase 4 — Verification & docs

- [x] `.venv-dev/bin/python -m pytest` green (new cleanup tests + backend suite). → 355 passed, 16 skipped.
- [x] `npm run typecheck` unaffected (no renderer changes expected). → clean.
- [x] Grep guard: no remaining `" ".join(` on words without an emptiness filter in `cleanup.py`.
      → the sole join (`cleanup.py:44`) carries the `if w["word"].strip()` filter.
- [ ] Manual (user-side, needs live Electron app + MCP): reproduce the cowork flow end-to-end —
      read segments-only, merge two tokens in one edit, confirm clean text in the UI, and confirm
      `sync_captions` is never needed.
- [x] Update `CLAUDE.md` MCP notes — added the "MCP agent transcript-editing contract" bullet
      documenting the `op`-field delete/merge, segments-only mode, and the `sync_captions` 409 guard.

## Sequencing
Phases are independent and can land in any order. Suggested value order: **1 → 2 → 3**
(ship the actual defect fix first, then the biggest UX win, then the papercut).
