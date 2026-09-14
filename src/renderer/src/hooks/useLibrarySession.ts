/**
 * The record side of one editing session (v3 deliverable #3).
 *
 * Absorbs the old `useLibraryOpen`: it owns `activeVideoId` — the record the
 * mirror publishes and the MCP tools confirm against — and everything that
 * follows from it. Set by Start (`ensureRecordFor`), by the agent's
 * `load_video` and `open_video`, and by a project restore; cleared by New.
 *
 * Thin on purpose. Every decision lives in `lib/librarySession.ts` and
 * `lib/libraryOpen.ts`, which are pure and tested; this hook binds the I/O
 * (the library routes, the app-state store, the local autosave file) and holds
 * the two pieces of state the UI reads.
 *
 * Inputs are held in a ref so `applyEchoedCommand` is stable for the whole
 * session — `AgentLiveSync`'s control socket is created once and reads its
 * callbacks from refs, so a fresh closure per render would be pointless churn
 * and a captured one would go stale.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type AgentCommand } from '../lib/api'
import { applyEchoedCommandWith, openVideoFromLibrary } from '../lib/libraryOpen'
import {
  LIBRARY_FALLBACK_MESSAGE,
  planSnapshotWrite,
  openRecordPlan,
  recordCreateFailedMessage,
  recordOpenFailedMessage,
  withFallbackStamp,
} from '../lib/librarySession'
import type { LibraryVideo } from '../lib/libraryTypes'

/** `app-state` key holding the output folder the sidebar last exported to. */
export const LAST_OUTPUT_DIR_KEY = 'lastOutputDir'

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export interface LibrarySessionInput {
  /** The current screen — `openVideoFromLibrary` refuses while transcribing. */
  screen: string
  /** App's restore: true when the store was replaced, false when rejected. */
  restoreFromProjectFile: (raw: unknown) => Promise<boolean>
  /** The synchronous track-write applier (`create_track` / … ). */
  applyTrackCommand: (cmd: AgentCommand) => string
  /** A record with no stored session — hand its media to the drop screen. */
  onChooseFile: (sourcePath: string) => void
  /**
   * Report a failure to the user. App sits above `ToastProvider`, so this is
   * its relay setter rather than `useToast` — nothing here is swallowed.
   */
  notify: (message: string) => void
}

export interface LibrarySession {
  /** The library record this session belongs to; null until one is opened. */
  activeVideoId: string | null
  /** Create-or-return the record for a media path. Null when it failed. */
  ensureRecordFor: (path: string) => Promise<string | null>
  /** New: this session no longer belongs to a record. */
  clearActive: () => void
  /** Applies a polled agent command, returning its toast copy. Throws on refusal. */
  applyEchoedCommand: (cmd: AgentCommand) => Promise<string>
  /** A card was opened: restore its session, or send its file to the drop screen. */
  openRecord: (video: LibraryVideo) => Promise<void>
  /** The sidebar's export folder — lifted here so it survives a screen change. */
  outputDir: string
  setOutputDir: (dir: string) => void
  /** The autosave writer: the record first, the local file only as a fallback. */
  writeSnapshot: (snapshot: unknown) => Promise<void>
}

