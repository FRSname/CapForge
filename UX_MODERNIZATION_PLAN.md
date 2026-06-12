# CapForge UX/UI Modernization Plan

Phased plan for modernizing the renderer UI. Each phase is self-contained and executable
in a fresh session — it cites the exact files, line ranges, and existing patterns to copy.

**Hard constraint for every phase:** Do NOT touch the subtitle rendering pipeline
(`hooks/useSubtitleOverlay.ts`, `backend/exporters/video_render.py`, `lib/renderConstants.ts`,
`lib/render.ts` formulas). This plan is app-chrome UX only. Golden-frame tests
(`backend/tests/test_render_golden.py`) must pass unmodified after every phase.

---

## Phase 0: Documentation Discovery (DONE — consolidated findings)

### Current-state facts (verified 2026-06-12, line numbers cited from discovery agents)

**Design tokens** — `src/renderer/src/styles/globals.css`
- `@theme` block lines 7–63: full dark palette (`--color-bg #0b0b0e` → `--color-text #e8e8f0`),
  accent `#5b7ef7` (electric blue), amber `--color-amber #c9891f` / `--color-amber-2 #e8a834`,
  status colors, radii xs–xl, motion (`--ease-out-expo`, `--ease-spring`, `--duration-fast/normal/slow`),
  fonts (`--cf-font-ui` Inter, `--cf-font-display` Instrument Serif italic, `--cf-font-mono` JetBrains Mono).
- `:root.light` overrides lines 69–97. Theme toggled via localStorage in `SettingsPanel.tsx:70`;
  no `prefers-color-scheme` detection.
- Button/control classes lines 147–291: `.icon-btn`, `.btn-primary`, `.btn-danger`, `.btn-ghost`,
  `.titlebar-btn`, `.tl-btn`, `.field-input`, global `input[type="range"]` accent.
- Only one keyframe animation exists: `toast-in` (lines 323–330).

**Tailwind v4** — CSS-first via `@tailwindcss/vite` in `electron.vite.config.ts:29`;
no tailwind.config.js. Components use `bg-[var(--color-…)]` arbitrary values (~160 instances) — works fine;
the known misparse is specifically `text-[var(--color-text)]` (color vs font-size ambiguity).

**Fonts** — loaded from **Google Fonts CDN** in `src/renderer/index.html:7–9`
(Inter 400–800, Instrument Serif italic, JetBrains Mono 400/500/700). Offline desktop app ⇒ fonts
silently fall back to system stack with no network. Instrument Serif is used in exactly one place
(`DropZoneScreen.tsx:71`).

**Layout** — `App.tsx:196–276`: TitleBar (38px, custom React component over a **native** Electron
frame — `electron/main.js:40–77` has no `frame`/`titleBarStyle` options, `backgroundColor: "#0d1117"`),
recovery banner, `<main>` = screen (flex-1) + `StudioPanel` sidebar `w-[380px]` (`StudioPanel.tsx:218`).
Screen machine `file | progress | results` in `types/app.ts:2`.

**StudioPanel** — `components/studio/StudioPanel.tsx` (762 lines). 48 settings fields in 5 collapsible
`StudioCard`s + ExportPanel + CustomRenderPanel, one long scroll. `StudioRow.tsx:36–85` is the
slider+editable-number+reset pattern. Inline non-reusable button groups: safe zones
(StudioPanel.tsx:403–417), text alignment (486–520). Native `<select>`s for animation/word style.

**Shared primitives** — `components/ui/` has only ColorSwatch (93 ln), FontPicker (159 ln), Toggle (24 ln).
No Button/IconButton/Select/SegmentedControl components — those are CSS classes + duplicated JSX.

