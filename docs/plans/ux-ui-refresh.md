# UX/UI refresh: one accent, legible type, quieter chrome

A review of the running app on 2026-09-17 (library, editor Text + Groups, Publish, Settings, both themes) found a sound structure — three-pane editor, restrained motion, a real token system, 156 `aria-label`s, a focus ring — undermined by three things: the app has **two accents** (brand orange and an electric blue that is GitHub Primer's palette in light mode), its wayfinding is set in **10 px grey type that fails AA contrast**, and secondary affordances (merge, reset, wheel hints, provenance chips) are **always on** instead of on demand.

This plan is a ladder of six PRs. Each is shippable alone; the order is the order of payoff.

| PR | Scope | Files touched (approx.) |
|---|---|---|
| 0 | Two undefined tokens (a bug, not a design change) | 2 |
| 1 | One accent, AA contrast, the type scale | `globals.css` + a token test, ~10 call sites |
| 2 | Studio chrome: sliders, reset icons, section labels, hints | 5 |
| 3 | Library: toolbar naming, hero, status word, root label | 6 |
| 4 | Editor: merge on hover, timeline chip threshold, toggle placement, title bar | 5 |
| 5 | Publish: header dedupe, provenance only when written | 4 |
| 6 | Consistency: one confirm dialog, hard-coded colours, appearance setting | ~12 |

Decisions that need Filip are collected in §8. Everything else is a proposed default.

## 0. Fix the two tokens that do not exist

`var(--color-accent-hover)` is used twice (`components/editor/WordStylePopup.tsx:724`, `components/editor/GroupPositionPopup.tsx:151`) and `var(--color-text-subtle)` five times (incl. `.placeholder-subtle` in `globals.css`). Neither is defined in `@theme` or `:root.light`, so those hovers and placeholders silently render the fallback (no hover change, inherited colour).

- Replace `--color-accent-hover` with the existing `--color-accent-2`.
- Replace `--color-text-subtle` with `--color-text-3`.
- Add `src/renderer/src/styles/tokens.test.ts`: read `globals.css` from disk (the pattern `lib/tourSteps.test.ts` uses), collect every `var(--color-…)` and `var(--shadow-…)` referenced under `src/renderer/src`, and fail on any name not declared in `@theme` or `:root`. This is the guard that keeps PR 1 honest too.

## 1. One accent, AA contrast, the type scale

### 1.1 The accent becomes the brand

Today: `--color-accent` `#5b7ef7` (dark) / `#0969da` (light) on every button, toggle, slider, selected tab and focus ring; `--color-brand` `#D4952A` on the logo, the export footer, the status pips, the progress screen, the folder glyphs and the hero label; `--color-amber` on timeline chips. Three warm-vs-cold systems on one screen, and the light theme reads as a different product.

Proposal (option A in §8): **`--color-accent` takes the brand's hue in both themes**, blue goes away.

```css
/* dark */
--color-accent:        #D4952A;   /* = --color-brand */
--color-accent-2:      #E8AD45;   /* hover */
--color-on-accent:     #15100a;   /* NEW: ink on an accent fill */
--color-accent-glow:   rgba(212 149 42 / 0.28);
--color-accent-subtle: rgba(212 149 42 / 0.10);

/* light */
--color-accent:        #9A5F0A;   /* deep amber, ≥ 4.5:1 on #fff */
--color-accent-2:      #7D4C06;
--color-on-accent:     #ffffff;
```

Why `--color-on-accent` is new: `#D4952A` under white text is about 2.6:1, so an orange primary button must carry **dark** text in the dark theme (the "ink on amber" convention) and the light theme needs a deeper amber to keep white text. Every place that pairs `bg-[var(--color-accent)]` with `text-white` switches to `text-[var(--color-on-accent)]`: `.btn-primary`, `.toggle-thumb` stays white, `SegmentedControl.tsx:82`, `WorkspaceToggle.tsx:47`, `CustomRenderPanel.tsx:116`, `WordStylePopup.tsx:724`, `GroupPositionPopup.tsx:151`. The focus ring (`--focus-ring`) follows the accent automatically.

`--color-brand` stays as an alias of the dark accent for the logo and stays orange in light mode too (the wordmark is the one place the brand colour may sit on white without carrying text).

**Timeline collision.** `--color-amber` chips and the accent are now the same hue, so the *active* chip and the selected segment need a treatment other than "more orange": a 1.5 px `--color-text` outline plus a lighter fill (`--color-amber-2`). `hooks/useTimeline.ts` owns that drawing; `SafeZoneOverlay.tsx` keeps amber as is.

**Light theme palette.** Replace the Primer greys with a warm-neutral set so light stops looking like a different app: bg `#f7f5f1`, surface `#ffffff`, surface-2 `#f0ede7`, text `#1d1a16`, text-2 `#5f584f`, text-3 `#7d766c` (4.6:1 on white). Borders stay `rgba(0 0 0 / …)`.

### 1.2 Contrast

Measured today: `--color-text-3` is **2.5:1** on `--color-surface` (dark) and **3.0:1** on white (light). It carries every `.label-xs` section header (32 uses), card metadata, the reset icons, the wheel hints and the timeline ruler — 187 uses in all.

- Dark `--color-text-3`: `#56566a` → `#8a8aa0` (4.6:1 on `#17171c`). Light: `#8b949e` → `#6e6a63` (5.4:1 on white).
- Add `--color-text-4: #4a4a5c` (dark) / `#a9a49b` (light) for **decorative** uses only: dividers, disabled glyphs, the `↺` at rest. Grep the 187 uses and move the ones that are not text.
- Extend `tokens.test.ts` with a contrast check: parse the `@theme` and `:root.light` blocks, compute WCAG contrast for `text`, `text-2`, `text-3` against `bg`, `surface`, `surface-2`, and for `on-accent` against `accent`; assert ≥ 4.5. Pure arithmetic, no DOM, fits the `node` test environment.

### 1.3 The type scale

Counts under `components/`: `text-2xs` (10 px) 154, `text-[11px]` 95, `text-xs` (12 px) 187, `text-sm`+ 28. Nearly everything is 10–12 px, and the 95 arbitrary values escape the scale.

- Add `--text-xs-plus: 11px` to `@theme` (`text-2xs` stays 10 px; the final name is a §8 decision) and replace all 95 `text-[11px]` with it. Mechanical: one sed, plus an eslint `no-restricted-syntax` rule on the literal so it does not come back.
- `.label-xs` stays 10 px mono uppercase but gets the new `text-3` and `letter-spacing: 0.09em`; that is what makes 10 px legible.
- Body copy in the Text view (`SubtitleEditor.tsx` segment text), the Transcript view and the Publish textareas moves from `text-xs` (12 px) to the 13 px the `html` rule already declares as the body size. Tailwind has no 13 px step (`text-sm` is 14, `text-base` 16), so add `--text-body: 13px`. §8.
- Instrument Serif is reserved for **screen titles** (`All videos`, the wordmark, the empty-state line). `ContinueHero.tsx:53` renders the file slug in it; switch that line to the UI face at `text-lg font-medium`.

### 1.4 Verification

`npm run typecheck`, `npm test` (the two new token tests), `npm run lint`, then screenshots of the five screens in both themes for the PR description. The overlay preview (`useSubtitleOverlay`) is unaffected: caption colours are settings, not tokens.

## 2. Studio chrome

- **Sliders.** Six `type="range"` inputs (`StudioRow`, `ColorSwatch`, `LibraryViewControls`, `WordStylePopup`, `GroupPositionPopup`, `VolumeControl`) rely on `accent-color`, which draws the OS thumb and differs on Windows. Add one styled rule set in `globals.css` (`-webkit-appearance: none`, 3 px track in `--color-surface-3`, a 12 px thumb in `--color-accent` with a `--color-bg` ring, a filled portion via a `--fill` custom property the component sets to `(value-min)/(max-min)`). `StudioRow` sets `--fill` inline; the other five inherit the look without changes.
- **Reset `↺`.** `StudioRow.tsx:161` shows it at `opacity: 0.2` when clean. Make it `opacity: 0` at rest and `1` on row hover or when dirty (`group-hover`), and use `--color-text-4` when clean.
- **Section labels.** `StudioCard.tsx:51` uses `.label-xs`; nothing to change beyond PR 1's colour, but the collapse chevron should be `--color-text-3`, not `text-4`.
- **Wheel hints.** `AudioPlayer.tsx:359` and `:432` show "Ctrl+Wheel: zoom · Wheel: pan" permanently. Show them for 2.5 s after the pointer enters the surface for the first time in a session (a `useState` + `setTimeout` in `AudioPlayer`, remembered in a module-level flag), and keep them in the `?` shortcut overlay, which already lists zoom keys.
- **Font row.** The download icon beside the font combobox has no label; give it `aria-label="Install a font"` and a `title`.

## 3. Library

- **Toolbar naming.** "Import…" and "Add video" read as the same action. Keep both (Filip's 2026-09-16 decision) but say what differs: **Import…** → "Add to library…" and **Add video** → "Transcribe…" (`LibraryToolbar.tsx:51`, `ImportButton.tsx:19`, the empty state, the `?` overlay and the tours in `lib/tourSteps.ts`). The `⌘O` shortcut description in `lib/shortcuts.ts` follows.
- **Icon-size slider.** `LibraryViewControls.tsx:107` is an unlabelled bar; give it a small/large glyph at each end and hide it below 900 px window width.
- **Continue hero.** `ContinueHero.tsx` is a 177 px box with content in the left third. Fill the right two thirds with what the next step is, derived from `statusPips`: "Captions done · write the description" / "Transcribed · style the captions", plus "Edited Sep 17". Pure copy in `lib/libraryView.ts` (`nextStepLabel(status)`), one markup test.
- **Status word.** The pips `●○○○` have only an `aria-label`. Add the status word beside them in the grid footer (`LibraryCard.tsx`), using the same `statusLabel` the list's Status column already renders, so the two views agree.
- **Root label.** The sidebar shows "Library 0" under "All videos 8": the row is *unfiled* videos. Rename the row to **Unfiled** in `LibrarySidebar.tsx:89`, keep the path-bar crumb as "Library" (it is the location, not the count), and update the two markup tests.

## 4. Editor

- **Merge on hover.** `GroupEditor.tsx:426-444` prints "merge" between every pair of rows (27 on a 38 s clip). Render the button only while the gap or either neighbouring row is hovered (`group/gap` + `group-hover/gap:opacity-100`), keep it in the tab order and the `M` shortcut, and make its label an icon plus tooltip.
- **Timeline chips.** `useTimeline.ts:325` draws every word's text at every zoom, which yields "Pr", "a re" at 100 %. Measure once per frame: draw a word's text only when `ctx.measureText(word).width + 6 <= chipWidth`, otherwise draw the chip alone, and draw the **group** text on the segment lane (`:292`) where there is room. Pure threshold logic lives in `lib/timelineMath.ts` (`fitsChip(width, textWidth)`) with a unit test.
- **Captions | Publish toggle.** `App.tsx:507` mounts `WorkspaceToggle` over the preview's top-right corner although it switches the aside. Move it into the aside's header row (beside "CUSTOM SETTINGS" / "PUBLISH"), which both `StudioPanel` and `PublishPanel` render, so the control sits on the thing it changes. The `data-tour` id stays on it.
- **Title bar.** "Saved 10:32 AM" and a **Save** button coexist. `handleSave` (`App.tsx:289`) is *export a `.capforge` file*, not save. Rename it **Export project…** and move it under the Export button's menu; keep `⌘S` bound to it. **New** leaves the session with the weight of a peer button: demote it to the same menu ("New session") and drop it from the bar. The `TitleBar.test.tsx` expectations change accordingly.

## 5. Publish

- **Header dedupe.** Every card stacks a `StudioCard` title and a `FieldHeader` label with the same word (TITLE / TITLE). Give `FieldHeader` a `hideLabel` prop and pass it from the single-field cards (`TitleCard`, `DescriptionCard`, `TagsCard`), keeping the meter and the provenance chip on the row. The multi-field cards (Tags & hashtags, Localized) keep both.
- **Provenance only when written.** `ProvenanceChip` renders "● not written" on every empty field. Render nothing for that state; the placeholder already says the field is empty. Snapshot tests in `PublishPanel.test.tsx` update.
- **The bottom cards.** "This video · Folder" is cut off under the footer at 890 px height; move Publish state and Folder above Localized and Cover, which are the two least used.

## 6. Consistency

- **One confirm.** `window.confirm` is used in `FontPicker.tsx:78`, `PresetPicker.tsx:113,157`, `SkillsPanel.tsx:101,124` and `hooks/useTrackActions.ts:161`, while the library confirms inline. Add `components/ui/ConfirmDialog.tsx` over `ModalShell` (title, body, confirm label, danger flag) and a `useConfirm()` hook returning a promise, then replace the six calls. The hook needs a provider in `App.tsx`; the component tests render the dialog's markup for the open state.
- **Hard-coded colours.** 20 lines in 14 files. The `bg-black/40` scrims (ModalShell, SettingsDialog, ShortcutOverlay, PublishToSheet, RenderProgressModal, TourScrim) become one `--color-scrim` token (`rgba(0 0 0 / 0.4)` dark, `rgba(31 35 40 / 0.3)` light). `bg-white/[0.04]` hovers in `SubtitleEditor`, `WordStylePopup`, `StudioCard` become `--color-hover` (`rgba(255 255 255 / 0.05)` dark, `rgba(0 0 0 / 0.04)` light), which also lets the four `:root.light .x:hover` overrides in `globals.css` go. `text-white` on accent fills is PR 1's `--color-on-accent`. `ProgressScreen.tsx:138,141` dots become `--color-text`.
- **Appearance.** `GeneralSettings.tsx:54` is a "Light Mode" toggle. Make it a `SegmentedControl` Light / Dark / System, with `useTheme.ts` reading `matchMedia('(prefers-color-scheme: light)')` for System and re-applying on change. The stored `app-state` value gains `'system'`; an old boolean reads as before.

## 7. Out of scope

The progress screen, the onboarding tours' visuals, narrow-window layouts and Windows chrome were not reviewed. The caption renderers are untouched throughout: nothing here reaches `useSubtitleOverlay`, Pillow or the HTML layer.

## 8. Decisions for Filip

1. **Accent.** A: brand orange becomes the accent, blue goes (this plan). B: blue stays, orange retreats to the logo and the export footer. A is recommended; it is the only choice that also fixes the light theme.
2. **Light palette.** Warm neutrals (§1.1) or keep the cool greys and only fix contrast.
3. **Token names.** `text-xs-plus` for 11 px and `text-body` for 13 px, or fold 11 px into 12 px and accept the density change.
4. **Toolbar words.** "Add to library…" / "Transcribe…", or another pair.
5. **Title bar.** Fold Save and New into the Export menu (§4), or keep them and only rename Save to "Export project".
6. **Sidebar root.** "Unfiled" for the count row, or keep "Library" and drop the count.
