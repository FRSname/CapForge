/**
 * The Publish workspace's plumbing: one open record, its local drafts, and the
 * three ways it can change under you.
 *
 * Thin on purpose — every decision lives in the pure modules
 * (`lib/publishFields.ts`, `lib/publishDrafts.ts`, `lib/publishChapters.ts`,
 * `lib/youtubeRules.ts`, `lib/publishTypes.ts`) and every *rule* lives in
 * Python (`POST /api/library/validate`). This hook only binds them to I/O and
 * holds state:
 *
 *  - **Drafts.** A card writes a field locally and a debounced `PATCH` carries
 *    it, guarded by the `rev` the panel last read (`If-Match`).
 *  - **Collisions.** A `409` means the agent wrote first: the current record is
 *    adopted, the draft is kept and the user is told (vision §9.7 — never
 *    swallow the 409). A `422` means the backend's hard validators refused the
 *    write: the findings render under the fields, the draft is kept.
 *  - **The soft lock.** A `record_updated` push while a field is being typed
 *    keeps that field and takes the rest (`mergeAgentUpdate`), raising a banner
 *    the user answers with Apply or Keep mine (vision §3.5 tier 2).
 *
 * Nothing is swallowed: every failure reaches `notify`, App's toast relay.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Segment, Word } from '../types/app'
import { api } from '../lib/api'
import type { Chapter, PublishAuthored, PublishRecord, Violation } from '../lib/publishTypes'
import {
  lockedField,
  mergeDrafts,
  remainingDrafts,
  survivingDrafts,
  withoutDraft,
} from '../lib/publishDrafts'
import type { DraftValue, PublishDrafts } from '../lib/publishDrafts'
import {
  insertChapter,
  removeChapter,
  renameChapter,
  withSuggestions,
} from '../lib/publishChapters'
import {
  authoredFields,
  fieldLabel,
  mergeAgentUpdate,
  provenanceOf,
  revertPatchFor,
  speakersFromTranscript,
  violationsForField,
} from '../lib/publishFields'
import type { PublishFieldId, Provenance } from '../lib/publishFields'
import { usePublishWriter } from './usePublishWriter'

/** The two moment kinds a chapter suggestion is built from. */
const CHAPTER_MOMENT_KINDS = ['pause', 'speaker_change'] as const

/** Publish state is per channel now: only a channel tab's controller records a URL. */
export const MARK_PUBLISHED_ON_A_TAB_MESSAGE = 'Mark a post published from its channel tab.'
export const NO_CHAPTER_CANDIDATES_MESSAGE =
  'No new chapter candidates — the transcript has no pause or speaker change far enough from the chapters you already have.'

/** A `record_updated` push that landed on the field under the cursor. */
export interface AgentUpdateNotice {
  field: PublishFieldId
  /** The actor the backend attributed the write to (`agent`, `user`, …). */
  by: string
  /** What the agent wrote, held until the user chooses Apply or Keep mine. */
  remoteValue: unknown
}

export interface PublishRecordInput {
  /** The library record this session belongs to; null means no dossier. */
  videoId: string | null
  /** The source transcript — speaker rows and word-start snapping read it. */
  segments: readonly Segment[]
  /** Project duration, sent with unsaved text so chapter rules can apply. */
  duration: number | null
  /** App's toast relay. Every failure goes here; nothing is swallowed. */
  notify: (message: string) => void
}