**Hardcoded colors bypassing tokens** (~22 instances):
- `ProgressScreen.tsx:87,91,136` — brand amber `#D4952A` / `rgba(212,149,42,0.3)` hardcoded
- `TitleBar.tsx:27,34` — gradient white + `#D4952A`
- `DropZoneScreen.tsx:45–46` — accent-blue rgba baked into gradients
- `AudioPlayer.tsx:346,355` — `bg-[#0d1117]`, `text-white/20`
- `ExportPanel.tsx:220–261` — 8 SVG fill/stroke amber hex values
- `StudioPanel.tsx:108–146` — color-picker defaults (these are SUBTITLE defaults, **keep as hex** — they're render data, not UI chrome)

**Feedback systems** — `hooks/useToast.tsx` (137 ln, bottom-right stack, 4500ms, action support).
`RenderProgressModal.tsx` (role="dialog", aria-modal). `SettingsPanel.tsx:122–128` slide-in overlay.
Recovery banner `App.tsx:214–226`. z-index is ad-hoc (`z-40`, `z-50`, `z-[9999]`).

**Accessibility gaps (verified zero matches)**: `focus-visible` (0), `aria-live` (0),
`prefers-reduced-motion` (0). PresetPicker has no Escape-to-close (outside-click only).
Good existing patterns to copy: `DropZoneScreen.tsx:39–51` (role/tabIndex/aria-label/Enter),
`ui/Toggle.tsx` (role="switch"/aria-checked), `RenderProgressModal.tsx:21–22` (dialog/aria-modal).

**Dependencies** — lottie-web, wavesurfer 7.12.5. No icon lib, no motion lib, no component lib.
**Decision: stay dependency-light.** No Radix/Framer Motion/shadcn. Icons stay inline SVG but get
componentized. This is a small desktop app; CSS + the existing token system is enough.

### Allowed APIs / patterns (cite-and-copy list)
- Token usage pattern: `bg-[var(--color-surface)]` etc. — copy from `RenderProgressModal.tsx` (the cleanest component)
- Inline style for text color when Tailwind misparses: `style={{ color: 'var(--color-text)' }}` (CLAUDE.md)
- Transition pattern: `SettingsPanel.tsx:123–124` (`var(--ease-out-expo)` + `--duration-normal`)
- Keyframes pattern: `globals.css:323–330` (`toast-in`)
- A11y patterns: files cited above
- Canvas wheel/native-listener rule: CLAUDE.md "Canvas wheel events"

### Anti-patterns (global, all phases)
- ❌ `text-[var(--color-text)]` — Tailwind v4 misparse; use inline style
- ❌ New runtime deps (Radix, framer-motion, lucide) — not approved
- ❌ Animating `width/height/top/left/margin/padding` — compositor-friendly only (`transform`, `opacity`)
- ❌ Touching `useSubtitleOverlay.ts`, `video_render.py`, `renderConstants.ts` formulas
- ❌ Changing `StudioSettings` subtitle-default hex values (they're product defaults, not theme)
- ❌ `frame: false` on Windows without full window-controls implementation (Phase 6 is macOS-scoped)

---

## Phase 1: Token completion + hardcoded-color cleanup + a11y foundations

**Goal:** every UI-chrome color flows through a token; brand color gets a name; baseline a11y CSS lands.

### Tasks
1. In `globals.css` `@theme` (after line 31), add:
   - `--color-brand: #D4952A;` and `--color-brand-glow: rgba(212 149 42 / 0.3);`
     (brand orange — distinct from `--color-amber` which is the timeline-block color)
   - `--focus-ring: 0 0 0 2px var(--color-bg), 0 0 0 4px var(--color-accent);`
   - Light-theme counterparts in `:root.light` (lines 69–97): keep brand orange identical (it's brand, not surface).
2. Add global focus + reduced-motion CSS to `globals.css` (copy structure of existing base styles ~line 117):
   ```css
   :focus-visible { outline: none; box-shadow: var(--focus-ring); border-radius: var(--radius-sm); }
   @media (prefers-reduced-motion: reduce) {
     *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
   }
   ```
3. Replace hardcoded colors with tokens at the exact sites from Phase 0:
   - `ProgressScreen.tsx:87,91,136` → `var(--color-brand)` / `var(--color-brand-glow)`
   - `TitleBar.tsx:34` → `var(--color-brand)`; line 27 gradient → keep but build from `var(--color-border)`-style rgba? No — gradients may keep rgba **white-overlay** values only if they read correctly in light mode; verify both themes, otherwise swap to a new `--gradient-titlebar` token.
   - `DropZoneScreen.tsx:45–46` → use `var(--color-accent-subtle)` / `color-mix(in srgb, var(--color-accent) 8%, transparent)`
   - `AudioPlayer.tsx:346` → `var(--color-bg)`; `:355` → `style={{ color: 'var(--color-text-3)' }}`
   - `ExportPanel.tsx:220–261` SVGs → `fill="var(--color-brand)"` / `currentColor` where the icon should follow text color
   - `electron/main.js` `backgroundColor: "#0d1117"` → `"#0b0b0e"` to match `--color-bg`
4. Theme bootstrapping: in `SettingsPanel.tsx` theme logic (~line 70), default to
   `window.matchMedia('(prefers-color-scheme: light)')` when no localStorage value exists.

### Verification
- [ ] `grep -rn 'D4952A\|0d1117\|rgba(212' src/renderer/src --include='*.tsx'` → only `StudioPanel.tsx` defaults + `lib/presets.ts` remain
- [ ] `grep -rn 'text-white\|bg-black' src/renderer/src --include='*.tsx'` → 0 UI-chrome hits
- [ ] `grep -c 'focus-visible' src/renderer/src/styles/globals.css` ≥ 1; same for `prefers-reduced-motion`
- [ ] `npm run typecheck` clean; `npx vitest run` green
- [ ] Visual QA (`npm run dev:react`): both themes, all 3 screens, ProgressScreen brand color intact

### Anti-pattern guards
- Do not rename existing tokens (160+ usages); only add.
- Do not "fix" subtitle default hexes in StudioPanel/presets — they are data.

---

## Phase 2: Extract shared UI primitives

**Goal:** kill JSX duplication; one place to restyle controls later.

### Tasks (copy existing markup into components — do not redesign yet)
1. `components/ui/Button.tsx` — wraps existing `.btn-primary`/`.btn-ghost`/`.btn-danger` classes
   (`globals.css:147–254`) with `variant`, `size`, `disabled`, `loading` props.
2. `components/ui/IconButton.tsx` — from `.icon-btn` (28×28) + mandatory `aria-label` prop.
3. `components/ui/SegmentedControl.tsx` — generalize the safe-zone group (`StudioPanel.tsx:403–417`)
   and alignment groups (`StudioPanel.tsx:486–520`). Props: `options: {value,label,icon?}[]`,
   `value`, `onChange`. Add `role="radiogroup"` / `role="radio"` + arrow-key navigation
   (copy keyboard pattern from `GroupEditor.tsx:152–200`).
4. `components/ui/Select.tsx` — thin wrapper over native `<select className="field-input">`
   (keep native dropdown; custom popover not justified).
5. Migrate call sites: TitleBar, StudioPanel, ExportPanel, CustomRenderPanel, SettingsPanel,
   DropZoneScreen, ResultsScreen tabs.
6. Move `StudioRow` into `components/ui/` unchanged (it is already a good primitive).

### Verification
- [ ] `grep -rn 'className=.*btn-primary' src/renderer/src/components --include='*.tsx' | grep -v 'ui/'` → 0 (all via `<Button>`)
- [ ] Safe-zone + alignment groups render via `SegmentedControl`; arrow keys move selection
- [ ] `npm run typecheck` + `npx vitest run` green; add a vitest render test per primitive (AAA pattern)
- [ ] Visual diff: screens look pixel-identical to pre-phase (this phase is refactor-only)

### Anti-pattern guards
- No visual redesign in this phase — extraction must be behavior- and pixel-preserving.
- No prop-drilling explosions: primitives take plain props, no context.

---## Phase 3: Self-host fonts + typography & brand expression

**Goal:** offline-correct fonts; give the app the brand personality it already declared but barely uses.

### Tasks
1. Self-host the three Google fonts: download woff2 (Inter 400/500/600/700, Instrument Serif italic,
   JetBrains Mono 400/500/700) into `src/renderer/src/assets/fonts/`, add `@font-face` with
   `font-display: swap` to `globals.css`, delete the CDN `<link>`s from `src/renderer/index.html:7–9`.
   (Drop Inter 800 — discovery found no usage above 700.)
2. Use `--cf-font-display` (Instrument Serif italic) deliberately: DropZone headline (already does),
   ProgressScreen status headline, ResultsScreen empty states, "CapForge" wordmark in TitleBar
   (`TitleBar.tsx` logo block) paired with brand orange.
3. Tighten the type scale: define `--text-xs/sm/base/lg` tokens in `@theme` and replace the
   scattered `text-[11px]`/`text-[12px]`/`text-[13px]` arbitrary sizes (grep first, migrate mechanically).

### Verification
- [ ] Dev tools offline mode: fonts still render (no CDN request in Network tab)
- [ ] `grep -n 'fonts.googleapis' src/renderer/index.html` → 0
- [ ] Bundle check: `npm run build:react` succeeds; woff2 files copied to `out/renderer/`
- [ ] Both themes visually checked on all 3 screens

### Anti-pattern guards
- Do NOT touch the subtitle font pipeline (`lib/fonts.ts`, FontPicker, backend font loading) — UI fonts only.
- Max 2 effective families per surface; display serif is for headlines/brand moments only, never controls.

---

## Phase 4: Motion & micro-interaction system

**Goal:** the app currently has one keyframe (toast-in). Add a small, consistent motion layer.

### Tasks (all CSS, all `transform`/`opacity` only, all respecting Phase 1 reduced-motion rule)
1. Screen transitions: fade+4px-rise on screen mount (`App.tsx:228–256`) — single
   `@keyframes screen-in` in globals.css, ~180ms `var(--ease-out-expo)`.
2. StudioCard collapse: animate body with `grid-template-rows: 0fr→1fr` wrapper technique
   (replaces `display:none` toggle in `StudioCard.tsx:36`; grid-rows trick keeps it compositor-cheap
   and height-agnostic). Rotate the chevron with existing `--duration-fast`.
3. Designed hover/active/focus states on the Phase 2 primitives: subtle `translateY(-1px)` +
   shadow on Button hover, `scale(0.97)` on active, `--focus-ring` on focus-visible.
4. PresetPicker + WordStylePopup: scale/fade in (`transform-origin` at anchor), 120ms.
5. Toast: add exit animation (slide+fade out) — currently pops out abruptly (`useToast.tsx`).
6. ProgressScreen: keep Lottie; add `aria-live="polite"` to the status text while here.

### Verification
- [ ] Toggle macOS "Reduce motion" → all the above collapse to instant (Phase 1 media query catches them)
- [ ] No layout-property animation: `grep -n 'transition.*width\|transition.*height\|transition.*top\|transition.*left' src/renderer/src` → only pre-existing hits, no new ones
- [ ] Typecheck + vitest green; manual QA of card expand with very tall card (Animation card)

### Anti-pattern guards
- No JS animation libraries. No `will-change` left permanently on elements.
- Don't animate the canvas elements (timeline/overlay) — they repaint imperatively.

---

## Phase 5: StudioPanel UX overhaul

**Goal:** 48 settings in one scroll is the app's biggest friction point. Make it navigable and stateful.

### Tasks
1. **Settings search**: filter input pinned at top of the sidebar scroll area
   (`StudioPanel.tsx` body, after the Presets header ~line 218). Maintain a static
   `{label, cardId, keywords}` registry per StudioRow; matching rows force-open their card and
   non-matching cards collapse. Copy the search-input pattern from `SubtitleEditor.tsx` toolbar (lines 155–215).
2. **Dirty indicators per card**: StudioCard header shows a small brand-orange dot + "n changed"
   when any child setting ≠ default (the dirty logic already exists per-row in `StudioRow.tsx:50`;
   lift the predicate, don't duplicate it). Add per-card "reset section" button.
3. **PresetPicker upgrades**: Escape-to-close (copy outside-click + Escape pattern from
   `WordStylePopup.tsx:124–137`); render a live mini-preview chip using the preset's actual
   text/bg/active colors (extend the existing 3-color chip, `PresetPicker.tsx:219–235`).
4. **Sticky export actions**: ExportPanel's two primary render buttons move to a pinned footer
   below the scroll area so "Render" is always reachable; advanced/custom render stays in the scroll.
5. **z-index scale**: add `--z-dropdown: 30; --z-panel: 40; --z-modal: 50; --z-toast: 60;` tokens,
   replace ad-hoc `z-50`/`z-[9999]` across PresetPicker, SettingsPanel, RenderProgressModal, useToast.

### Verification
- [ ] Typing "shadow" in search opens Animation/Background cards and shows only shadow rows
- [ ] Changing fontSize shows dot on Typography card; section reset returns it to `STUDIO_DEFAULTS`
- [ ] Escape closes PresetPicker and WordStylePopup; `grep -rn 'z-\[9999\]' src` → 0
- [ ] Undo (Cmd+Z) still works for section reset (it must route through the existing `update()` →
      `useSettingsUndo` path in App.tsx — single set call)
- [ ] Typecheck + vitest green; add tests for the search-filter predicate (pure function in `lib/`)

### Anti-pattern guards
- Section reset must use the existing settings-update path (one `setSettings` call), or undo breaks.
- Don't restructure `StudioSettings` (flat interface is a project convention; render.ts depends on it).

---

## Phase 6: Accessibility & feedback completion

**Goal:** close the remaining a11y gaps found in Phase 0.

### Tasks
1. `aria-live="polite"` region for toasts (`useToast.tsx:59` stack container) and render progress
   (`RenderProgressModal.tsx` percentage text).
2. Keyboard-shortcut overlay: `?` (Shift+/) toggles a modal listing the shortcuts that already exist
   (source of truth: SettingsPanel.tsx:218–240 reference + ResultsScreen.tsx:184–219 handlers).
   Reuse RenderProgressModal's dialog markup (`role="dialog"`, `aria-modal`, Escape-to-close).
3. Focus trapping in modals (RenderProgressModal, shortcut overlay, SettingsPanel): minimal
   hand-rolled trap (Tab cycling within container) — no dependency.
4. Tab keyboard access for Text/Groups view tabs (`ResultsScreen.tsx:340–352`):
   `role="tablist"`/`role="tab"` + arrow keys; add a keyboard shortcut (e.g. Cmd+1/Cmd+2) and
   register it in the shortcut overlay.
5. Timeline/editor affordances: visible focus ring on word chips (they're clickable but currently
   focus-invisible) — `SubtitleEditor.tsx:388–410` chips get `tabIndex`-on-active-segment + focus-visible style.

### Verification
- [ ] VoiceOver announces toast messages and render progress milestones
- [ ] Full keyboard pass: file → transcribe → edit → render without touching the mouse (document any dead ends)
- [ ] `grep -c 'aria-live' src/renderer/src` ≥ 2
- [ ] Typecheck + vitest green

### Anti-pattern guards
- Don't add global `tabIndex` to hundreds of word chips (perf/tab-order noise) — only the active segment's.
- Shortcut overlay must read from one shared constant, not a third hand-maintained list.

---

## Phase 7 (optional, macOS-first): Window chrome

**Goal:** native-feeling frameless chrome on macOS; Windows keeps native frame.

### Tasks
1. `electron/main.js` BrowserWindow opts (lines 40–77): on darwin only,
   `titleBarStyle: 'hiddenInset'`, `trafficLightPosition: { x: 12, y: 11 }` (centers in 38px bar).
2. `TitleBar.tsx`: left-pad the logo block ~76px on mac for traffic lights;
   `-webkit-app-region: drag` on the bar, `no-drag` on every button (verify existing drag region first —
   discovery noted the bar is already an app-drag region; confirm in `TitleBar.tsx:23–115`).
3. Keep Windows/Linux on native frame (no `frame:false` branch).

### Verification
- [ ] `npm start` on mac: traffic lights overlay the custom bar, all TitleBar buttons clickable,
      double-click bar zooms window
- [ ] Window dragging works; DevTools toggle/menu still accessible
- [ ] `npm run dist:mac` packaged smoke test

### Anti-pattern guards
- Do not ship `frame: false` cross-platform; Windows needs min/max/close buttons we are not building.

---

## Final Phase: Verification sweep

1. `npm run typecheck` — clean
2. `npx vitest run` — all green (including new primitive + search-filter tests)
3. `.venv-dev/bin/python -m pytest backend/tests` — green, **goldens untouched**
   (`git diff --stat backend/tests/golden/` must be empty)
4. Anti-pattern greps:
   - `grep -rn 'text-\[var(--color-text)\]' src` → 0
   - `grep -rn 'D4952A' src/renderer/src/components --include='*.tsx'` → 0 (token'd)
   - `grep -rn "from 'framer-motion'\|from '@radix" src` → 0
   - `git diff --stat src/renderer/src/hooks/useSubtitleOverlay.ts backend/exporters/video_render.py src/renderer/src/lib/renderConstants.ts` → empty
5. `npm run build:react` — succeeds; sanity-check bundle size didn't grow >10% (fonts move it; note delta)
6. Visual QA both themes × 3 screens at 760×560 (min window) and 1500×1400 (default)
7. Reduced-motion OS toggle pass
8. Update `CHANGELOG.md` Unreleased section
