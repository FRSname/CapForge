# Changelog

## CapForge v2.4.0

### New Features

**Lithuanian transcription support**
WhisperX word-level alignment now works for Lithuanian, a language that previously produced broken timing. The alignment model revision is pinned so results stay reproducible across runs, and if alignment quality degrades for any language the app now shows a persistent notice in the results view rather than failing silently.

**Searchable system font picker**
The font picker — both the main caption font and per-word font overrides — now lists every font installed on your system, not just the fonts bundled with CapForge, and lets you search by name instead of scrolling a long list. System fonts don't embed into exported `.cfpreset` files, so exporting a preset that uses one now shows a warning.

**Timeline inline editing**
Right-click a word in the timeline's word lane to open the same text-correction and style popup available in the Text/Groups views, or right-click a group block to adjust its position — without leaving the timeline. Right-click was chosen over double-click because it opens in one gesture and doesn't race the existing click-to-select behavior.

**Caption-style visibility hints**
When a HyperFrames caption style other than Classic is selected — by you or a connected Claude agent — the app now shows a hint that the style only appears in the HyperFrames preview and render, not the live Canvas preview. In co-author mode, where the agent's own project decides what's rendered, a warning now appears if an installed caption style is never actually wired up, and the agent gained a new tool to install registry caption styles into a co-authored project.

### Fixes

**Per-word scale now matches the highlight pill**
Scaling an individual word's font size from the per-word style popup now scales the highlight-effect pill behind it to match, across the Canvas preview, the classic Pillow export, and the HyperFrames engine. Previously the pill stayed at the global size while the word itself scaled.

**Non-ASCII registry caption crash**
Scaffolding a HyperFrames registry caption style with an accented or non-Latin transcript, such as Czech, used to crash. Fixed.

**Per-word font picker closing before selection committed**
Picking a font from the per-word style popup's searchable dropdown sometimes did nothing, because the popup closed itself before the selection registered. Fixed.

### Internal

**Alignment tests no longer depend on live Hugging Face calls**
The Lithuanian alignment test suite was decoupled from live network calls to Hugging Face, so it stays fast and reliable in CI regardless of external service availability.

## CapForge v2.3.0

### New Features

**Effect packs**
Reusable effects are now HyperFrames-native effect packs — plain folders (HTML + usage notes + assets) that the connected agent imports into your project workspace and wires up by hand, following each pack's own rules. Effect packs replace the previous effect-template library and the on-screen effects timeline, which have been removed: agent-authored, engine-native effects are now the single effects path.

**Fill gaps, baked in**
"Fill gaps" is now a one-click button in the Groups view that stretches each caption group to the start of the next one as a real, undoable edit — no hidden toggle state. Group end times are also directly editable per group (click the end time in the Groups list), so you control exactly how long any caption stays on screen.

**Static captions**
A new word style, "None (static)", displays captions without any per-word animation — identical in the live preview, the classic renderer, and the HyperFrames engine.

**Highlight pill offset**
New Offset X/Y controls nudge the highlight pill independently of the text, for looks where the pill sits behind or beside the word rather than exactly on it.

### Fixes

**Correct colors in editing software**
All video exports except WebM (overlay MOV, overlay MP4, baked MP4) now force the color conversion to BT.709 limited range and tag the stream accordingly, so Premiere, Resolve and other NLEs stop guessing the color space. This fixes hue shifts on saturated colors and washed-out-looking imports.

**Transparent overlays composite correctly**
The ProRes 4444 overlay export now writes premultiplied alpha — the QuickTime convention — fixing semi-transparent caption backgrounds compositing incorrectly in NLEs. (If Premiere auto-detects the clip as "Straight Alpha", conform it to Premultiplied.)

**Theme consistency**
A sweep across the editor, studio panel and title bar fixes text colors that Tailwind could misparse and render incorrectly, including hover/focus states — both themes now behave consistently everywhere.

**New app icon**
The refreshed brand icon now appears everywhere: the macOS app (Dock, Finder, DMG), the Windows installer, and the in-app title bar.

### Internal

**Renderer formulas pinned by tests**
The renderer test suite more than doubled (126 → 274 tests). Caption geometry, timeline math and undo logic were extracted verbatim into pure, unit-tested modules (`overlayGeometry`, `timelineMath`, `undoStack`), so the preview↔export parity formulas are now pinned on the TypeScript side too.

**Size refactors, parity-verified**
The studio settings panel was split into per-section components, and ffmpeg encode/mux logic was extracted from the frame renderer into its own module — verified byte-identical against the golden-frame suite and the full 20-scenario caption-parity run.

