# Changelog

▶ **[Watch the tutorial — how to use CapForge](https://www.youtube.com/watch?v=7xxLt5FEq1E)**

**Latest release — v3.0.0:** a library for your videos, with folders · the Publish workspace, with a post per channel · caption tracks in other languages · seven Claude skills and 61 tools · an interactive startup guide · one accent, AA contrast, Light / Dark / System · more than two dozen fixes. **If you are on 2.6 or older, update.**

## CapForge v3.0.0

This is the biggest release CapForge has had, and it is worth updating for even if you never open a new feature: more than 140 commits since 2.6.0, and more than two dozen of them are fixes to things you use every day — the `.ass` export, word timings after a text edit, file swaps on Windows, a library that came up empty after launch, panel widths that forgot themselves. Around those fixes the app grew a second half. CapForge now opens on a **library** of your videos, organised in folders, where every session saves itself into its record. Beside the caption editor there is a **Publish** workspace that turns a finished video into a copy-ready upload package — title options, a description with chapters, tags, speakers, a thumbnail — checked against YouTube's limits as you type, with a **post per channel** for TikTok, Instagram, LinkedIn and X. Captions can be written in **other languages** on the original timing. And Claude can do most of the writing: seven bundled skills and 61 tools read the library, draft the description, translate the captions and check a video before upload. A guided tour walks you through all of it on first launch.

Your projects, presets and fonts carry over untouched. On first launch the app imports your last project, the crash-recovery copy and any HyperFrames workspaces into the library, so the home screen is not empty. The **Open** button is gone — a `.capforge` file comes in through **Add to library…** or a double-click in Finder — and **Save** is now **Export project…**, because the library record is the save.

A library for your videos, with folders · the Publish workspace, with a post per channel · caption tracks in other languages · seven Claude skills and 61 tools · an interactive startup guide · one accent, AA contrast, Light / Dark / System · more than two dozen fixes.

### New Features

**A library for your videos**
CapForge opens on your videos now, not on an empty drop zone. Every video you transcribe, import or open becomes a record with a poster, a duration and a status — imported, transcribed, captioned, drafted, published — shown as pips on its card and as a word beside them. A "Continue" hero at the top names the last video you worked on and its next step. The editor's 2-second autosave writes into the record, so closing the app and opening the card brings back the transcript, the groups, the style and every language track exactly as they were; the old local recovery file is kept only as a fallback for when the backend is unreachable, and the app tells you once when that happens. A card whose media has moved says so and offers **Locate…**. Records live under `~/.capforge/library/`, one folder per video with a plain `record.json` and a `transcript.json`, readable by Claude with no window open. Remove takes a video off the shelf and keeps its folder; Delete moves the folder to the trash. Opening CapForge a second time hands the file to the window that is already running instead of starting another. While a card restores it says "Opening…". A new **Library** button in the editor goes home without ending the session; **New** still starts a fresh one.

**Folders, views, search and selection**
The library is laid out like a Finder window. A sidebar holds the folder tree — folders nest — with "All videos", "Unfiled", counts, and "+ New folder"; a path bar above the contents shows where you are, and its crumbs navigate and take drops. Videos and folders can be dragged onto a folder, the sidebar, a crumb or the empty-folder line to move them, and a card's menu has "Move to folder…" for the same thing. The toolbar switches between a **grid** with an icon-size slider and a **list** with sortable columns (name, duration, status, folder, published on, modified), and sorts by modified, name, duration, status or created. **Search** finds videos by title and by file name, on a prefix, accent-insensitively, scoped to the folder you are in or to everything. A single click selects; double-click or Enter opens. ⌘-click toggles, Shift-click ranges, ⌘A selects every visible video, the arrow keys walk the grid or the list, Esc clears, and ⌘⌫ asks to remove. With two or more selected a bar replaces the toolbar with **Move to…**, **Remove** and **Delete…**, each confirmed once with the count; right-click does the same on the selection. Rename a video or a folder in place from its menu or by clicking the name of the item you already selected. Every choice — layout, size, sort, location, which folders are open — is remembered. **Add to library…** (⌘O) is the one way in: files, whole folders and `.capforge` projects together, with one summary; **Transcribe…** picks one file and starts it right away.

**Import a folder, relink moved media, watch a folder**
Drop a folder of recordings, or pick one from Add to library…, and every media file in it becomes a record with a poster, nothing transcribed until you ask. Importing a folder whose files CapForge already knows heals the cards whose media had gone missing, so moving a drive and importing its new location is the whole repair; **Locate…** on a single card does the same by hand, and asks before linking a different file. Settings → General gains a **watch folder**: new files that land there become records on their own while CapForge runs, once they have finished copying, and a file you removed from the library is not imported again.

**The Publish workspace**
A **Captions | Publish** switch heads the right-hand column. The Publish side holds the record's dossier as cards: title options, a description with a 5000-byte meter and a preview of the first 150 characters YouTube shows, chapters (click one to seek; insert one at the playhead, snapped to a word start; a Suggest button proposes them from pauses and speaker changes), tags, keywords and hashtags, a speaker map, a summary, and the publish state, where pasting the YouTube URL marks the video published. Every rule about a field lives in the backend once — YouTube's hard limits (a 100-character title, a 5000-byte description, 500 characters of tags, no angle brackets, chapters from `00:00`, at least three, ascending, ten seconds apart and inside the video) and your own house style — and a finding is drawn under the field it concerns as you type, never enforced by cutting text. A field written by Claude carries a provenance chip with a **Revert**; while Claude is writing, a field you are editing is soft-locked so neither of you clobbers the other. The footer copies the assembled **upload package** — the exact text layout the publish skill has always produced, rendered live from the record — or a plain transcript, and exports SRT and VTT per language track. A read-only **Transcript** tab joins Text and Groups in the editor, with speaker ids, the active row during playback, a chapter gutter and "Insert chapter here".

**Channels, and a post per channel**
Settings → **Channels** lists the places you publish — any number of YouTube channels, TikTok, Instagram, LinkedIn and X. Each holds two things: **context** (what the channel is about, who it is for, how it sounds, how its titles are built), which is what Claude reads before drafting, and a **profile** (footer, links, recorded-at line, default hashtags, house rules), which is what the upload package pastes. The first YouTube channel is the primary one, and everything that read the old channel brief reads it now. In Publish, a **tab per channel** sits above the cards. The YouTube tab is the dossier described above; a TikTok, Instagram, LinkedIn or X tab is a post — caption or text, hashtags, a cover — metered to that platform's limits (LinkedIn 3000 characters and five hashtags with a "Watch:" line, X a weighted 280 where a link counts 23, Instagram 2200 characters with "Link in bio" and up to thirty hashtags) and copied as the text that platform's form takes. An empty tab offers **Start from…** to adapt another channel's text as a draft, without saving anything until you do. When you add videos, the import asks once which channels they will publish to, remembering the last answer; the `×` on a tab hides it and keeps its text, and `+` brings a channel back.

**Shorts, thumbnails and translated metadata**
Three more cards for the parts of an upload that are not the description. **Shorts** holds the Shorts caption and clip suggestions with a start and end taken from the playhead, snapped to a word, with a length and a reason; CapForge cuts nothing, you trim the clip in your editor. **Thumbnail** holds text ideas and a strip of frames: grab one at the playhead, upload your own JPEG, PNG or WEBP, click one to make it the cover — which the library card then shows — and save it out as a file. A 9:16 source keeps its vertical frame. **Localized** holds a title, description and chapter titles per language, one chip per language including the caption tracks you have not translated yet, each metered to the same limits, and the upload package can be copied in any of them, with the source text filling in for anything left blank.

**Folder settings: a footer for the whole event**
A folder is also a place to put what its videos share. **Folder settings…** (Settings → Folders) lets a folder override parts of the channel profile — the footer, the links, the hashtags, the recorded-at line — and fill named **slots** that a description template can place with `{{slot}}`. Subfolders inherit from their parents. The upload package is rendered at read time, so editing a folder's footer changes every member's package at once, with nothing rewritten per video: a forty-session event gets its footers regenerated in one pass.

**Claude works the library**
The MCP server grew from 34 tools to 61. Claude can list and search the library, read a stored transcript with no window open, write a title, description, chapters, tags and speakers into a record (refused with the exact finding when a rule is broken), grab thumbnail frames, mark a video published, open a video in the app, and read and write channels, folders and per-channel posts. A `capforge://publish` guide ships with the server — the publish workflow as topics Claude pulls on demand — along with four slash commands: `/breakdown`, `/describe`, `/chapters` and `/batch_publish`. Every tool a guide or a skill names is pinned to the server by a test, so the two cannot drift apart.

**Settings, and your skills, in one place**
The slide-over settings panel is a centred **Settings dialog** with a category rail and a search box that dims the categories that do not match; ⌘, opens it. **Claude & Skills** shows the connection and every bundled skill with its install state, and opens each one in an editor: your copy is yours, Save keeps it, Reset returns to the bundled text, Install puts it into Claude Code, and when a CapForge update changes a bundled skill you are told rather than overwritten, with Keep mine / Take new / Open both. The theme is **Light / Dark / System**, and System follows the OS live.

**A refreshed look**
One accent colour, the brand amber, in both themes; the electric blue is gone. Every label, footer and section heading now clears AA contrast on every surface — the small grey text measured 2.5:1 before — and the light theme moved to warm neutrals. Text sizes come from a named scale rather than ninety-odd hand-picked pixel values. Sliders look the same on macOS and Windows, with the filled part painted in the accent; a row's reset arrow appears on hover instead of sitting beside every slider; the "Ctrl+Wheel" hints on the video and the timeline show once, for a moment, and live in the `?` overlay. Every confirmation is the app's own dialog rather than the OS box. The right-hand column is resizable like the editor, both widths are remembered, and the timeline redraws when the window does. In the Groups view the merge button appears between two rows when you hover the gap.

**Caption tracks for other languages**
A project can now hold more than one set of captions. A tab strip above the editor starts with your Original track; pick a language from the `+` and you get a second tab with the same timing, the same style and blank captions waiting for text. Everything downstream is per tab — the preview, the timeline, the style sidebar, undo, presets, and the render and export buttons, which name their files after the language (`clip.pl.mp4`, `clip.pl.srt`). Translated captions are locked to the original audio the same way the transcript is: each caption keeps the span of the source words it was written from, so correcting a word or dragging a group end on the Original moves the translation with it, and word timings inside a translated caption are shared out by character count rather than measured. Anything you place by hand — a word edge, a group end — is pinned and left alone from then on. When the source does change underneath a translation the tab says so: a caption whose source words were edited is marked "source changed", one with no text yet is marked "no text", and if you re-chunk the Original into different caption groups the translated tab offers a one-click "Re-flow from source" that carries the still-matching translations across and hands back the rest with the old text attached so nothing is lost. A translated tab's Text view lists the same sentences the Original does, so a translation is written a sentence at a time rather than a caption fragment at a time, and the *Words/Grp* slider works there too — it re-cuts each translated sentence into captions of the length you ask for, without ever merging two sentences. Saved projects gained a second version that older builds still open — they simply show the original track and ignore the rest.

**For agents**
A connected Claude agent can drive the whole translation loop: `create_track` returns the new tab's blank captions paired with the source text to translate, `set_track_text` writes the translations back, and `check_layout(scan=True)` measures every caption at once and reports exactly which ones will wrap onto a third line — which is what a translation running 10–15% longer than English tends to do. `get_track` lists the captions that still need work, and `reflow_track` is the repair when the source's grouping moved. `set_style`, `apply_preset`, `render`, `render_frame`, `render_hyperframes` and `export` all take a track to work on.

**Five more bundled skills for Claude**
Settings → Skills now lists seven workflows instead of two. Beside capforge-init (channel setup by interview) and capforge-publish (the upload package) come **capforge-cleanup**, which removes fillers and fixes the names, products and split tokens WhisperX misheard without moving a single caption; **capforge-translate**, which adds a language tab, translates the captions sentence by sentence onto the original timing, shortens what wraps and can fill in that language's title, description and chapter titles for the upload package; **capforge-style**, which applies a preset or a look described in words, emphasises the numbers and names that matter, checks every caption for wraps and text over a face, and can give a whole folder the same look; **capforge-clips**, which finds the moments that stand on their own as Shorts, Reels or TikToks, times them to the transcript and writes the Shorts caption and a post per short-form channel (CapForge still cuts nothing: the user trims the clip in their editor); and **capforge-preflight**, a read-only pre-upload checklist over the record, the package, every channel and language, the transcript and the open captions, reported as one table with a fix for each line. Every tool a skill names is pinned to the MCP server by the same test that guards the first two.

**An interactive startup guide, and What's new**
A fresh install is now walked through the app itself rather than through a stack of cards. A spotlight picks out one control at a time and a card beside it says what it is for, while the app follows along: the first tour covers the library — adding a video, folders, search and the views — and then opens Settings on the transcription model, on channels and on connecting Claude, for real. The thing being pointed at stays clickable the whole time, ← and → step, and Esc leaves. Once your first video is transcribed a second tour picks up in the editor: the three transcript views, correcting and styling a word, the player and its timeline, language tracks, the style sidebar, export, and the Publish workspace, which it switches to and back. A tour that cannot show a control simply skips that step, and leaving the screen it belongs to ends it quietly. After an update, a "What's new" card lists the highlights of every version released since the one you last saw, newest first, and links to the full changelog. Nothing appears over a running transcription. All three can be reopened any time from Settings → General → About, which also shows the version you are running. An existing install that has never seen either prompt gets the release notes rather than the tour. The tutorial video plays inside the first card when you ask for it, and opens in your browser when you would rather watch it there; nothing is loaded from YouTube until you click.

**A copy button on every Publish field**
Each box in the Publish workspace — the title, description, tags, hashtags, chapters, keywords, summary, the Shorts caption, every channel tab's post text and hashtags, and every field of a translated language — now has a small copy button beside its label, so an upload form can be filled one field at a time. It copies the box's text exactly as shown (the chapters as the `MM:SS Title` lines YouTube reads) and is disabled while the box is empty. "Copy package" in the footer still copies the whole assembled text.

**Scrub the timeline and the waveform by holding the mouse down**
The playhead can be grabbed and dragged: press on it, on the ruler, on empty track space or anywhere on the waveform and the player follows the pointer for as long as the button is held, past the edges of the strip too. Before, every seek was a click that dropped the playhead once. A click still seeks and deselects, a segment's edge still resizes it even when it sits on the playhead, and a segment's body still moves or selects it.

### Performance

**A faster start and a warmer model**
The window opens first and the backend is polled every 100 ms rather than waited for, so the app is on screen before Python is. Dropping a file warms the Whisper model while you look at the settings; the alignment model stays resident between jobs instead of being loaded and freed every time; the hardware probe is cached; transcription uses every CPU core. A "free model memory after each job" toggle in Settings → Transcription gives the memory back on machines that need it.

### Fixes

**New goes to the transcribe screen**
The editor's New button used to send you back to the library; it now opens the transcribe screen so the next file can be dropped straight away. Library is still one click away on its own button. Cancelling a transcription lands on the same screen.

**`.ass` exports are readable cues too**
The `.ass` exporter still wrote one line per transcription chunk, so several sentences could sit in a single huge subtitle — the problem v2.6.0 fixed for `.srt` and `.vtt`. It now uses the same cues as those two: split at sentences, at most two lines of 42 characters, at most seven seconds, with the same start and end times. The word-by-word karaoke highlight survives inside each cue, and the line break falls where the `.srt` breaks it. `.srt` and `.vtt` output is unchanged.

**The library was empty after a fresh launch**
The renderer could fire its first request before the backend's port and token were known, so the library listed nothing until something else refreshed it. The port and the token are resolved before the first request.

**Edits no longer move the words you did not touch**
Two more gestures learned the rule from 2.5. Dragging a word's edge on the timeline, or fixing its text from the word popup, wrote the change to the caption group only, so the next edit in the Text view put the old timing back. Both now write through to the transcript, and a hand-placed word timing survives a text edit.

**Windows: file swaps that hit a sharing violation are retried**
Antivirus and indexers hold files open for a moment on Windows, which made an atomic replace — a record write, a frame grab — fail with a permission error. Those swaps and reads retry briefly; frame grabs use the same Windows-safe replace.

**Posters are grabbed, and never upscaled**
The poster grab failed on every record because ffmpeg refused the unquoted scale filter. It is grabbed for every creation path now — a drop, an import, the agent, a project restore — with a startup backfill for records that have none, and a small source is never blown up.

**Search finds a video by its file name**
Searching the library only matched the title, and only whole words. It now matches the file name too, on a word prefix, ignoring accents.

**Publish: chapter suggestions, findings and drafts**
Suggest could let a 4-second pause stand in for the opening chapter, producing a list the validator always refused; the `00:00` row is claimed first. A finding on a chapter row was never drawn. A field Claude wrote while you had unsaved text in another card wiped that draft; drafts on untouched fields now survive an agent write. And a save that changed nothing no longer bumps the record's revision or writes a history entry.

**Small things**
Three CSS tokens were referenced but never declared, so a few hovers and labels fell back to inherited colours; a test now refuses that. The `,` playback and timeline keys fired together with ⌘,. The coach-mark scrim flickered on Windows and the Settings dialog stayed open under a tour started from About. The new-channel row overflowed the Settings dialog. The library card's footer clipped the date. The inactive chips and word blocks on the timeline were washed out.

### Internal

**The two preloads cannot drift**
A test loads `electron/preload.js` and the TypeScript mirror under a mocked Electron and asserts the same names, shapes and IPC channels, so an API added to only one of them fails CI instead of type-checking and doing nothing at runtime.

**Contract tests for the record**
Every `VideoRecord` field must be filed as authored or system, chapters are pinned to seconds, the built-in template slots are pinned to a fixture shared with the renderer, the media extension list is pinned across its three copies, and every design-system token that is referenced must be declared. A Windows CI job checks the bundled Python has `sqlite3` with FTS5, which the library index needs; without it the index falls back to a substring search rather than failing.

**A release ships with its notes**
`releaseNotes.ts` — what the What's new card shows — is pinned to `package.json`'s version and to the headings in this file. Bumping the version without writing the notes fails the frontend CI job.

### Upgrading

**What happens the first time 3.0 opens**
Your last project, the crash-recovery copy and every HyperFrames co-author workspace whose source file still exists are imported into the library as records, once. Nothing is moved or deleted: the library keeps its own copy of the session under `~/.capforge/library/`, and a `.capforge` file you exported stays where it is and still opens through Add to library… or a double-click. Project files written by 3.0 still open in 2.x, which shows the original captions and ignores the language tracks. The channel brief from 2.6 becomes the primary YouTube channel on first read; the old `brief.json` is left as it was. A bundled skill you had edited is kept; the Skills card tells you when the bundled text changed.

<!-- Release rule: bumping `version` in package.json without adding a matching
     entry to `src/renderer/src/lib/releaseNotes.ts` and a `## CapForge v<version>`
     heading here fails `releaseNotes.test.ts` in the frontend CI job. That is
     intended: a release ships with its notes or it does not ship. -->

## CapForge v2.6.0

This release is mostly about new ways to read a caption. There's a Spritz-style speed-reading mode where the line slides under your eye instead of your eye moving across it, and short silences between captions no longer blank the screen. Colours can be gradients now, and the transcription model is finally something you pick rather than a silent 1.6 GB download.

### New Features

**RSVP speed-reading captions**
A new reading mode lays the caption out as a single unwrapped line that slides so the active word's focus letter stays pinned to a fixed column — the Spritz layout, where your eye holds still and the words move past it. Consecutive captions with no blank frame between them flow through as one continuous line rather than snapping back to the first word each time. The new Reading card sets the mode and everything about it: where the focus column sits, how long the slide takes, how much the surrounding words dim, the edge fade, the focus colour, and an optional reticle marking the pivot. It renders identically in the live preview, the classic export and the HyperFrames engine.

**Captions held across short gaps**
A brief silence between two captions used to blank the screen for a few frames, which reads as a flicker. Captions are now held across gaps shorter than a threshold you set — the "Gap close" dial in the Layout card, 0.25s by default — and the final caption is held past its last word by "Hold last", one second by default, so it doesn't vanish the instant speech stops. Either dial at 0 turns that half off. Both apply to the preview and the render alike, and an end you placed by hand, dragged on the timeline or typed in the Groups list, is left exactly where you put it. The manual button that stretches every group is now called "Close all gaps".

**Choose your transcription model**
CapForge always downloaded and ran Large Turbo, about 1.6 GB, which put the app out of reach of low-end machines entirely. The first-run wizard now shows every model with its download size and its trade-off — Tiny at 75 MB through Large Turbo — and installs only the one you pick; a dropdown in Settings changes it afterwards, and a model you haven't downloaded yet is fetched the first time you use it. Large Turbo is still pre-selected everywhere, because the smaller models are noticeably less accurate; what changed is that the 1.6 GB is now an informed choice with a one-click downgrade. Accepting the recommendation still leaves the app free to step down to a lighter model on a GPU with too little memory for turbo, exactly as before.

**Gradient caption colours**
Caption text and the background box can each take a linear gradient instead of a flat colour. The colour picker gained a gradient mode with sliders for the angle and for each stop's position, and stops can be added or removed; "Add stop" splits the widest gap. Gradients render identically in the live preview, the classic export and the HyperFrames engine. Words carrying a colour of their own — the active word, per-word overrides — stay flat.

**Favorite fonts**
Star a font to pin it to the top of the picker, in both the main font list and the per-word override popup.

### Fixes

**Subtitle exports are readable cues, not paragraphs**
An exported `.srt` or `.vtt` could hold a whole paragraph in a single cue, because each cue was a raw transcription chunk rather than a sentence. Exports are now split along the standard broadcast conventions — 42 characters a line, at most two lines, at most seven seconds — breaking at sentence boundaries first, then on length, then on duration, without being fooled by abbreviations, initials, decimals or a lowercase continuation. Cue times are copied from the existing word timings and never recomputed, so nothing drifts against the audio. The `.ass` exporter still emits one cue per chunk; splitting it means re-scoping its per-word karaoke tags, which is a separate job.

**Colour picker no longer clipped by the studio card**
The picker popover was drawn inside the studio card, which clips its contents in order to round its header — so the taller gradient editor lost its stop rows and its Add-stop button off the bottom edge, and the plain colour picker was being clipped too, just less visibly. The popover now floats above the card and flips above the swatch when there isn't room below.

**Restored projects render again**
A project saved by an older build could fail to render with an opaque "Unprocessable Entity" error: settings added to CapForge since that project was saved were missing, and turned into invalid numbers on the way to the renderer. Opening a project now fills in the current defaults for anything the file doesn't carry.

**Presets no longer reset your caption grouping**
Applying a preset wrote its own words-per-group value, which rebuilt every group from scratch and threw away hand-edited group ends along with them. Grouping is a per-project setting now, and presets leave it alone. Older presets and shared `.cfpreset` files still load; their grouping value is simply ignored.

**Private system fonts hidden from the picker**
macOS marks its internal faces with a leading dot in the family name — 73 of the 380 families on a stock install. They no longer clutter the font list. A project that already references one keeps rendering.

### Internal

**RSVP and gradients pinned across all three renderers**
Both features have a shared scalar core written out three times — Python, TypeScript and the embedded HTML runtime — pinned against one another by shared JSON fixtures, plus new golden frames and cross-renderer parity runs. The preview, the classic export and the HyperFrames engine can't drift apart on either feature without a test going red.

**The continuous RSVP line is fast enough to preview**
Flowing captions through group boundaries means measuring a much longer line every frame. The off-screen part is culled and each line's layout is cached, both pixel-neutral: 900 words a frame drops from 140ms to 9.7ms.

## CapForge v2.5.0

This release is mostly about trusting your edits. Correcting a word in the transcript, or rearranging caption groups by hand, used to quietly undo work elsewhere — that whole class of desync is gone. Plus per-word background boxes, and the agent tooling needed to run a batch end to end.

### New Features

**Per-word background boxes**
The Background card's box can now be scoped to a single word. The per-word style popup gained a "Word background" section with its own enable toggle: switch it on for a word and it gets its own box, while colour, radius, padding and opacity you don't touch keep inheriting the global Background settings. Boxes sit under the highlight pill and hug scaled words, and render identically in the live preview, the classic export and the HyperFrames engine.

**Agent batch control**
A connected Claude agent can now drive a full batch: load a video into the open app, clean up the transcript, apply one of *your* saved presets, and render the deliverable — new `load_video`, `list_presets` and classic `render` tools. Presets resolve against your own library first and built-ins second, and applying one waits for the app to confirm which preset actually landed, so a batch run can't render the next video with the previous one's style. The classic render tool has no approval gate, which is what makes unattended runs possible.

### Fixes

**Correcting a word no longer desyncs the rest of the caption**
Adding a word, or splitting one in two, used to shift the timing of every later word in the segment. Word timings are now reconciled by matching text rather than by position: words you didn't touch keep their exact original timing and their per-word styling, and only the run you edited is re-timed, inside its own span. An inserted word takes the silence between its neighbours when there is any, otherwise it borrows from the end of the word before it — at most one neighbour ever moves.

**Custom groups survive edits to the transcript**
Manually arranged caption groups — a word dragged into a non-adjacent group, a reordered group, a merge or a split — were thrown away the moment anything changed in the source transcript, most visibly as "Fill gaps resets my custom groups". Groups are now tracked by word identity instead of by position, so your arrangement survives, and a group you haven't touched keeps its exact start and end — which is what preserves a manual timeline drag and the baked "Fill gaps" end time.

**An agent setting shadow opacity could break every later render**
The style settings don't all share one scale — background opacity is a percentage, shadow and highlight opacity are fractions. An agent that set shadow opacity to 90 by analogy with the background left the project in a state the renderer refuses, and because the bad value was saved into the preset, re-applying it or nudging another control reproduced it. Out-of-range values are now repaired wherever style comes in from outside the app's own controls — agent commands, presets, and opened projects — and a value written on the wrong scale is read as the percentage it obviously was. Renders that fail validation anyway now say which field is wrong and what to do about it, instead of suggesting a refresh that can't help.

**Merging two words could drop a caption early**
After merging words, a group could keep timing bounds from before the edit and disappear before its own last word had finished. Manual timing is now only restored when the group's words are genuinely unchanged.

### Internal

**Per-word background pinned by parity tests**
The new word box is covered by a golden frame plus a five-scenario cross-renderer parity run — stacking under the highlight pill, inheritance from a non-default global background, scaled words, and second-row placement — each verified by deliberately breaking the implementation to confirm the test catches it.

**Source files readable in diffs again**
Two internal sentinel values were written as literal NUL bytes, which made git classify `wordTiming.ts` and `wordIds.ts` as binary and suppress their diffs and blame. Same runtime behaviour, now written as escape sequences.

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
