# Changelog

## Unreleased

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