**Reproducible release builds**
The real macOS `.icns` and Windows `.ico` app icons are now tracked in the repository (previously they lived only on the build machine), so release builds work from a fresh clone.

## CapForge v2.0.0 — Enhanced

The Enhanced release turns CapForge from a caption editor into an AI video director: a second GSAP/HTML render engine, an on-screen effects timeline, agent-authored caption looks, and a Claude agent that can place and style all of it in the running app. Everything is additive — the classic renderer and workflow are unchanged.

### New Features

**AI video director (HyperFrames render engine)**
A second render path now sits alongside the classic Pillow renderer, rendering captions and on-screen effects through the real HyperFrames engine (GSAP animation, HTML/CSS looks). On this path you can place five kinds of effects on a timeline — an animated **logo**, a **lower-third** name/title bar, a big **kinetic stat** (e.g. "2.4M"), a swept word **highlight**, and timed **b-roll** inserts — composited over the captions and the source video. The classic renderer ignores effects and still needs nothing extra.

**Agent-driven effects & live control**
A connected Claude agent can find where to place effects — a literal phrase, or semantic moments like spoken numbers (for a kinetic stat), calls to action, or speaker changes (for a lower-third) — and drop them in, with every placement mirrored live into the editor's effects timeline. The agent drives the same app you have open, so its edits, styles, and effects appear in the preview as it works.

**Native & agent-authored caption styles**
Beyond the default `classic` captions you can choose native HyperFrames caption styles (e.g. a karaoke pill) pulled live from the catalog and fitted to portrait, 4K, or square canvases. An agent can also invent a brand-new caption look from scratch in HTML/CSS/GSAP — validated against a strict contract (transparent overlay, paused timeline, entrance-only, deterministic) and rendered by the genuine engine.

**HyperFrames Studio & reusable effect templates**
"Open in HyperFrames Studio" launches a live browser preview of the composition for inspection and refinement before you commit to a render. Any effect can be saved as a reusable "look" template and dropped into other projects — for logo and b-roll effects the image is copied into the template store, so the look survives the original project being deleted.

**HyperFrames creative library for the agent**
The bundled MCP server now serves the genuine HyperFrames creative references — caption craft, motion principles, GSAP timing/easing, typography, palettes, and transitions — to the connected agent on demand, so agent-authored looks draw on real design vocabulary instead of guesswork.

**Works out of the box (bundled Node runtime)**
The HyperFrames features run on Node.js. CapForge now provisions an app-managed Node 22 runtime plus the HyperFrames CLI and render browser on first run, so render, single-frame preview, native caption styles, and Studio all work without installing anything. Provisioning is opt-in from the UI, resolves the right binaries per platform (including Windows via `node <cli.js>`), and the classic renderer needs none of it.

**Shareable presets**
A saved style preset can now be exported to a single `.cfpreset` file and imported — including on another machine. Custom (user-uploaded) fonts ride along *inside* the file as embedded data, so a shared preset renders with the right typeface on the recipient's machine; bundled CapForge fonts are referenced by name and re-resolved locally. Export from a preset's row in the **Presets ▾** dropdown (hover to reveal the ↑), and Import from the dropdown header. Imported files are validated as untrusted input (type/version checks, size cap, safe font writes).

### Internal

**Expanded agent toolset over the control bus**
The MCP control layer introduced in v1.9.0 gains the full effects, caption-style, custom-caption, HyperFrames-render, and creative-library tool families, all driving the running backend over token-guarded `/api/agent/*` endpoints with live `/ws/progress` broadcast. Because delivery rides the bundled server, already-connected users get the new tools with the next app build — no re-connect needed. Preset export/import is handled by a pure, isolated `electron/preset-io.js` format module.

**Tests**
New backend suites cover HyperFrames project/render/export/caption generation, the effect-template store, and literal + semantic moment detection; the MCP server adds creative-library tests (manifest↔file integrity, path-traversal rejection, no orphan topics); the frontend adds effects-persistence and Claude-connect helper tests.

## CapForge v1.9.0

### New Features

**AI control layer (Model Context Protocol)**
CapForge can now be driven by a local Claude agent. A bundled MCP server connects Claude Desktop or Claude Code to the running app, so you can ask the agent to clean up and restyle your captions and watch every change apply live in the editor and preview. Connect in one click from Settings → Claude AI integration — CapForge writes the client config and ships its own Python runtime, so there's no terminal setup.

**Live transcript cleanup**
The agent can fix transcription mistakes — misspellings, homophones (their/there), casing, brand-name consistency — and strip filler words (um, uh, er) while leaving every other word's timing intact so captions stay synced to the audio. Edits appear in the editor instantly; if you're mid-edit, the change is queued behind an "Apply" prompt instead of overwriting your work.

