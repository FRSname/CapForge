# Startup guide and "What's new"

Two one-shot prompts at app start, both mounted once at the App root and both reachable again from Settings → General:

1. **Startup guide** — a stepped "Welcome to CapForge" walkthrough shown on a fresh install (and on demand): what the app does, the library, transcription, editing and styling, export, publishing, Claude.
2. **What's new** — a release-notes card shown once after an update, listing the highlights of every version newer than the one the user last saw.

Decisions (2026-09-16, Filip asked for both; the defaults below are mine and stated so they can be changed):

- A **fresh install shows the guide, not the changelog.** A first-time user has nothing to compare against; the guide's last step links to the release notes.
- An **update shows What's new** once, for every version between the last seen one and the current one, newest first.
- Existing users have no "last seen version" yet (the key is new). They are told apart from a fresh install by **evidence of use** in `app-state`: any of `lastInputPath`, `lastProjectPath`, `lastOutputDir` set (not `whisper_model`: the first-run wizard writes it when a non-default model is picked, before the library is ever seen). With evidence → What's new for the current version; without → the guide.
- Release notes are a **typed list in the renderer**, not CHANGELOG.md parsed at runtime: the popup shows five or six highlights per version, not the full prose, and a test pins the list to CHANGELOG.md and `package.json` so a release cannot ship without notes.
- The guide is **cards, not coach marks**. Steps are text with one optional action button (open a Settings category, open a link). Highlighting live UI elements across four screens is a different project.
- Neither prompt shows outside the **library screen** (never over a running transcription or the editor), and the runtime setup wizard is unaffected because it runs before the library is usable.

## 1. Pure logic (`src/renderer/src/lib/`)

### `version.ts`

`compareVersions(a, b): -1 | 0 | 1` over dotted numeric parts (`2.10.0 > 2.6.0`; a missing part is 0; a `v` prefix and a `-suffix` are ignored). A TypeScript twin of `electron/update-check.js` `compareVersions`; keep the semantics identical.

### `releaseNotes.ts`

```ts
export interface ReleaseHighlight { title: string; body: string }
export interface ReleaseNotes { version: string; headline: string; highlights: ReleaseHighlight[] }
export const RELEASE_NOTES: readonly ReleaseNotes[]   // newest first
export function notesSince(lastSeen: string | null, current: string): ReleaseNotes[]
export const RELEASES_URL = 'https://github.com/FRSname/CapForge/releases'
```

- `notesSince(null, current)` → the entry for `current` only (an update from an unknown version shows the current release, not the whole history). `notesSince(lastSeen, current)` → every entry with `lastSeen < version <= current`, newest first. Unknown `current` → `[]`.
- Seed `RELEASE_NOTES` with **v2.6.0** from CHANGELOG.md (headline + six highlights: RSVP speed-reading, captions held across gaps, choose your transcription model, gradient colours, favorite fonts, readable `.srt`/`.vtt` cues). Highlight bodies are one or two sentences in the changelog's voice, ≤ 220 characters.
- **Test `releaseNotes.test.ts` pins the list**: `RELEASE_NOTES[0].version === package.json version` (read with `fs` from the repo root, `resolve(__dirname, '../../../../package.json')`); every entry's version has a `## CapForge v<version>` heading in `CHANGELOG.md`; versions are strictly descending; each entry has 1–6 highlights with non-empty title and body; `notesSince` cases. This is what forces the release procedure below.

### `startupGuide.ts`

```ts
export type GuideAction =
  | { kind: 'settings'; label: string; category: AppSettingsCategoryId }
  | { kind: 'link'; label: string; url: string }
export interface GuideStep { id: string; title: string; paragraphs: string[]; action?: GuideAction }
export const GUIDE_STEPS: readonly GuideStep[]
export const TUTORIAL_URL = 'https://www.youtube.com/watch?v=7xxLt5FEq1E'   // the CHANGELOG's tutorial link
```

