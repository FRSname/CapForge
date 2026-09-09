# Changelog entry — multi-language caption tracks

Written in the voice of the `## CapForge v2.6.0` section of `CHANGELOG.md`, ready to paste
under the next version's **New Features**. `CHANGELOG.md` itself was deliberately not
touched.

---

### New Features

**Caption tracks for other languages**
A project can now hold more than one set of captions. A tab strip above the editor starts with your Original track; pick a language from the `+` and you get a second tab with the same timing, the same style and blank captions waiting for text. Everything downstream is per tab — the preview, the timeline, the style sidebar, undo, presets, and the render and export buttons, which name their files after the language (`clip.pl.mp4`, `clip.pl.srt`). Translated captions are locked to the original audio the same way the transcript is: each caption keeps the span of the source words it was written from, so correcting a word or dragging a group end on the Original moves the translation with it, and word timings inside a translated caption are shared out by character count rather than measured. Anything you place by hand — a word edge, a group end — is pinned and left alone from then on. When the source does change underneath a translation the tab says so: a caption whose source words were edited is marked "source changed", one with no text yet is marked "no text", and if you re-chunk the Original into different caption groups the translated tab offers a one-click "Re-flow from source" that carries the still-matching translations across and hands back the rest with the old text attached so nothing is lost. The *Words/Grp* slider works on a translated tab too, where it re-chunks each inherited caption into shorter rows without ever merging two captions the original kept apart. Saved projects gained a second version that older builds still open — they simply show the original track and ignore the rest.

**For agents**
A connected Claude agent can drive the whole translation loop: `create_track` returns the new tab's blank captions paired with the source text to translate, `set_track_text` writes the translations back, and `check_layout(scan=True)` measures every caption at once and reports exactly which ones will wrap onto a third line — which is what a translation running 10–15% longer than English tends to do. `get_track` lists the captions that still need work, and `reflow_track` is the repair when the source's grouping moved. `set_style`, `apply_preset`, `render`, `render_frame`, `render_hyperframes` and `export` all take a track to work on.