**Keyword emphasis & live styling**
Ask the agent to make important words bigger, recolor them, or give them a different animation (bounce, pop, highlight, scale). It can also change the global look — font, colors, position, animation — or apply a built-in preset by name. Everything updates the live preview and carries through to the final render.

**Visual design review**
The agent can render the subtitle frame at any timestamp — composited over the actual video — and look at the result to catch design problems like captions covering the speaker's face or poor contrast, then adjust and re-check. A layout check reports the caption's bounding box and flags platform safe-zone overlaps as guidance (you can still go over them intentionally).

### Internal

**MCP server + control bus**
A new `mcp_server/` package exposes the agent tools over stdio and talks to the backend over loopback with a per-session token (persisted across restarts, with a self-healing client). Adds token-guarded `/api/agent/*` endpoints, a renderer↔backend control channel for relaying style/emphasis commands, and single-frame QA rendering. Covered by new unit and integration tests for the transcript transforms, settings-command logic, client connect flow, and frame rendering.

## CapForge v1.5.0

### New Features

**Settings search & section reset**
The studio sidebar has a search box that filters the 40+ style settings by name or keyword, opening just the matching rows. Each settings card shows a brand-orange "n changed" badge when any of its values differ from defaults, with a one-click section reset that registers as a single undo step.

**Keyboard-shortcut overlay**
Pressing `?` opens an overlay listing every shortcut (playback, editing, groups, timeline) — the same source of truth that renders the reference list in Settings. The Text/Groups tabs gained Cmd/Ctrl+1/2 shortcuts and proper tab semantics with arrow-key switching.

**Sticky render actions**
The "Render Video" and "Subtitles Only" buttons moved to a pinned footer below the settings scroll, so the primary action is always reachable; render status now displays next to the buttons that triggered it.

**macOS window chrome**
On Mac the native title bar is hidden (`hiddenInset`) and the traffic lights sit inside the app's own 38px title bar, giving a single seamless chrome. Windows/Linux keep the native frame.

### Design & UX