Seven steps, each two or three short paragraphs in the CHANGELOG's plain voice (no marketing), every claim true of the app today:

1. `welcome` — what CapForge is: drop a video, get a word-level transcript, style captions that render exactly as previewed, export, and write the upload package. Mention that everything stays on this machine.
2. `library` — the library is the home screen: Add video / Import… / drop files or folders, folders (collections), a watch folder in Settings → General, search and the grid/list views. Action: none (the library is behind the dialog).
3. `transcribe` — Start transcribes with WhisperX; the model is chosen in Settings → Transcription (size vs accuracy); speakers are detected; a language can be added later as a caption track. Action: settings → `transcription`.
4. `edit` — Text, Groups and Transcript views; right-click a word to correct it or style it; timings never move for words you did not touch; the timeline; presets and the style sidebar; the preview is the render. Action: none.
5. `export` — Render an MP4 with captions baked in, a transparent overlay (MOV/WebM) for an editor, or `.srt`/`.vtt`/`.ass`; HyperFrames for animated captions. Action: none.
6. `publish` — the Publish workspace: title, description, chapters, tags per channel; channels in Settings → Channels; folders carry an event's shared footer; the package is copied, never uploaded. Action: settings → `channels`.
7. `claude` — connect Claude Desktop or Claude Code in Settings → Claude & Skills; the bundled skills `capforge-init` (set up channels by interview) and `capforge-publish` (write the upload package); the agent edits captions live. Action: settings → `claude` (use the real category id from `appSettingsIndex.ts`). Second line of the step: "Watch the tutorial" as a link action is **not** possible with one action per step, so put the tutorial link in the dialog footer instead (see §3).

Test `startupGuide.test.ts`: ids unique, seven steps, every `settings` action names a category that exists in `APP_SETTINGS_CATEGORIES` (or whatever `appSettingsIndex.ts` exports), every paragraph non-empty and ≤ 320 characters.

### `startupPrompts.ts`

```ts
export type StartupPrompt =
  | { kind: 'none' }
  | { kind: 'guide' }
  | { kind: 'whats-new'; lastSeen: string | null }
export interface StartupEvidence { lastSeenVersion: string | null; currentVersion: string | null; hasHistory: boolean }
export function decideStartupPrompt(e: StartupEvidence): StartupPrompt
export const HISTORY_KEYS = ['lastInputPath', 'lastProjectPath', 'lastOutputDir'] as const
export const LAST_SEEN_VERSION_KEY = 'lastSeenVersion'
```

Rules, in order: no `currentVersion` (bridge missing, e.g. an old preload) → `none`; `lastSeenVersion === currentVersion` → `none`; `lastSeenVersion` null and no history → `guide`; `lastSeenVersion` null with history → `whats-new` (`lastSeen: null`); `lastSeenVersion < currentVersion` → `whats-new`; `lastSeenVersion > currentVersion` (a downgrade) → `none`. Test every branch.

### `onboardingRequests.ts`

The `settingsNavigation.ts` pattern (a listener set, no `window`): `requestOnboarding(kind: 'guide' | 'whats-new'): boolean` and `onOnboardingRequested(listener)`. Settings → General calls the first; the always-mounted `StartupPrompts` subscribes with the second. Test like `settingsNavigation.test.ts`.

## 2. Electron bridges (three-file edits — see CLAUDE.md "Dual preload gotcha")

- `app:version` → `window.subforge.getVersion(): Promise<string>` returning `app.getVersion()`.
- `shell:open-external` → `window.subforge.openExternal(url: string): Promise<{ ok: boolean; error?: string }>`. Main validates with a pure helper in a new `electron/external-links.js`: `isAllowedExternalUrl(url)` — `https:` only, host in an allowlist (`github.com`, `www.youtube.com`, `youtube.com`, `youtu.be`), no credentials in the URL. Anything else is refused with `{ ok: false, error }` and never reaches `shell.openExternal`. `electron/external-links.test.js` (node `--test`, like `electron/skills-store.test.js`) covers accepted, wrong scheme, unknown host, `javascript:`, a URL with `user:pass@`.
- Edit `electron/main.js` (handlers), `electron/preload.js` (bridge), `src/preload/index.ts` (types). Add the two `app-state` keys to the comment block in `electron/app-state.js`: `lastSeenVersion string — the version whose What's new / guide the user has dismissed` and note that no other key is written by this feature.