export interface PublishController {
  record: PublishRecord | null
  /** The record with the local drafts laid over it — what every card renders. */
  fields: PublishAuthored
  loading: boolean
  saving: boolean
  /** True while any field differs from the last saved record. */
  dirty: boolean
  violationsFor: (field: string) => Violation[]
  provenance: (field: PublishFieldId) => Provenance | null
  canRevert: (field: PublishFieldId) => boolean
  revert: (field: PublishFieldId) => void
  setField: <K extends PublishFieldId>(field: K, value: DraftValue<K>) => void
  /** Move the video into a collection (or out, with null) — written at once, not debounced. */
  setCollection: (collectionId: string | null) => void
  /** Send pending drafts now (before a frame grab/delete bumps `rev`); settles, never throws. */
  flushDrafts: () => Promise<void>
  /** A write that must not wait for the debounce (add/hide a channel); settles, never throws. */
  patchNow: (patch: Record<string, unknown>) => Promise<void>
  beginEdit: (field: PublishFieldId) => void
  endEdit: () => void
  pendingAgentUpdate: AgentUpdateNotice | null
  applyAgentUpdate: () => void
  keepMine: () => void
  markPublished: (url: string) => void
  suggestChapters: () => void
  /** Insert a chapter at `seconds`, snapped back to the nearest word start. */
  insertChapterAt: (seconds: number) => void
  removeChapterAt: (index: number) => void
  renameChapter: (index: number, title: string) => void
  /** The diarized ids the Speakers card offers to name. */
  speakerIds: string[]
}

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function usePublishRecord({
  videoId,
  segments,
  duration,
  notify,
}: PublishRecordInput): PublishController {
  const [record, setRecord] = useState<PublishRecord | null>(null)
  const [drafts, setDrafts] = useState<PublishDrafts>({})
  const [violations, setViolations] = useState<Violation[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pendingAgentUpdate, setPendingAgentUpdate] = useState<AgentUpdateNotice | null>(null)

  // The debounced writer runs long after the render that armed it, so it reads
  // the live state from here rather than from a captured closure.
  const stateRef = useRef<{ record: PublishRecord | null; drafts: PublishDrafts }>({
    record: null,
    drafts: {},
  })
  stateRef.current = { record, drafts }
  const notifyRef = useRef(notify)
  notifyRef.current = notify
  const durationRef = useRef(duration)
  durationRef.current = duration
  /** The field the cursor is in — the soft lock's subject. */
  const editingRef = useRef<PublishFieldId | null>(null)

  const fields: PublishAuthored = useMemo(() => mergeDrafts(record, drafts), [record, drafts])

  const words: Word[] = useMemo(() => segments.flatMap((s) => s.words), [segments])
  const speakerIds = useMemo(() => speakersFromTranscript(segments), [segments])

  // ── Validation ──────────────────────────────────────────────────
  // The rules live in Python once; this only asks, on the same debounce, so
  // unsaved text is checked too.
  const validate = useCallback((id: string, next: PublishAuthored) => {
    api
      .validateFields({
        video_id: id,
        fields: authoredFields(next),
        ...(durationRef.current != null ? { duration: durationRef.current } : {}),
      })
      .then(setViolations)
      .catch((err) => notifyRef.current(`Could not check this record: ${reasonOf(err)}`))
  }, [])

  /** Adopt a record the backend handed back, dropping the drafts it now carries. */
  const adopt = useCallback((next: PublishRecord, sent: PublishDrafts) => {
    setRecord(next)
    setDrafts((prev) => remainingDrafts(prev, sent))
  }, [])

  // ── The writes ──────────────────────────────────────────────────
  // The debounced PATCH, the immediate one and the two structured refusals
  // live in `usePublishWriter`; this hook only says what to do with what comes
  // back.
  const { schedule, flushNow, patchNow } = usePublishWriter({
    stateRef,
    notifyRef,
    onSaved: useCallback(
      (next: PublishRecord, sent: PublishDrafts) => {
        adopt(next, sent)
        setViolations([])
        validate(next.id, mergeDrafts(next, stateRef.current.drafts))
      },
      [adopt, validate]
    ),
    onRecord: setRecord,
    onViolations: setViolations,
    onSaving: setSaving,
  })

  // ── Load ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!videoId) {
      setRecord(null)
      setDrafts({})
      setViolations([])
      setPendingAgentUpdate(null)
      return
    }
    let cancelled = false
    setLoading(true)
    api
      .getLibraryRecord(videoId)
      .then((next) => {
        if (cancelled) return
        setRecord(next)
        setDrafts({})
        setPendingAgentUpdate(null)
        validate(next.id, next)
      })
      .catch((err) => {
        if (!cancelled) notifyRef.current(`Could not open this record: ${reasonOf(err)}`)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [videoId, validate])

  // ── The agent wrote this record ─────────────────────────────────
  useEffect(() => {
    if (!videoId) return undefined
    return api.onRecordUpdated((event) => {
      if (event.videoId !== videoId) return
      // Our own successful write already installed this revision.
      if (event.rev <= (stateRef.current.record?.rev ?? 0)) return
      api
        .getLibraryRecord(videoId)
        .then((remote) => {
          const { record: local, drafts: pending } = stateRef.current
          const locked = lockedField(editingRef.current, pending)
          // Drafts on fields the agent left alone stay; the locked one stays
          // too and gets the banner; the rest are the agent's now.
          const surviving = local ? survivingDrafts(pending, local, remote, locked) : {}
          const next =
            local && locked ? mergeAgentUpdate({ ...local, ...pending }, remote, locked) : remote
          setRecord(next)
          setDrafts(surviving)
          if (locked) {
            setPendingAgentUpdate({ field: locked, by: event.by, remoteValue: remote[locked] })
          }
          // The findings on screen describe the record before the agent's
          // write; ask again over what is shown now.
          validate(remote.id, mergeDrafts(next, surviving))
        })
        .catch((err) =>
          notifyRef.current(
            `The agent changed this record but it could not be read: ${reasonOf(err)}`
          )
        )
    })
  }, [videoId, validate])

  // ── The card-facing API ─────────────────────────────────────────
  const setField = useCallback(
    <K extends PublishFieldId>(field: K, value: DraftValue<K>) => {
      setDrafts((prev) => ({ ...prev, [field]: value }))
      schedule()
    },
    [schedule]
  )

  const setCollection = useCallback(
    (collectionId: string | null) => {
      setDrafts((prev) => withoutDraft(prev, 'collection_id'))
      patchNow({ collection_id: collectionId })
    },
    [patchNow]
  )

  const beginEdit = useCallback((field: PublishFieldId) => {
    editingRef.current = field
  }, [])

  const endEdit = useCallback(() => {
    editingRef.current = null
  }, [])

  const violationsFor = useCallback(
    (field: string) => violationsForField(violations, field),
    [violations]
  )

  const provenance = useCallback(
    (field: PublishFieldId) => (record ? provenanceOf(record, field) : null),
    [record]
  )

  const canRevert = useCallback(
    (field: PublishFieldId) => (record ? revertPatchFor(record, field) !== null : false),
    [record]
  )

  const revert = useCallback(
    (field: PublishFieldId) => {
      if (!record) return
      const patch = revertPatchFor(record, field)
      if (!patch) {
        notifyRef.current(`There is nothing to revert for ${fieldLabel(field)}.`)
        return
      }
      setDrafts((prev) => withoutDraft(prev, field))
      patchNow(patch)
    },
    [record, patchNow]
  )

  const applyAgentUpdate = useCallback(() => {
    setPendingAgentUpdate((pending) => {
      if (!pending) return null
      setDrafts((prev) => withoutDraft(prev, pending.field))
      setRecord((prev) =>
        prev ? ({ ...prev, [pending.field]: pending.remoteValue } as PublishRecord) : prev
      )
      return null
    })
  }, [])

  const keepMine = useCallback(() => {
    // The draft is already the visible value; re-send it against the revision
    // the agent left behind so the user's version is what lands on disk.
    setPendingAgentUpdate(null)
    schedule()
  }, [schedule])

  const setChapters = useCallback((next: Chapter[]) => setField('chapters', next), [setField])

  const suggestChapters = useCallback(() => {
    const current = stateRef.current.record
    if (!current) return
    const existing = fields.chapters
    Promise.all(CHAPTER_MOMENT_KINDS.map((kind) => api.getLibraryMoments(current.id, kind)))
      .then((lists) => {
        const next = withSuggestions(existing, lists.flat())
        if (!next) {
          notifyRef.current(NO_CHAPTER_CANDIDATES_MESSAGE)
          return
        }
        setChapters(next)
      })
      .catch((err) => notifyRef.current(`Could not suggest chapters: ${reasonOf(err)}`))
  }, [setChapters, fields.chapters])

  return {
    record,
    fields,
    loading,
    saving,
    dirty: Object.keys(drafts).length > 0,
    violationsFor,
    provenance,
    canRevert,
    revert,
    setField,
    setCollection,
    flushDrafts: flushNow,
    beginEdit,
    endEdit,
    pendingAgentUpdate,
    applyAgentUpdate,
    keepMine,
    patchNow,
    markPublished: () => notifyRef.current(MARK_PUBLISHED_ON_A_TAB_MESSAGE),
    suggestChapters,
    insertChapterAt: (seconds: number) =>
      setChapters(insertChapter(fields.chapters, seconds, words)),
    removeChapterAt: (index: number) => setChapters(removeChapter(fields.chapters, index)),
    renameChapter: (index: number, title: string) =>
      setChapters(renameChapter(fields.chapters, index, title)),
    speakerIds,
  }
}