export function useLibrarySession(input: LibrarySessionInput): LibrarySession {
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null)
  const [outputDir, setOutputDirState] = useState('')

  const inputRef = useRef(input)
  inputRef.current = input

  // Read inside the debounced autosave writer, which must always see the record
  // as it is when the timer fires rather than when the callback was created.
  const activeVideoIdRef = useRef<string | null>(null)
  const revRef = useRef<number | null>(null)
  const fallbackToldRef = useRef(false)

  const adoptRecord = useCallback((id: string | null, rev: number | null) => {
    activeVideoIdRef.current = id
    revRef.current = rev
    setActiveVideoId(id)
  }, [])

  // ── The output folder ───────────────────────────────────────────
  // Seeded once from app-state; persisted on every change so the next launch
  // (and the next video) exports to the same place.
  useEffect(() => {
    let cancelled = false
    window.subforge
      .getState<string>(LAST_OUTPUT_DIR_KEY, '')
      .then((dir) => {
        if (!cancelled && dir) setOutputDirState(dir)
      })
      .catch((err) => inputRef.current.notify(`Could not read the last output folder: ${reasonOf(err)}`))
    return () => {
      cancelled = true
    }
  }, [])

  const setOutputDir = useCallback((dir: string) => {
    setOutputDirState(dir)
    window.subforge
      .setState(LAST_OUTPUT_DIR_KEY, dir)
      .catch((err) => inputRef.current.notify(`Could not remember the output folder: ${reasonOf(err)}`))
  }, [])

  // ── The record ──────────────────────────────────────────────────
  const ensureRecordFor = useCallback(
    async (path: string): Promise<string | null> => {
      const source = path.trim()
      if (!source) return null
      try {
        const record = await api.createLibraryRecord(source)
        adoptRecord(record.id, record.rev)
        return record.id
      } catch (err) {
        // Not fatal: the session runs either way, it just autosaves locally.
        inputRef.current.notify(recordCreateFailedMessage(reasonOf(err)))
        return null
      }
    },
    [adoptRecord]
  )

  const clearActive = useCallback(() => adoptRecord(null, null), [adoptRecord])

  const openVideo = useCallback(
    async (videoId: string): Promise<string> => {
      const { screen, restoreFromProjectFile } = inputRef.current
      const message = await openVideoFromLibrary({
        videoId,
        screen,
        getProject: (id) => api.getLibraryProject(id),
        restore: restoreFromProjectFile,
      })
      // Only a completed open is published: the mirror's `activeVideoId` is what
      // the MCP tool confirms against, so it must never run ahead of the store.
      // The revision is unknown until the next PUT answers with it.
      adoptRecord(videoId.trim(), null)
      return message
    },
    [adoptRecord]
  )

  const applyEchoedCommand = useCallback(
    (cmd: AgentCommand): Promise<string> =>
      applyEchoedCommandWith({
        cmd,
        applyTrackCommand: inputRef.current.applyTrackCommand,
        openVideo,
      }),
    [openVideo]
  )

  const openRecord = useCallback(
    async (video: LibraryVideo): Promise<void> => {
      if (openRecordPlan(video) === 'choose-file') {
        inputRef.current.onChooseFile(video.sourcePath)
        return
      }
      try {
        await openVideo(video.id)
      } catch (err) {
        inputRef.current.notify(recordOpenFailedMessage(reasonOf(err)))
      }
    },
    [openVideo]
  )

  // ── The autosave writer ─────────────────────────────────────────
  const writeSnapshot = useCallback(async (snapshot: unknown): Promise<void> => {
    const recordId = activeVideoIdRef.current
    if (!recordId || planSnapshotWrite({ activeVideoId: recordId, rev: revRef.current }) === 'local') {
      await window.subforge.autosaveWrite(snapshot)
      return
    }
    try {
      const { rev } = await api.putLibraryProject(recordId, snapshot)
      revRef.current = rev
    } catch {
      // The record is the primary owner of durable state and it just refused,
      // so the local file becomes the fallback — stamped with the record it
      // belongs to. Best-effort by design: this IS the last line of defence, and
      // its own rejection reaches useAutosave's .catch. The user is told once.
      if (!fallbackToldRef.current) {
        fallbackToldRef.current = true
        inputRef.current.notify(LIBRARY_FALLBACK_MESSAGE)
      }
      await window.subforge.autosaveWrite(withFallbackStamp(snapshot, recordId, revRef.current))
    }
  }, [])

  return {
    activeVideoId,
    ensureRecordFor,
    clearActive,
    applyEchoedCommand,
    openRecord,
    outputDir,
    setOutputDir,
    writeSnapshot,
  }
}