## 3. Renderer

### `components/ui/ModalShell.tsx`

The scrim + card pattern `ShortcutOverlay.tsx` uses, extracted so the two new dialogs share it (do **not** retrofit ShortcutOverlay or SettingsDialog in this change). Props: `open`, `onClose`, `label` (the `aria-label`), `width` (a Tailwind width class, default `w-[560px]`), `children`. Fixed scrim `bg-black/40 backdrop-blur-sm` at `z-[var(--z-modal)]`, `role="dialog" aria-modal="true"`, `useFocusTrap`, Escape closes, scrim click closes, card `pop-in`, `bg-[var(--color-surface)]`, colours only through CSS variables. Returns `null` when closed. Test: closed renders nothing; open renders `role="dialog"`, `aria-modal="true"`, the label and the children.

### `components/onboarding/WhatsNewDialog.tsx`

Props: `open`, `notes: ReleaseNotes[]`, `onClose`, `onOpenUrl(url)`. Header "What's new in CapForge <first version>" (or "What's new" when several). Per version: a small version label, the headline, then the highlights as a list — bold title, body underneath in `--color-text-2`. Footer: a ghost "Full changelog" button (`onOpenUrl(RELEASES_URL)`) and a primary "Got it" (`onClose`). Empty `notes` renders a one-line "You're up to date." Card `w-[520px]`, scrolls at `max-h-[80vh]`. Test: version, headline and every highlight title appear; the Full changelog and Got it buttons exist; empty state.

### `components/onboarding/StartupGuideDialog.tsx`

Props: `open`, `onClose`, `onOpenSettings(category)`, `onOpenUrl(url)`. State: the step index (a `useState`, reset to 0 whenever `open` flips to true). Layout: a header row with "Welcome to CapForge" and "Step n of 7"; the step's title (`--cf-font-display`, larger); its paragraphs; the optional action as a ghost button that **also closes the dialog** (Settings opens on top of nothing); a footer with a dot rail (`aria-label="Step n"` buttons, the current one in `--color-brand`), "Back" (disabled on step 1), "Next" (primary; on the last step it reads "Get started" and closes), and a text-link "Skip" on the left on every step but the last. Below the footer, `components/onboarding/TutorialPlayer.tsx`: one line, "Prefer to watch? ▶ Watch the tutorial · Open in browser", where the first button toggles a `showTutorial` state (reset to false by the same render-time reset that resets the step index) and the second is `onOpenUrl(TUTORIAL_URL)`. Expanded, a 16:9 box above that line holds an `<iframe>` on `TUTORIAL_EMBED_URL` (the youtube-nocookie host), the first button reads "Hide the tutorial", and the line is unchanged otherwise. **Click to load:** the iframe is not in the tree while collapsed, so opening the guide reaches nothing external; `TutorialPlayer.test.tsx` pins that. The embed needs `frame-src https://www.youtube-nocookie.com` in `src/renderer/index.html`'s CSP (`default-src 'self'` blocks every frame), pinned by `lib/csp.test.ts`, and `main.js` gives the window a `setWindowOpenHandler` so the player's "Watch on YouTube" link goes to the browser through the same allowlist rather than opening a second Electron window. Keyboard: ← / → step while open (a `keydown` listener like Escape's, ignored from inputs). Card `w-[560px]`. Test (static markup only): step 1 title and "Step 1 of 7"; the dot rail has 7 buttons; "Skip", "Next", the tutorial link; the last step cannot be reached without state so test the copy through `GUIDE_STEPS` instead.

