# Changelog

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
