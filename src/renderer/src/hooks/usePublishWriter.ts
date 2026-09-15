/**
 * The write half of the Publish workspace: the debounced `PATCH`, the
 * immediate one, and what each of the two structured refusals means.
 *
 * Split out of `usePublishRecord` because it is the part with no state of its
 * own — it reads the live record + drafts from a ref and reports back through
 * callbacks, so the panel's state stays in one place while the I/O and its
 * failure modes live here.
 *
 * Nothing is swallowed. A `409` (the agent wrote first) reloads, keeps the
 * draft, tells the user and re-sends **once**; a `422` (a hard rule) surfaces
 * the findings and keeps the draft; anything else is reported as-is.
 */

import { useCallback, useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'
import { StaleRecordError, ValidationRefusedError, api } from '../lib/api'
import type { PublishRecord, Violation } from '../lib/publishTypes'
import type { PublishDrafts } from '../lib/publishDrafts'
import { draftWire, immediateWire } from '../lib/publishWire'

/**
 * Trailing debounce before a `PATCH`. Longer than the mirror's 300 ms: this is
 * a durable write to a file on disk, and a title is typed a character at a time.
 */
export const PUBLISH_PATCH_DEBOUNCE_MS = 600

export const AGENT_CONFLICT_MESSAGE = 'Reloaded — the agent changed this record.'
const REFUSED_MESSAGE = 'This record breaks a YouTube limit — see the findings.'

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export interface PublishWriterInput {
  /** The live record + drafts, read when the timer fires rather than when armed. */
  stateRef: MutableRefObject<{ record: PublishRecord | null; drafts: PublishDrafts }>
  /** App's toast relay, through a ref so the writer is stable for the session. */
  notifyRef: MutableRefObject<(message: string) => void>
  /** A debounced write landed: `sent` is what it carried. */
  onSaved: (next: PublishRecord, sent: PublishDrafts) => void
  /** A record arrived some other way (an immediate write, or a collision reload). */
  onRecord: (next: PublishRecord) => void
  onViolations: (violations: Violation[]) => void
  onSaving: (saving: boolean) => void
}

export interface PublishWriter {
  /** Arm (or re-arm) the debounced write of whatever drafts are outstanding. */
  schedule: () => void
  /**
   * Send the outstanding drafts now instead of on the debounce — before an
   * action that bumps `rev` itself (grabbing or deleting a frame), so the
   * user's own edit does not come back as a 409. Resolves once it has settled;
   * failures are reported through `notifyRef`, never thrown.
   */
  flushNow: () => Promise<void>
  /** A write that must not wait for a debounce (Revert, Publish state). */
  patchNow: (patch: Record<string, unknown>) => Promise<void>
}

export function usePublishWriter({
  stateRef,
  notifyRef,
  onSaved,
  onRecord,
  onViolations,
  onSaving,
}: PublishWriterInput): PublishWriter {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** One retry per collision, so a losing race cannot become a loop. */
  const retriedRef = useRef(false)
  // `flush` re-arms the debounce after a collision and `schedule` calls
  // `flush`; the indirection is what keeps the two `useCallback`s acyclic.
  const scheduleRef = useRef<() => void>(() => {})

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    []
  )

  const flush = useCallback((): Promise<void> => {
    const { record: current, drafts: pending } = stateRef.current
    if (!current || Object.keys(pending).length === 0) return Promise.resolve()
    // `sent` keeps the draft values by identity (that is how `remainingDrafts`
    // settles them); the wire copy takes `thumbnail.candidates` from the record
    // as it is *now*, never from the draft, and names only the `localized`
    // languages and `posts` fields that still differ from it (`lib/publishWire.ts`).
    const sent = { ...pending }
    const wire = draftWire(sent, current)
    onSaving(true)
    return api
      .patchLibraryRecord(current.id, wire, current.rev)
      .then((next) => {
        retriedRef.current = false
        onSaved(next, sent)
      })
      .catch((err) => {
        if (err instanceof StaleRecordError) {
          notifyRef.current(AGENT_CONFLICT_MESSAGE)
          // Keep the draft: the field the user was writing still wins, but it
          // has to be re-sent against the revision the agent left behind.
          const reloaded = err.current
            ? Promise.resolve(err.current)
            : api.getLibraryRecord(current.id)
          return reloaded
            .then((next) => {
              onRecord(next)
              if (retriedRef.current) return
              retriedRef.current = true
              scheduleRef.current()
            })
            .catch((e) => notifyRef.current(`Could not reload this record: ${reasonOf(e)}`))
        }
        if (err instanceof ValidationRefusedError) {
          onViolations(err.violations)
          notifyRef.current(err.message || REFUSED_MESSAGE)
          return
        }
        notifyRef.current(`Could not save this record: ${reasonOf(err)}`)
      })
      .finally(() => onSaving(false))
  }, [stateRef, notifyRef, onSaved, onRecord, onViolations, onSaving])

  const schedule = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      flush()
    }, PUBLISH_PATCH_DEBOUNCE_MS)
  }, [flush])
  scheduleRef.current = schedule

  const flushNow = useCallback((): Promise<void> => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    return flush()
  }, [flush])

  const patchNow = useCallback(
    (patch: Record<string, unknown>): Promise<void> => {
      const current = stateRef.current.record
      if (!current) return Promise.resolve()
      // A `localized` here is a whole earlier value; `posts` is sent as written.
      const wire = immediateWire(patch, current)
      onSaving(true)
      return api
        .patchLibraryRecord(current.id, wire, current.rev)
        .then((next) => {
          onRecord(next)
          onViolations([])
        })
        .catch((err) => {
          if (err instanceof StaleRecordError) {
            notifyRef.current(AGENT_CONFLICT_MESSAGE)
            if (err.current) onRecord(err.current)
            return
          }
          if (err instanceof ValidationRefusedError) {
            onViolations(err.violations)
            notifyRef.current(err.message || REFUSED_MESSAGE)
            return
          }
          notifyRef.current(`Could not save this record: ${reasonOf(err)}`)
        })
        .finally(() => onSaving(false))
    },
    [stateRef, notifyRef, onRecord, onViolations, onSaving]
  )

  return { schedule, flushNow, patchNow }
}
