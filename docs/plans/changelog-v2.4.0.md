# Plan: CapForge v2.4.0 Changelog

## Goal

Add a new `## CapForge v2.4.0` section to the top of `CHANGELOG.md`, matching the
existing entry style (bolded feature name + prose paragraph, grouped under
`### New Features` / `### Fixes` / `### Internal`), and bump the version number
in `package.json` from `2.3.0` → `2.4.0`.

## Phase 0: Source of Truth (already gathered this session)

Scope = every commit on `main` since tag `v2.3.0` (`git log v2.3.0..HEAD --oneline`).
Confirmed 4 merged PRs + 2 standalone commits, in chronological order:

| Commit(s) | PR | User-facing theme |
|---|---|---|
| `9301c8d`…`0353d97` | (merged directly, no PR # in log) | Caption-style visibility hints + co-author install tool + non-ASCII crash fix |
| `286d01d` | — | Ko-fi funding link (repo metadata only, **not user-facing**, omit) |
| `89f76c2` (`d86f21e`, `35f3a60`) | #12 `codex/system-font-picker` | Searchable system font picker |
| `0bbc312` (`0cb730c`, `e37ad4c`, `f9cf560`, `f11ae50`) | #9 `fix/lithuanian-whisperx-alignment` | Lithuanian transcription alignment fix |
| `d5dcdca` | — | Download links updated in README/docs (**not user-facing changelog material**, omit) |
| `fc75711` (`9d1959d`,`22211fc`,`51a1e23`,`a7be7c2`,`70ed839`) | #14 `feat/timeline-inline-editing` | Right-click word/group editing directly on the timeline |
| `aeceb61` (`00f17d3`,`9b8c746`,`c703f2d`,`0710397`) | #15 `fix/word-scale-highlight-pill` | Per-word scale now scales the highlight pill too |

Relevant plan docs already on disk (read these for exact behavior, don't re-derive):
- `docs/plans/caption-style-visibility-feedback.md`
- `docs/plans/timeline-inline-editing.md`
- `docs/plans/word-scale-highlight-pill-parity.md`
- `docs/plans/pr9-pr12-remerge-review.md` (covers the Lithuanian + font-picker remerge — check this first, it may already summarize both PRs)
- `docs/plans/pr-triage-review-2026-07.md`

Style reference: read `CHANGELOG.md` lines 1–43 (the v2.3.0 entry) for tone/format before writing — short bold headline, one paragraph, no code blocks, no bullet lists inside an entry, written for end users not developers.

## Phase 1: Draft the entries

Write one paragraph per feature. Do not invent capabilities — every claim must trace to a commit message or plan doc above.

1. **Lithuanian transcription support** (`### New Features`)
   - Source: `0cb730c`, `e37ad4c`, `f9cf560`, `f11ae50`, `backend/engine/transcriber.py`, `THIRD_PARTY_MODELS.md`, `AlignmentNotice.tsx`.
   - Content: WhisperX alignment for Lithuanian now works; the alignment model revision is pinned for reproducibility; the app surfaces an `AlignmentNotice` in the UI when relevant. Mention this fixes a language that previously failed/produced bad timing, without overclaiming other new languages.

2. **Searchable system font picker** (`### New Features`)
   - Source: `d86f21e`, `35f3a60`.
   - Content: font selection now lists/searches installed system fonts (not just bundled CapForge fonts), addressing the "all system fonts" ask. Verify against `docs/plans/pr9-pr12-remerge-review.md` for exact scope (e.g., does it apply to per-word font overrides too, or just the main font setting?) before finalizing wording — check `FontCombobox` component usage sites.

3. **Timeline inline editing** (`### New Features`)
   - Source: `9d1959d`, `22211fc`, `51a1e23`, `a7be7c2`, `70ed839`, `docs/plans/timeline-inline-editing.md`.
   - Content: right-click a word or group directly on the timeline to open the same text/style popup (words) or position popup (groups) available elsewhere in the editor — no need to switch to the Groups/Text view first. Note it replaced an earlier double-click interaction (right-click chosen to avoid a race with click-to-select) — only include this detail if it reads as user-relevant (it does: explains why right-click, not double-click).

4. **Caption-style visibility hints (agent workflow)** (`### New Features`)
   - Source: `9301c8d`, `8f441cc`, `c59f177`, `a2d0c6e`, `0353d97`.
   - Content: this is mostly an MCP/agent-facing feature — when a connected Claude agent (or the user) picks a non-classic HyperFrames caption style, the UI now shows a hint that the style only appears in the HyperFrames preview/render, not the live Canvas preview; a warning appears if co-author mode installs a style that never gets wired up; the agent gained an `install_caption_component` tool. Keep this entry honest about audience — most CapForge users won't touch this directly, but it should still be listed since it's user-visible (toast/hint text in the app).

5. **Per-word scale now matches the highlight pill** (`### Fixes`, not New Features — it's a bug fix)
   - Source: `docs/plans/word-scale-highlight-pill-parity.md`, `00f17d3`, `9b8c746`, `c703f2d`.
   - Content: scaling an individual word's font size (via the per-word style popup) now scales the highlight-effect pill behind it to match, across all three renderers (Canvas preview, classic Pillow export, HyperFrames). Previously the pill stayed at the global size.

6. **Non-ASCII registry caption crash** (`### Fixes`)
   - Source: `7d6a282`.
   - Content: scaffolding a registry/HyperFrames caption style with an accented or non-Latin transcript (e.g. Czech) used to crash; fixed.

7. **Per-word font picker closing early** (`### Fixes`)
   - Source: `70ed839`.
   - Content: picking a font from the per-word style popup's searchable dropdown sometimes did nothing because the popup closed itself first. Fixed.

### Internal section (optional, keep short — only if it adds real signal per existing style)
- Lithuanian alignment tests decoupled from live Hugging Face calls (`f11ae50`) — mention only if the "Internal" section pattern from v2.3.0 (test/refactor notes) is worth continuing; skip if the entry feels thin.

## Phase 2: Write the CHANGELOG.md edit

1. Open `CHANGELOG.md`.
2. Insert a new `## CapForge v2.4.0` section immediately after line 1 (`# Changelog`) and before the existing `## CapForge v2.3.0` heading — same structural position the v2.3.0 entry occupies relative to v2.0.0.
3. Order sections `### New Features` then `### Fixes` then (optionally) `### Internal`, matching v2.3.0's ordering.
4. Within New Features, lead with the most user-visible items first: Lithuanian support, system font picker, timeline inline editing, then the caption-style visibility (agent-facing, less broadly visible) last.
5. Bump `"version": "2.3.0"` → `"version": "2.4.0"` in `package.json`.

## Phase 3: Verification

- [ ] Every claim in the new changelog entry traces to a commit or plan doc listed in Phase 0 — no invented behavior.
- [ ] Tone/format matches v2.3.0 entry: bold feature name on its own line, one paragraph, no bullet lists, no code blocks, second person avoided (matches existing "The X now Y" style).
- [ ] `git diff CHANGELOG.md` shows only an insertion above the v2.3.0 heading — no accidental edits to older entries.
- [ ] `package.json` version is `2.4.0` and no other file needs a matching bump (check `electron/main.js` / about dialog / `package-lock.json` for a hardcoded version string — grep for `2.3.0` repo-wide after the edit to confirm nothing else references the old version).
- [ ] Omitted items (Ko-fi funding link, README download-link update) are deliberately left out as non-user-facing — confirm this matches how prior changelog entries handled purely internal/docs commits (v2.3.0's "Internal" section shows *some* internal changes are included when they carry real signal for contributors — re-check whether Ko-fi/README-link commits meet that bar or are truly noise).

## Anti-patterns to avoid

- Do not describe the caption-style visibility feature as if it changes rendering behavior — it only changes what hints/warnings are shown; the actual caption rendering logic is unchanged.
- Do not claim the system font picker is new font *rendering* support — CapForge already rendered arbitrary fonts; this is a picker/UX change (selection surface), confirm scope via `d86f21e`/`35f3a60` diffs before writing, not assumption.
- Do not merge the "per-word font picker closing early" fix into the "searchable system font picker" feature entry — they're separate commits/PRs (#12 introduced the picker, #15's `70ed839` fixed an interaction bug in it weeks later); keep them as distinct changelog lines.
