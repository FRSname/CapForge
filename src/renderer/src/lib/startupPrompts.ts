/**
 * Which one-shot prompt a start deserves: the startup guide, the release
 * notes, or nothing.
 *
 * A fresh install has nothing to compare against, so it gets the guide, which
 * is the `getting-around` coach-mark tour rather than a dialog (`TOURS` in
 * `lib/tourSteps.ts`). An update gets "What's new". Existing users predate the
 * `lastSeenVersion` key entirely, so they are told apart from a fresh install
 * by evidence of use in `app-state` (a path they picked, a model they chose).
 */

import { compareVersions } from './version'

export type StartupPrompt =
  | { kind: 'none' }
  /** Start the `getting-around` tour; `StartupPrompts` turns it into one. */
  | { kind: 'guide' }
  | { kind: 'whats-new'; lastSeen: string | null }

export interface StartupEvidence {
  /** The version whose prompt was last dismissed, null when the key is new. */
  lastSeenVersion: string | null
  /** `app.getVersion()`, null when the bridge is missing (an old preload). */
  currentVersion: string | null
  /** Any `HISTORY_KEYS` entry is set: this install has been used before. */
  hasHistory: boolean
}

/**
 * `app-state` keys that mean "this is not a fresh install". Read only, never
 * written by this feature. `whisper_model` is deliberately absent: the
 * first-run wizard writes it when the user picks a non-default model, so it
 * can be set before the library is ever seen.
 */
export const HISTORY_KEYS = ['lastInputPath', 'lastProjectPath', 'lastOutputDir'] as const

/** The one `app-state` key this feature writes. */
export const LAST_SEEN_VERSION_KEY = 'lastSeenVersion'

/** The "show nothing" answer, shared so callers can compare against it. */
export const NO_PROMPT: StartupPrompt = { kind: 'none' }

export function decideStartupPrompt(evidence: StartupEvidence): StartupPrompt {
  const { lastSeenVersion, currentVersion, hasHistory } = evidence
  if (!currentVersion) return NO_PROMPT
  if (lastSeenVersion === null) {
    return hasHistory ? { kind: 'whats-new', lastSeen: null } : { kind: 'guide' }
  }
  const order = compareVersions(lastSeenVersion, currentVersion)
  if (order >= 0) return NO_PROMPT
  return { kind: 'whats-new', lastSeen: lastSeenVersion }
}

/**
 * What the user actually sees. A prompt asked for by hand (Settings ->
 * General) shows wherever they are; the automatic one waits for the library
 * screen and stays pending until it gets there, so it never lands over a
 * running transcription or the editor.
 */
export function visiblePrompt(
  forced: StartupPrompt | null,
  pending: StartupPrompt,
  active: boolean
): StartupPrompt {
  if (forced) return forced
  return active ? pending : NO_PROMPT
}
