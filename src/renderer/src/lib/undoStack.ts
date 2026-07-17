/**
 * Pure undo/redo stack primitives + a debounced snapshot pusher factory.
 *
 * Extracted from hooks/useSettingsUndo.ts and hooks/useUndoRedo.ts (a
 * behavior-preserving refactor) so the core stack semantics — push, pop,
 * cap-at-N history, and debounce coalescing for bursty pushes (e.g. slider
 * drags) — can be unit-tested directly without a DOM. The hooks own the
 * React-specific bits (refs, state, setSettings/setSegments wiring); this
 * module owns the plain-data logic.
 *
 * All functions are immutable: they return new arrays rather than mutating
 * the ones passed in.
 */

export const MAX_HISTORY = 50

/**
 * Push a snapshot onto a stack, capping length at `maxHistory` by dropping
 * the oldest entries (front of the array). Returns a new array.
 */
export function pushSnapshot<T>(
  stack: readonly T[],
  snapshot: T,
  maxHistory: number = MAX_HISTORY
): T[] {
  const next = [...stack, snapshot]
  return next.length > maxHistory ? next.slice(next.length - maxHistory) : next
}

/**
 * Pop the most recent (last) snapshot off a stack. Returns the new stack and
 * the popped value — `popped` is `undefined` when the stack was already
 * empty, in which case `stack` is returned unchanged (as a new array).
 */
export function popSnapshot<T>(stack: readonly T[]): { stack: T[]; popped: T | undefined } {
  if (stack.length === 0) return { stack: [...stack], popped: undefined }
  const popped = stack[stack.length - 1]
  return { stack: stack.slice(0, -1), popped }
}

export interface DebouncedUndoPusher<T> {
  /** Queue a snapshot; `commit` fires `delayMs` after the last call in a burst. */
  push(snapshot: T): void
  /** Immediately commit any pending snapshot and cancel the pending timer. */
  flush(): void
  /** Discard a pending snapshot without committing, and cancel the timer. */
  cancel(): void
}

/**
 * Coalesces bursty snapshot pushes (e.g. a slider drag firing on every
 * onChange) into a single `commit` call `delayMs` after the last push in the
 * burst. Only the FIRST snapshot of a burst is committed — this mirrors
 * useSettingsUndo's intent: undo should restore the state from before the
 * drag started, not an intermediate value.
 */
export function createDebouncedUndoPusher<T>(
  commit: (snapshot: T) => void,
  delayMs: number = 500
): DebouncedUndoPusher<T> {
  let pending: { value: T } | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  const clearTimer = (): void => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  const commitPending = (): void => {
    if (pending !== null) {
      commit(pending.value)
      pending = null
    }
  }

  return {
    push(snapshot: T) {
      if (pending === null) pending = { value: snapshot }
      clearTimer()
      timer = setTimeout(() => {
        timer = null
        commitPending()
      }, delayMs)
    },
    flush() {
      clearTimer()
      commitPending()
    },
    cancel() {
      clearTimer()
      pending = null
    },
  }
}