**Design-system hardening**
Brand orange (#D4952A) is now a proper token (`--color-brand`) and every hardcoded UI-chrome color flows through the theme system, so light/dark stay consistent. A z-index scale replaced ad-hoc values across overlays. Shared Button/IconButton/SegmentedControl/Select primitives replaced duplicated inline markup.

**Self-hosted fonts**
Inter and JetBrains Mono ship as variable woff2 files and Instrument Serif as a static italic (~95 KB total) — UI typography no longer depends on the Google Fonts CDN and works fully offline. The Instrument Serif brand voice now appears in the title-bar wordmark, progress headline, and empty states.

**Motion system**
Screens fade-rise in on mount, settings cards animate open/closed, presets and word-style popovers scale in, toasts animate out, and buttons have designed hover/press states — all compositor-friendly (transform/opacity) and fully disabled under "Reduce motion".

**Accessibility**
Global focus-visible rings, `prefers-reduced-motion` support, focus-trapped modals with Escape-to-close, aria-live announcements for toasts and render progress, keyboard-reachable word chips in the active segment, and Escape no longer able to accidentally cancel an in-flight render.

**Safe-zone preview guides**
A new "Safe zones" control in the Layout card overlays TikTok, Reels, or Shorts UI margins on the video preview — dimmed bands plus a dashed caption-safe boundary — so you can see whether captions collide with platform chrome before rendering. Guides are preview-only and never appear in the rendered video. Resolution preset chips (9:16, 4:5, 16:9) were added to the custom render panel.

**ASS export with karaoke word timing**
A new .ASS export carries per-word `{\k}` karaoke timing and a default style into Premiere, Resolve, or ffmpeg/libass pipelines — word-level highlight timing without rendering a video.

### Performance

**2.4–5.5× faster subtitle rendering**
The video renderer now caches frames whose content is fully determined by a discrete state (active group + per-word highlight state) and only re-renders inside animation windows. On a 60 s 1080×1920 clip at 30 fps, frame generation dropped from 11.5 s to 4.8 s with fade animation and from 11.1 s to 2.0 s without group animation, with byte-identical output verified per frame.

### Bug Fixes

**Pop animation crashed every render**
Renders with the "pop" animation failed because Pillow's `Image.transform()` rejects the LANCZOS resampling filter. The pop branch now uses BICUBIC (the highest quality `transform()` supports).

**Title-bar wordmark unreadable**
The "Cap" half of the CapForge title-bar wordmark rendered with an inverted color (white in light mode, black in dark mode) because a Tailwind v4 arbitrary value was misparsed as a font size instead of a text color. The color now flows through an inline style and follows the theme.

**Status toasts unreadable in light mode**
Success and error toasts showed dark text on a dark background in light mode: the toast surface colors referenced theme tokens that were never defined, so they always fell back to the dark-mode values. Proper light/dark toast surface tokens were added and the status icons now use theme-aware colors.

### Internal

**Test & CI foundation**
The project now has 44 frontend unit tests (groups, presets, render-config bridge), 51 backend tests including golden-frame parity tests for the renderer and a byte-exact frame-dedup equivalence suite, ESLint, and a GitHub Actions workflow running typecheck, tests, and lint on every push.

## v1.4.0

### New Features

**Autosave & crash recovery**
The active editing session is now snapshotted to app data a couple of seconds after each change. If the app crashes or is closed without saving, the next launch offers to restore that session (Restore / Discard). A muted "Saved HH:MM" indicator in the title bar shows the last autosave time. Explicitly saving a project — or starting a new one — clears the snapshot, so a leftover snapshot at launch always means an unexpected close.

**Timeline caption editing**
Caption blocks can now be dragged directly on the canvas timeline to retime them, with edge snapping, an adaptive ruler that adjusts tick density to the zoom level, and hover tooltips showing exact timings.

**Synced waveform & timeline**
Zoom and horizontal scroll now stay in lockstep between the WaveSurfer waveform and the canvas timeline, and the zoom level is preserved when you edit a segment instead of resetting.

**Richer Text editor**
Click any segment to edit it in place, move between segments with the keyboard, split or merge segments, and search across all subtitles to jump to a line.

**Richer Groups editor**
Added keyboard navigation between groups, drag-to-reorder for whole groups, inline speaker-label editing, and a round of interaction polish.

**Keyboard shortcut hints**
The Settings panel now includes a reference section listing the app's keyboard shortcuts.

**Reworked editing layout**
The editor panel moved to the left side of the window and the undo/redo controls moved into the title bar.

### Changes

**Per-word styling consolidated to the Groups editor**
Per-word style overrides (color, size, font, animation, position) are now set in one place — right-click a word in Groups view. The duplicate styling entry point in the Text editor was removed so the two views can no longer apply conflicting overrides to the same word.

### Bug Fixes

**Group styling wiped by later text edits**
Per-word style overrides set in the Groups editor were lost whenever subtitle text was edited afterward, because the group sync rebuilt words from the source segments. Overrides are now carried through the sync and survive text edits and segment add/delete.

**Manual group timing reset on text edit**
Dragged group start/end times were being overwritten with word-level timestamps during the text-edit sync. Manual bounds are now preserved.

**Group display ignored text edits after a manual group edit**
Once groups had been manually merged or split, later text edits did not appear in the Groups view — a React Strict Mode double-invoke walked the word counter past the end of the pool. The counter now resets correctly on each pass.

**Text edits silently reverted during playback**
Editing a subtitle's text could be undone by a re-render fired on every playback tick, so the change was never saved. The editor now initializes its content once on entry instead of on every render.

## v1.3.0

### New Features

**Per-word playback highlighting**
The active word now highlights in real time as the audio plays, giving precise visual feedback on which word is being spoken.

**Timeline playhead follow**
The subtitle timeline auto-pans during playback to keep the playhead in view — no more manually scrolling to find where you are.

**Edit mode auto-focus**
Switching to edit mode now jumps the editor to the segment at the current playback position, so you always land on the right subtitle.

**Delete subtitle in edit mode**
A delete button is now available in the timing bar of each subtitle row while in edit mode, allowing you to remove a subtitle without switching views.

**Undo/redo buttons**
Visible ↩ / ↪ buttons have been added to the editor tab bar. Undo and redo were already available via Cmd+Z / Cmd+Shift+Z — the buttons make them discoverable and show when the history is empty.

**Undo covers timeline edge drags**
Dragging a subtitle block's start or end edge on the canvas timeline is now fully undoable. Previously, timeline drag was the only edit that could not be undone.

### Bug Fixes

**Playhead not moving during playback**
Fixed a stale closure where the timeline draw function was captured before the audio duration was known, causing the playhead to stay frozen at the start position during playback.

**Subtitle add/remove corrupting other subtitles' timing**
Fixed a word-index misalignment in the group sync logic. When a subtitle was added or deleted while groups had been manually edited (merge/split), the sync would walk through the word pool using stale word counts, causing adjacent subtitles to display the wrong timing. The fix detects segment count changes and rebuilds groups from scratch in those cases, leaving the incremental sync only for edits where the word pool is stable.
