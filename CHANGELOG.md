# Changelog

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