### `hooks/useStartupPrompts.ts`

```ts
export function useStartupPrompts(active: boolean): {
  prompt: StartupPrompt; notes: ReleaseNotes[]; version: string | null
  dismiss(): void; show(kind: 'guide' | 'whats-new'): void
}
```

- On mount: `Promise.all([getVersion(), getState(LAST_SEEN_VERSION_KEY, null), ...HISTORY_KEYS.map(k => getState(k, null))])` → `decideStartupPrompt`. `window.subforge.getVersion` may be **undefined** on an old preload (the dual-preload gotcha, and a dev app that was not restarted): guard with `typeof … === 'function'`, treat as `currentVersion: null` → no prompt. Any rejection → `none` and `console.warn`; never a toast at startup.
- The automatic prompt only surfaces while `active` (library screen); if the screen changes before it is dismissed it stays pending and returns when the library is back. An explicit `show()` ignores `active`.
- `dismiss()` writes `lastSeenVersion = version` (when known) and sets `none`. A fresh install's guide dismissal writes it too, so the next start shows nothing. A `show()` from Settings does not write anything on dismiss beyond the same key (harmless).
- `notes` = `notesSince(prompt.lastSeen, version)` for `whats-new`, else `notesSince(null, version)` so Settings → "What's new" shows the current release.
- Subscribes to `onOnboardingRequested` → `show(kind)`.

### `components/onboarding/StartupPrompts.tsx`

The one thing App mounts: `<StartupPrompts active={screen === 'library'} />`. Owns `useStartupPrompts`, renders both dialogs, wires `onOpenSettings` → `requestSettingsCategory(category)` and `onOpenUrl` → `window.subforge.openExternal(url)` (a `{ ok: false }` answer is toasted with `useToast`). Mount in `App.tsx` right after `<ShortcutOverlay …/>`. App.tsx is at its size ceiling — this is a one-line addition, nothing else moves.

### Settings → General: an "About" block

At the end of `GeneralSettings.tsx`, after Logs: label "About", a line "CapForge <version>" (version from `getVersion()` on mount, "—" until known, mono font like the library path row), and two ghost buttons "What's new" and "Startup guide" that call `requestOnboarding(...)`. The General pane gets no new props: **the two dialogs render above Settings** (`--z-modal` is shared and `StartupPrompts` is mounted after `SettingsDialog`, so it paints on top), and Settings is still there when the dialog closes. That avoids threading an `onClose` through the pane. Extend `GeneralSettings.test.tsx` with the About block (the label and both buttons present).

## 4. Docs and release procedure

- `CHANGELOG.md` → Unreleased → New Features: "**A startup guide and What's new**" paragraph (what shows when, and where to reopen both).
- `CLAUDE.md` renderer list: add `components/onboarding/` (StartupPrompts, StartupGuideDialog, WhatsNewDialog over `lib/startupPrompts.ts`, `lib/startupGuide.ts`, `lib/releaseNotes.ts`; the `lastSeenVersion` key; the notes-pinning test) and the release rule below, plus `window.subforge.getVersion` / `openExternal` in the bridge list if one exists there.
- **Release rule** (write it in CHANGELOG's own comment or CLAUDE.md): bumping `package.json` `version` without adding a `RELEASE_NOTES` entry and a `## CapForge v<version>` heading fails `releaseNotes.test.ts` in the frontend CI job. That is intended.

## 5. Verification

- `npm run typecheck`, `npm test`, `npm run lint`, `node --test electron/external-links.test.js`.
- In the running dev app (Vite HMR): Settings → General → "Startup guide" and "What's new" open the dialogs (the version line reads "—" until the app is restarted, because the main-process bridge is new). Screenshot both, both themes if cheap.
- The automatic prompt can only be exercised after an app restart: expected on this machine (history present, no `lastSeenVersion`) is **What's new in CapForge 2.6.0** once, then nothing.
