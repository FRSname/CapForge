# Interactive startup tour (coach marks)

Supersedes the card-only guide of [startup-guide-and-whats-new.md](startup-guide-and-whats-new.md) §3 `StartupGuideDialog`. Filip (2026-09-16): "make the startup guide more interactive so it goes through the app, through the correct pages, for that list of the guide." Everything else in that plan (What's new, the release-notes pin, the About block, the bridges, the tutorial player) stays.

## Decisions

- **Two tours, because a fresh install has no video.** The editor, export and publish screens only exist once a video is transcribed, so the guide cannot walk them at first launch. Instead:
  - **`getting-around`** runs on the library screen at first launch: the library controls, then Settings → Transcription, Channels and Claude & Skills, opened for real.
  - **`first-video`** starts by itself the first time the results screen is shown (after the first transcription, or the first record opened) and walks the editor, the player, tracks, the style sidebar, export and the Publish workspace, switching the workspace for real.
- **Real coach marks, hand-rolled.** A spotlight cut out of a scrim around the live element plus a popover beside it, no new dependency (the app hand-rolls every dialog and menu; `react-joyride` and friends bring their own styling and React-version friction). The element is found by a `data-tour="<id>"` attribute.
- **A missing target never breaks a step.** A step whose element is not on screen either shows centred (no spotlight) or, when marked `optional`, is skipped: on an empty library there is no toolbar, so the view-controls step is skipped and the add-video step points at the empty state's buttons instead.
- **The tour ends quietly when the user leaves the screen it belongs to** (the getting-around tour on leaving the library, the first-video tour on leaving results). The scrim is four rectangles around the spotlight, so the highlighted element itself stays clickable.
- **Both tours are reopenable** from Settings → General → About ("Startup guide", "Editor guide"; the second needs a video open and says so otherwise).
- **The tutorial video** stays in the welcome step's popover (the existing `TutorialPlayer`, click-to-load).

## 1. Pure logic (`src/renderer/src/lib/`)

### `tourSteps.ts`

```ts
export type TourId = 'getting-around' | 'first-video'
export type TourAction =
  | { kind: 'open-settings'; category: AppSettingsCategoryId }
  | { kind: 'close-settings' }
  | { kind: 'set-workspace'; workspace: 'captions' | 'publish' }
export type Placement = 'top' | 'bottom' | 'left' | 'right'
export interface TourStep {
  id: string
  title: string
  paragraphs: string[]
  /** The `data-tour` id to spotlight; none = a centred card. */
  target?: string
  /** Where the popover prefers to sit; the placer flips it when there is no room. */
  placement?: Placement
  /** Run before the step is measured (open Settings on a pane, switch the workspace…). */
  before?: TourAction[]
  /** Skipped, not centred, when the target is absent. */
  optional?: boolean
  /** The welcome step carries the tutorial player. */
  tutorial?: boolean
}
export interface Tour { id: TourId; title: string; screen: 'library' | 'results'; steps: readonly TourStep[] }
export const TOURS: Record<TourId, Tour>
export const TOUR_SEEN_KEY = 'toursSeen'   // app-state: string[] of TourId
```

Copy in the CHANGELOG's plain voice, two short paragraphs per step, every claim true today. Reuse the sentences of `startupGuide.ts` where they fit, then delete `GUIDE_STEPS` and `GuideAction` (keep `TUTORIAL_VIDEO_ID`, `TUTORIAL_URL`, `TUTORIAL_EMBED_URL` in `startupGuide.ts`, or move them to `tutorial.ts` and update imports).

**`getting-around`** (screen `library`):

| id | target (`data-tour`) | placement | before | notes |
|---|---|---|---|---|
| `welcome` | – | – | – | centred, `tutorial: true`: what CapForge does, everything stays on this machine |
| `add-video` | `library-add-video` | bottom | – | Add video, Import…, dropping files or folders; on an empty library the same id sits on the empty state's button row |
| `sidebar` | `library-sidebar` | right | – | Library, All videos, folders (an event or a series), + New folder |
| `view` | `library-view-controls` | bottom | – | `optional`: search by name or file name, sort, grid/list |
| `transcription` | `settings-transcription-model` | bottom | open-settings `transcription` | the model choice, size vs accuracy, fetched on first use; speakers; another language later as a track |
| `channels` | `settings-channels` | left | open-settings `channels` | where the publish text is written for; the primary YouTube channel; `/capforge-init` fills it in by interview |
| `claude` | `settings-claude-connect` | bottom | open-settings `claude` | connect Desktop or Code; the two bundled skills; live editing |
| `finish` | – | – | close-settings | centred: add your first video; the guide continues in the editor once it is transcribed; Settings → General → About reopens it |

**`first-video`** (screen `results`):

| id | target | placement | before | notes |
|---|---|---|---|---|
| `views` | `editor-view-tabs` | bottom | set-workspace `captions` | Text, Groups, Transcript |
| `words` | `editor-body` | right | – | right-click a word to correct or style it; untouched words never move; right-click a caption row to place it |
| `player` | `player` | left | – | the preview is the render; the timeline drags caption edges |
| `tracks` | `track-tabs` | bottom | – | `optional`: another language as a tab, same timing and style |
| `style` | `studio-panel` | left | – | the style cards and presets |
| `export` | `export-footer` | left | – | MP4 baked in, overlay MOV/WebM, .srt/.vtt/.ass, HyperFrames |
| `publish` | `publish-panel` | left | set-workspace `publish` | title, description, chapters, tags per channel; folders carry an event's footer; copied, never uploaded |
| `finish` | – | – | set-workspace `captions` | centred: that is the loop; About reopens both guides |

Test `tourSteps.test.ts`: ids unique per tour; every `target` id appears as `data-tour="<id>"` in at least one file under `src/renderer/src/components/**/*.tsx` (read the tree with `fs`; this is the pin that keeps the attributes from being refactored away); every `before` category exists in `APP_SETTINGS_CATEGORIES`; paragraphs non-empty and ≤ 320 chars; exactly one `tutorial` step and it has no target.

### `tourPlacement.ts`

```ts
export interface Rect { top: number; left: number; width: number; height: number }
export const SPOTLIGHT_PADDING = 6, POPOVER_GAP = 12, VIEWPORT_MARGIN = 16
export function spotlightRect(target: Rect): Rect                       // padded
export function placePopover(target: Rect, popover: { width: number; height: number },
                             viewport: { width: number; height: number },
                             preferred: Placement): { top: number; left: number; placement: Placement }
```

`placePopover`: try `preferred`, then its opposite, then the other two; a side fits when the popover plus gap fits between the target and the viewport edge; align the popover's centre to the target's centre along the other axis and clamp inside the viewport margins. Tests: each side, a flip, the clamp, a target wider than the viewport.

### `tourEngine.ts`

A pure reducer over `{ tour: Tour; index: number }` with `nextIndex(tour, index, present: (target?: string) => boolean)` / `previousIndex(...)` that skip `optional` steps whose target is absent, and `stepSeen(seen: string[], id: TourId): string[]` (append without duplicates). Tests.

### `settingsNavigation.ts` — add a close request

`requestSettingsClose(): boolean` and `onSettingsCloseRequested(listener)` next to the category pair, same listener-set shape; `SettingsDialog` subscribes and calls its `onClose`. Test.

### `tourNavigation.ts`

The registry the tour drives the app through (the `settingsNavigation.ts` pattern, one registered navigator at a time):

```ts
export interface TourNavigator { setWorkspace(workspace: 'captions' | 'publish'): void }
export function registerTourNavigator(nav: TourNavigator): () => void
export function runTourAction(action: TourAction): void   // open/close settings via settingsNavigation, workspace via the navigator; a missing navigator is a console.warn, never a throw
```

App registers it through a one-line hook `useTourNavigator({ setWorkspace: publishWorkspace.setWorkspace })`.

### `startupPrompts.ts`

Unchanged decision (`guide` on a fresh install), but `guide` now means "start the `getting-around` tour". `HISTORY_KEYS` unchanged.

## 2. Renderer

### `data-tour` attributes (additive, one attribute each)

- `LibraryToolbar.tsx`: wrap the Import + Add video pair in `<span data-tour="library-add-video" className="flex items-center gap-2">`; `LibraryEmptyState.tsx`: the same id on its button row.
- `LibrarySidebar.tsx`: the `<nav aria-label="Library locations">`.
- `LibraryViewControls.tsx`: its root.
- `TranscriptionSettings.tsx`: the model picker's row (the element holding the `<select>` and its help text).
- `ChannelsSettings.tsx`: the list + editor root. `ClaudeSettings.tsx`: the Connect Desktop / Connect Code button row.
- `ResultsScreen.tsx` (or `EditorViewTab`'s strip container): `editor-view-tabs`; `SubtitleEditor.tsx` root: `editor-body` (put it on the element that scrolls the words); `AudioPlayer.tsx` root: `player`; `TrackTabs.tsx` root: `track-tabs`; `StudioPanel.tsx` root: `studio-panel`; `ExportFooter.tsx` root: `export-footer`; `PublishPanel.tsx` root: `publish-panel`.

### `hooks/useTourTarget.ts`

`useTourTarget(target: string | undefined, active: boolean): Rect | null | 'missing'` — polls `document.querySelector('[data-tour="…"]')` every 100 ms for up to `TARGET_WAIT_MS` (1500) after a step starts (Settings needs a frame to mount its pane), then `scrollIntoView({ block: 'nearest' })` once, and tracks the rect with a `ResizeObserver` on the element, `resize` and capture-phase `scroll` listeners on `window`, and a 250 ms interval fallback (the results layout animates). Returns `'missing'` after the wait.

### `hooks/useTour.ts`

```ts
export function useTour(context: { screen: Screen }): {
  active: { tour: Tour; index: number } | null
  start(id: TourId): void; next(): void; back(): void; end(): void
}
```

- `start`: sets the tour at index 0 after running the first step's `before`. `next`/`back`: run the new step's `before` (through `runTourAction`), then move; skipping honours `optional` via `nextIndex` with a `present` that checks the DOM. `end`: runs `close-settings` if Settings was opened by the tour, writes the tour id into `toursSeen` (app-state, read once on mount, guarded like `lastSeenVersion`), clears.
- Ends quietly when `context.screen` stops matching `tour.screen`.
- ←/→ step, Esc ends (a `keydown` listener while active, ignored from inputs).

### `components/tour/TourOverlay.tsx` (+ `TourPopover.tsx`, `TourScrim.tsx`)

- Root: `fixed inset-0 z-[var(--z-modal)]` with `pointer-events: none`; mounted after `SettingsDialog` so it paints above it.
- `TourScrim`: four absolutely positioned `div`s (above, below, left, right of `spotlightRect`) with `bg-black/40 backdrop-blur-sm pointer-events-auto` and a rounded ring drawn as a `div` with `border: 2px solid var(--color-brand)` and `border-radius: 8px` over the spotlight, `pointer-events: none`. Centred mode (no rect): one full scrim.
- `TourPopover`: `pointer-events-auto`, `w-[340px]`, the ModalShell card styling (`bg-[var(--color-surface)]`, border, shadow, `pop-in`), positioned at `placePopover(...)` from a measured own size (`useLayoutEffect` + `getBoundingClientRect`, re-placed when the target rect or the size changes). Content: `tour.title` small caps at the top, the step title in `--cf-font-display`, paragraphs, the `TutorialPlayer` on the `tutorial` step, then a footer: "Skip tour" text link, the dot rail, Back, Next / "Done". Focus the Next button on each step change; no focus trap (Settings has its own and they would fight).
- Colours through CSS variables only.

### `components/onboarding/StartupPrompts.tsx`

Owns `useTour({ screen })` next to `useStartupPrompts`. A `guide` prompt starts `getting-around` (and dismisses the prompt so `lastSeenVersion` is written). A new `useFirstVideoTour({ screen, seen, start })`: when `screen` becomes `results` and `toursSeen` lacks `first-video`, start it (once per session). `requestOnboarding('first-video')` from About starts it when `screen === 'results'`, else toasts "Open a video first, then start the editor guide." Renders `<TourOverlay …/>` and `<WhatsNewDialog …/>`. `StartupGuideDialog.tsx` and its test are deleted.

`App.tsx` gains at most one more line: `useTourNavigator({ setWorkspace: publishWorkspace.setWorkspace })`, and `<StartupPrompts active={…} screen={screen} />` replaces the current prop.

### Settings → General → About

"Startup guide" → `requestOnboarding('guide')`; a third button "Editor guide" → `requestOnboarding('first-video')`; `OnboardingKind` gains `'first-video'`. Help line: "The tours shown on a fresh install and after the first video, and the release highlights."

## 3. Docs

- `CHANGELOG.md` Unreleased: rewrite the guide paragraph as the interactive tour (two tours, real screens, reopenable).
- `CLAUDE.md` `components/onboarding/` bullet: the two tours, the `data-tour` attributes and the test that pins them, the `toursSeen` key, `tourNavigation`.
- `electron/app-state.js`: document `toursSeen`.

## 4. Verification

- Gates: `npm run typecheck`, `npm test`, `npm run lint`, prettier on touched files.
- A throwaway Vite harness page (not committed) that mounts `TourOverlay` over a fake page with `data-tour` elements at the four edges, to eyeball spotlight, flipping and the centred mode in both themes.
- In the Electron app after a restart: with `toursSeen` absent and the history keys removed from `app-state.json`, the getting-around tour runs on the library and opens Settings on the right panes; opening a video starts the first-video tour once; Settings → General → About reopens both.
