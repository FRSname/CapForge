/**
 * Transient discovery hints — the one-line "Ctrl+Wheel: zoom" labels on the
 * player's surfaces. They used to sit there permanently, which is noise for
 * everyone past their first minute, so each one shows itself once per session
 * and then stays out of the way (the same shortcut is listed in the shortcuts
 * overlay, `lib/shortcuts.ts`, which is what keeps it discoverable after).
 *
 * The session memory is a plain `Set<string>` owned by the hook; this module is
 * the pure rule, so the "once, and only the first time" contract is testable in
 * the `node` test environment, where there are no pointer events.
 */

/** How long a hint stays on screen after it is revealed, in milliseconds. */
export const HINT_VISIBLE_MS = 2500

/**
 * Whether `id` should be revealed now: true exactly once per `seen` set.
 *
 * Mutates `seen` — it *is* the session memory, not a value derived from it.
 */
export function firstReveal(seen: Set<string>, id: string): boolean {
  if (seen.has(id)) return false
  seen.add(id)
  return true
}
