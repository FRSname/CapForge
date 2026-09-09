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

/**
 * Independent undo/redo histories, one per key.
 *
 * Caption tracks each own a `StudioSettings`, and a Cmd+Z on the Polish tab
 * must never restore a value the user set on the English one — so the stacks
 * (and the debounce that feeds them) are partitioned by track id rather than
 * shared. Each key caps at `maxHistory` on its own; a key with no history yet
 * behaves exactly like a fresh stack, so a caller that only ever passes one key
 * gets precisely the single-stack semantics this replaced.
 */
export interface KeyedUndoStacks<T> {
  /** Queue a snapshot onto `key`'s undo stack (debounced, per key). */
  push(key: string, snapshot: T): void
  /** Flush `key`'s pending push, then pop it. `current` goes onto redo.
   *  Returns undefined (touching nothing) when that key has no history. */
  undo(key: string, current: T): T | undefined
  /** Pop `key`'s redo stack, pushing `current` back onto undo. */
  redo(key: string, current: T): T | undefined
  /** Commit `key`'s pending debounced push immediately. */
  flush(key: string): void
  /** Stack depths for `key` — introspection for tests. */
  depth(key: string): { undo: number; redo: number }
}

export function createKeyedUndoStacks<T>(
  delayMs: number = 500,
  maxHistory: number = MAX_HISTORY
): KeyedUndoStacks<T> {
  const undoStacks = new Map<string, T[]>()
  const redoStacks = new Map<string, T[]>()
  const pushers = new Map<string, DebouncedUndoPusher<T>>()

  const stackFor = (stacks: Map<string, T[]>, key: string): T[] => stacks.get(key) ?? []

  // One debouncer per key: a burst on one track must not coalesce with, or be
  // committed into, another track's history.
  const pusherFor = (key: string): DebouncedUndoPusher<T> => {
    const existing = pushers.get(key)
    if (existing) return existing
    const created = createDebouncedUndoPusher<T>((snapshot) => {
      undoStacks.set(key, pushSnapshot(stackFor(undoStacks, key), snapshot, maxHistory))
      redoStacks.set(key, [])
    }, delayMs)
    pushers.set(key, created)
    return created
  }

  return {
    push(key, snapshot) {
      pusherFor(key).push(snapshot)
    },
    flush(key) {
      pushers.get(key)?.flush()
    },
    undo(key, current) {
      // Flush first: the snapshot from a drag that just ended is still pending.
      pushers.get(key)?.flush()
      const stack = stackFor(undoStacks, key)
      if (stack.length === 0) return undefined
      redoStacks.set(key, pushSnapshot(stackFor(redoStacks, key), current, maxHistory))
      const { stack: rest, popped } = popSnapshot(stack)
      undoStacks.set(key, rest)
      return popped
    },
    redo(key, current) {
      const stack = stackFor(redoStacks, key)
      if (stack.length === 0) return undefined
      undoStacks.set(key, pushSnapshot(stackFor(undoStacks, key), current, maxHistory))
      const { stack: rest, popped } = popSnapshot(stack)
      redoStacks.set(key, rest)
      return popped
    },
    depth(key) {
      return { undo: stackFor(undoStacks, key).length, redo: stackFor(redoStacks, key).length }
    },
  }
}
