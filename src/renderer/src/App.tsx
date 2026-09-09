import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Screen, TranscriptionResult } from './types/app'
import type { ProjectFile, ProjectIOHandle, WordOverrideEdit } from './lib/project'
import { migrateProjectFile, projectFileFromTracks, tracksFromProjectFile } from './lib/project'
import { api, type AgentCommand, type VideoInfo } from './lib/api'
import { builtinPresetNames } from './lib/agentCommands'
import { ensureWordIds } from './lib/wordIds'
import { SOURCE_TRACK_ID, syncSegmentsIntoTrack, withSentenceSegments } from './lib/tracks'
import type { TrackEditorState, TrackMirrorEntry } from './lib/tracks'
import { applyTrackCommand } from './lib/trackCommands'
import { propagateSourceTiming } from './lib/trackTiming'
import {
  IDLE_AGENT_ECHO,
  buildTrackEntries,
  buildUiStateBody,
  buildUiStateCore,
  mergeUiStateBody,
  nameSuffixFor,
  renderEditedFlag,
} from './lib/uiStateMirror'
import type { AgentCommandEcho, UiStateCore } from './lib/uiStateMirror'
import { TitleBar } from './components/TitleBar/TitleBar'
import { TrackTabs } from './components/tracks/TrackTabs'
import { DropZoneScreen } from './components/screens/DropZoneScreen'
import { ProgressScreen } from './components/screens/ProgressScreen'
import { ResultsScreen } from './components/screens/ResultsScreen'
import { SettingsPanel } from './components/SettingsPanel'
import { ShortcutOverlay } from './components/ShortcutOverlay'
import { StudioPanel, snapFps } from './components/studio/StudioPanel'
import type { StudioSettings } from './components/studio/StudioPanel'
import { Button } from './components/ui/Button'
import { AgentLiveSync } from './components/AgentLiveSync'
import { ToastProvider } from './hooks/useToast'
import { ToastRelay } from './components/ui/ToastRelay'
import { useSettingsUndo } from './hooks/useSettingsUndo'
import { useAutosave } from './hooks/useAutosave'
import { useUserPresets } from './hooks/useUserPresets'
import {
  emptySourceTrack,
  projectMetaFor,
  sourceTrackFromResult,
  useTrackStore,
} from './hooks/useTrackStore'
import { useTrackActions } from './hooks/useTrackActions'

export function App() {
  const [screen, setScreen] = useState<Screen>('file')
  const [filePath, setFilePath] = useState<string | null>(null)
  // Project metadata only — language, duration, audio path, the alignment flag.
  // The transcript itself is the source track's `segments` (see useTrackStore).
  const [result, setResult] = useState<TranscriptionResult | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  // App sits above ToastProvider, so failures raised here are relayed into the
  // toast system by <ToastRelay> below rather than reported directly.
  const [restoreWarning, setRestoreWarning] = useState<string | null>(null)

  const [sourceVideoInfo, setSourceVideoInfo] = useState<VideoInfo | null>(null)

  const projectIORef = useRef<ProjectIOHandle | null>(null)

  // ── The caption-track store ─────────────────────────────────────
  // Everything the editor, the sidebar, the render path and the agent mirror
  // read is derived from here — there is no second copy of a track's settings
  // or groups anywhere.
  const {
    tracks,
    activeTrackId,
    activeTrack,
    sourceTrack,
    classifications,
    widToSegment,
    displayGroups,
    revisions,
    setActiveTrackId,
    replaceTracks,
    commitTracks,
    updateTrack,
    updateAllTracks,
    commitEditorState,
    bumpRevision,
  } = useTrackStore()

  const settings = activeTrack.settings

  // The tab strip's four actions (add / close / re-flow / describe). Writes go
  // through `lib/trackCommands.ts`, the same pure transition the agent's
  // commands take, so the UI and the agent share one implementation.
  const trackActions = useTrackActions({
    tracks,
    activeTrackId,
    activeTrack,
    sourceTrack,
    classifications,
    commitTracks,
    bumpRevision,
  })

  // Crash recovery — an autosave snapshot left on disk by a session that didn't
  // end via an explicit Save or New (i.e. a crash or accidental close).
  const [recoverySnapshot, setRecoverySnapshot] = useState<
    (ProjectFile & { savedAt?: number }) | null
  >(null)

  const [subtitleUndo, setSubtitleUndo] = useState<{
    undo: () => void
    redo: () => void
    canUndo: boolean
    canRedo: boolean
  } | null>(null)

  // Identity of the loaded transcription/project — bumped whenever a new result
  // replaces the current one. Used (with the active track id and that track's
  // revision) as ResultsScreen's `key` so it remounts with fresh editor state
  // (segments, groups, undo stack, edit flags) instead of keeping the previous
  // video's when a project is opened over an existing one.
  const [resultsSessionId, setResultsSessionId] = useState(0)

  // User preset library, owned here so the UI-state mirror can publish the
  // names to the MCP agent and `apply_preset` can resolve against them.
  const { userPresets, refresh: refreshUserPresets } = useUserPresets()
  const userPresetNames = useMemo(() => userPresets.map((p) => p.name), [userPresets])

  // The last agent write command, echoed into the mirror so the tool that sent
  // it can confirm by polling (the `apply_preset` pattern).
  const [agentEcho, setAgentEcho] = useState<AgentCommandEcho>(IDLE_AGENT_ECHO)

  // ── Settings, per track ─────────────────────────────────────────
  const setTrackSettings = useCallback(
    (trackId: string, next: StudioSettings) => {
      updateTrack(trackId, (track) => ({ ...track, settings: next }))
    },
    [updateTrack]
  )

  const applyActiveSettings = useCallback(
    (next: StudioSettings) => setTrackSettings(activeTrackId, next),
    [setTrackSettings, activeTrackId]
  )

  // Settings undo — wraps the active track's setter so every UI change is
  // undoable, with a separate history per track (Cmd+Z never reaches another tab).
  const settingsUndo = useSettingsUndo(settings, applyActiveSettings, activeTrackId)
  const handleSettingsChange = useCallback(
    (next: StudioSettings) => {
      settingsUndo.push(settings)
      applyActiveSettings(next)
    },
    [settings, settingsUndo, applyActiveSettings]
  )

  /**
   * Canonical name of the preset a track's style is based on. STICKY: survives
   * later set_settings patches and manual edits, and only changes when another
   * preset is applied or the session resets. The MCP `apply_preset` tool polls
   * the mirror for this to confirm the apply landed before rendering.
   */
  const handlePresetApplied = useCallback(
    (name: string, trackId?: string) => {
      updateTrack(trackId ?? activeTrackId, (track) => ({ ...track, appliedPreset: name }))
    },
    [updateTrack, activeTrackId]
  )

  // ── File handling ───────────────────────────────────────────────
  function handleFileSelected(path: string) {
    setFilePath(path || null)
  }

  function handleStart() {
    if (filePath) setScreen('progress')
  }

  function handleTranscribeDone(data: TranscriptionResult) {
    setResult(data)
    // A new transcript replaces the whole store: any translated track was
    // written against the *previous* video's words and means nothing now. The
    // style carries over (only New / load_video reset it).
    replaceTracks([sourceTrackFromResult(data, sourceTrack)], SOURCE_TRACK_ID)
    setResultsSessionId((n) => n + 1)
    setScreen('results')
  }

  function handleNew() {
    setFilePath(null)
    setResult(null)
    setScreen('file')
    replaceTracks([emptySourceTrack()], SOURCE_TRACK_ID)
    setSourceVideoInfo(null)
    window.subforge.autosaveClear()
  }

  /**
   * Agent-driven import (op: `load_video`) — the entry point of a batch run.
   *
   * Returns null on success, or a human-readable reason on refusal.
   *
   * Replacing an already-loaded project resets the same state `handleNew` does.
   * That reset is the batch-safety requirement: without it video 2 inherits
   * video 1's groups, groupsEdited, resolution, per-group position overrides and
   * every translated track, and every later output is silently wrong.
   *
   * Only filePath + screen are set; ProgressScreen self-starts the transcription
   * from filePath and its onDone → handleTranscribeDone completes the transition.
   */
  const handleLoadVideo = useCallback(
    (path: string): string | null => {
      if (!path) return 'Agent sent load_video with no path.'
      if (screen === 'progress') {
        return 'Agent tried to load a video while a job is already running.'
      }
      setResult(null)
      replaceTracks([emptySourceTrack()], SOURCE_TRACK_ID)
      setSourceVideoInfo(null)
      setFilePath(path)
      setScreen('progress')
      return null
    },
    [screen, replaceTracks]
  )

  // ── Editor state published from ResultsScreen ───────────────────
  // Identity changes only when the active track does — which is precisely when
  // ResultsScreen remounts anyway, so its publish effect never re-runs for a
  // callback change alone. (A ref would be wrong here: child effects run before
  // the parent's, so on a tab switch the freshly mounted editor would publish
  // into the *previous* track's slot.)
  const handleTrackStateChange = useCallback(
    (state: TrackEditorState) => commitEditorState(activeTrackId, state),
    [commitEditorState, activeTrackId]
  )

  // Approximate word timings are a property of the transcript, so the flag has
  // to live with the project metadata and survive a save.
  const markAlignmentDegraded = useCallback(() => {
    setResult((prev) => (!prev || prev.alignmentDegraded ? prev : { ...prev, alignmentDegraded: true }))
  }, [])

  // ── Agent live-sync ─────────────────────────────────────────────
  /**
   * An agent transcript edit always targets the **source** track, whichever tab
   * happens to be open: `update_words` and `remove_filler_words` edit the
   * transcript, and applying them to whatever editor is mounted would rewrite a
   * translation with English words. When the source is the active tab the edit
   * goes through the mounted editor (which pushes an undo entry the user can
   * revert); otherwise it is reconciled straight into the stored track.
   */
  const handleApplyAgentResult = useCallback(
    (r: TranscriptionResult) => {
      if (activeTrackId === sourceTrack.id) {
        // The editor reports the alignment flag back through onAlignmentDegraded.
        projectIORef.current?.applyAgentResult(r)
        return
      }
      updateTrack(sourceTrack.id, (track) => ({
        ...syncSegmentsIntoTrack(
          track,
          ensureWordIds(r.segments),
          track.settings.wordsPerGroup,
          false
        ),
        segmentsEdited: true,
      }))
      if (r.alignmentDegraded) markAlignmentDegraded()
    },
    [activeTrackId, sourceTrack.id, updateTrack, markAlignmentDegraded]
  )

  const handleApplyWordOverrides = useCallback((edits: WordOverrideEdit[]) => {
    projectIORef.current?.applyWordOverrides(edits)
  }, [])

  /** The style command's target: the named track, or the active one. */
  const settingsForTrack = useCallback(
    (trackId?: string): StudioSettings | null => {
      const id = trackId || activeTrackId
      return tracks.find((t) => t.id === id)?.settings ?? null
    },
    [tracks, activeTrackId]
  )

  const handleAgentSettings = useCallback(
    (next: StudioSettings, trackId?: string) => {
      const id = trackId || activeTrackId
      // Only the active track's change is undoable — the undo stack belongs to
      // the tab the user is looking at.
      if (id === activeTrackId) handleSettingsChange(next)
      else setTrackSettings(id, next)
    },
    [activeTrackId, handleSettingsChange, setTrackSettings]
  )

  /**
   * `create_track` / `set_track_text` / `reflow_track`. Every rule lives in
   * `lib/trackCommands.ts`; failures throw and AgentLiveSync echoes the message
   * back to the agent instead of swallowing it.
   */
  const handleAgentTrackCommand = useCallback(
    (cmd: AgentCommand): string => {
      const next = applyTrackCommand(tracks, activeTrackId, cmd)
      commitTracks(next.tracks, next.activeTrackId)
      // The editor owns its own copy of the track it is mounted on, so a write
      // that lands underneath it only becomes visible on a remount.
      if (next.remountTrackId) bumpRevision(next.remountTrackId)
      return next.message
    },
    [tracks, activeTrackId, commitTracks, bumpRevision]
  )

  // ── UI-state mirror ─────────────────────────────────────────────
  // Mirror UI state to the backend so the agent can read what to change AND so
  // /api/render-frame renders with the live style. `render` is the snake_case
  // body (the casing bridge lives only in buildRenderBody). Debounced — settings
  // churn during edits.
  // Mirrors on EVERY screen (not just results) so the agent can see where the
  // app is and which presets exist before a video is loaded — `list_presets`
  // and `load_video` both have to work from the drop screen.
  //
  // Written in two halves, because they change at wildly different rates: the
  // legacy keys churn on every keystroke, while the per-track inventory (a
  // render body + a classification per track) only moves when a track does.
  // Each half writes into this ref and the pusher sends the merge, so neither
  // can blank the other.
  const mirrorRef = useRef<{ core: UiStateCore | null; tracks: TrackMirrorEntry[] }>({
    core: null,
    tracks: [],
  })
  // One shared trailing debounce, so a change that moves both halves still costs
  // a single PUT.
  const mirrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleMirror = useCallback(() => {
    if (mirrorTimerRef.current) clearTimeout(mirrorTimerRef.current)
    mirrorTimerRef.current = setTimeout(() => {
      mirrorTimerRef.current = null
      const { core, tracks: entries } = mirrorRef.current
      if (!core) return
      api.putUiState(mergeUiStateBody(core, entries)).catch(() => {
        /* best-effort mirror */
      })
    }, 300)
  }, [])

  useEffect(
    () => () => {
      if (mirrorTimerRef.current) clearTimeout(mirrorTimerRef.current)
    },
    []
  )

  useEffect(() => {
    mirrorRef.current = {
      ...mirrorRef.current,
      core: buildUiStateCore({
        screen,
        activeTrack,
        activeDisplayGroups: displayGroups,
        builtinPresets: builtinPresetNames(),
        userPresetNames,
        agent: agentEcho,
      }),
    }
    scheduleMirror()
  }, [screen, activeTrack, displayGroups, userPresetNames, agentEcho, scheduleMirror])

  useEffect(() => {
    mirrorRef.current = {
      ...mirrorRef.current,
      tracks: buildTrackEntries(tracks, sourceTrack, classifications),
    }
    scheduleMirror()
  }, [tracks, sourceTrack, classifications, scheduleMirror])

  // Resync-after-reconnect: give the API layer a snapshot of the live result +
  // UI state so that if the backend crashes/restarts, the control socket's reopen
  // handler can re-push what the backend lost (mirrors the two effects above).
  useEffect(() => {
    api.registerResync(() => {
      // No project open (drop/progress screen): re-push UI state only. The
      // `result` half is genuinely absent, not lost, so it must stay undefined.
      const liveResult = screen === 'results' ? result : null
      return {
        result: liveResult
          ? {
              segments: sourceTrack.segments,
              language: liveResult.language,
              duration: liveResult.duration,
              audio_path: liveResult.audioPath,
              alignment_degraded: Boolean(liveResult.alignmentDegraded),
            }
          : undefined,
        uiState: buildUiStateBody({
          screen,
          activeTrack,
          activeDisplayGroups: displayGroups,
          builtinPresets: builtinPresetNames(),
          userPresetNames,
          agent: agentEcho,
          tracks,
          sourceTrack,
          classifications,
        }),
      }
    })
    return () => api.registerResync(null)
  }, [
    screen,
    result,
    activeTrack,
    displayGroups,
    userPresetNames,
    agentEcho,
    tracks,
    sourceTrack,
    classifications,
  ])

  // ── Source-track timing link ────────────────────────────────────
  // Whenever the source's words or grouping move, every translated group that
  // is still linked to a source span moves with it (D4).
  //
  // `propagateSourceTiming` is reference-stable and returns a source track
  // untouched, so a single-track project does nothing at all here and this can
  // never re-trigger itself. A track that *did* move while its editor is up has
  // to be remounted, or the editor would keep publishing the pre-move groups
  // back over the relink — which can only happen from an agent edit to the
  // source while a translated tab is open.
  useEffect(() => {
    const moved: string[] = []
    const next = tracks.map((track) => {
      // Relinking moves group spans and re-lays their words, so the derived
      // text units move with them — `withSentenceSegments` is the one place
      // that is decided (`lib/tracks.ts`), and it is reference-stable, so a
      // track that did not move is still handed back untouched.
      const relinked = withSentenceSegments(propagateSourceTiming(track, sourceTrack), widToSegment)
      if (relinked !== track) moved.push(track.id)
      return relinked
    })
    if (moved.length === 0) return
    commitTracks(next, activeTrackId)
    for (const id of moved) bumpRevision(id)
    // Deliberately narrow: this reacts to the SOURCE moving, and reads the rest
    // of the store as it is at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceTrack.segments, sourceTrack.groups])

  // ── Source video info probe ─────────────────────────────────────
  // Runs once per result.audioPath — auto-sets resolution + fps.
  useEffect(() => {
    if (!result?.audioPath) return
    let cancelled = false
    api
      .getVideoInfo(result.audioPath)
      .then((info) => {
        if (cancelled) return
        setSourceVideoInfo(info)
        // Output geometry is a fact about the source media, not a per-track
        // style choice, so it lands on every track.
        updateAllTracks((track) => {
          const next = { ...track.settings }
          let changed = false
          if (info.width && info.height) {
            next.resolution = [info.width, info.height]
            next.resolutionIsSource = true
            changed = true
          }
          if (info.fps) {
            next.fps = snapFps(info.fps)
            changed = true
          }
          return changed ? { ...track, settings: next } : track
        })
      })
      .catch(() => {
        /* ignore — likely audio-only */
      })
    return () => {
      cancelled = true
    }
  }, [result?.audioPath, updateAllTracks])

  // ── Project save ────────────────────────────────────────────────
  const projectFile = useCallback((): ProjectFile | null => {
    if (screen !== 'results' || !result) return null
    return projectFileFromTracks(projectMetaFor(result), tracks, activeTrackId)
  }, [screen, result, tracks, activeTrackId])

  const handleSave = useCallback(async () => {
    const file = projectFile()
    if (!file) return
    const savedPath = await window.subforge.saveProject(file)
    // Explicit save is now the source of truth — drop the autosave snapshot so
    // it isn't offered as "unsaved" next launch. Later edits re-arm it.
    if (savedPath) await window.subforge.autosaveClear()
  }, [projectFile])

  const handleRestoreWarningShown = useCallback(() => setRestoreWarning(null), [])

  // ── Project restore (shared by Open and crash-recovery) ─────────
  const restoreFromProjectFile = useCallback(
    async (raw: unknown) => {
      // The trust boundary: validate and lift to the current version *before*
      // anything is touched, so a file from a newer build (or a damaged one)
      // leaves the session exactly as it was, with a real message.
      let file: ProjectFile
      try {
        file = migrateProjectFile(raw)
      } catch (err) {
        setRestoreWarning(
          err instanceof Error ? err.message : 'This project file could not be opened.'
        )
        return
      }

      const restored = tracksFromProjectFile(file)

      // Push transcription to backend so render/export work.
      const tr = file.transcriptionResult
      await api
        .updateResult({
          segments: tr.segments as never,
          language: tr.language,
          duration: tr.duration,
          audio_path: tr.audioPath,
          alignment_degraded: Boolean(tr.alignmentDegraded),
        })
        .catch((err) => {
          // Never swallow this. Without the transcript the backend cannot
          // render or export, and every later failure looks unrelated.
          setRestoreWarning(
            `Project loaded, but the backend could not be updated: ${
              err instanceof Error ? err.message : String(err)
            }. Rendering may fail.`
          )
        })

      setFilePath(file.selectedFilePath)
      setResult(file.transcriptionResult)
      // `tracksFromProjectFile` has already merged each track's settings over the
      // defaults (an older file has no value for fields added since, and
      // buildRenderBody divides some of them → NaN → JSON null → a 422) and
      // sanitized them (a value that IS present but out of the backend's range).
      replaceTracks(restored.tracks, restored.activeTrackId)
      setResultsSessionId((n) => n + 1)
      setScreen('results')
    },
    [replaceTracks]
  )

  // ── Project open ────────────────────────────────────────────────
  const handleOpen = useCallback(async () => {
    const raw = await window.subforge.openProject()
    if (!raw) return
    await restoreFromProjectFile(raw)
  }, [restoreFromProjectFile])

  // ── Crash recovery ──────────────────────────────────────────────
  // On launch, read any leftover autosave snapshot and offer to restore it.
  useEffect(() => {
    let cancelled = false
    window.subforge
      .autosaveRead()
      .then((snap) => {
        if (!cancelled && snap) setRecoverySnapshot(snap as ProjectFile & { savedAt?: number })
      })
      .catch(() => {
        /* ignore — recovery is best-effort */
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleRecover = useCallback(async () => {
    if (!recoverySnapshot) return
    await restoreFromProjectFile(recoverySnapshot)
    setRecoverySnapshot(null)
  }, [recoverySnapshot, restoreFromProjectFile])

  const handleDiscardRecovery = useCallback(async () => {
    await window.subforge.autosaveClear()
    setRecoverySnapshot(null)
  }, [])

  // ── Autosave (crash recovery) ───────────────────────────────────
  // Snapshot the live session ~2s after any edit; cleared on Save / New.
  const lastSavedAt = useAutosave(projectFile, [screen, tracks, activeTrackId, result])

  // ── Global keyboard shortcuts ───────────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey
      const tag = (e.target as HTMLElement).tagName
      const editable =
        tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable
      if (editable && !mod) return

      if (mod && e.key === 's') {
        e.preventDefault()
        handleSave()
      } else if (mod && e.key === 'o') {
        e.preventDefault()
        handleOpen()
      } else if (mod && e.key === 'z' && !editable) {
        e.preventDefault()
        if (e.shiftKey) settingsUndo.redo()
        else settingsUndo.undo()
      } else if (e.key === '?' && !mod) {
        // The editable guard above already swallowed `?` typed into inputs/
        // textareas/contentEditables (editable && !mod returns early).
        e.preventDefault()
        setShortcutsOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleSave, handleOpen, settingsUndo])

  // The transcript the active tab edits: project metadata with that track's own
  // segments (the source track's are the transcript; a translated track's are
  // its text-view units).
  const activeResult = useMemo(
    () => (result ? { ...result, segments: activeTrack.segments } : null),
    [result, activeTrack.segments]
  )

  return (
    <ToastProvider>
      <ToastRelay message={restoreWarning} onShown={handleRestoreWarningShown} />
      {/* App renders ToastProvider, so it sits above the context and cannot
          call useToast itself — the track actions report through a relay. */}
      <ToastRelay
        message={trackActions.notice?.message ?? null}
        type={trackActions.notice?.type ?? 'info'}
        onShown={trackActions.clearNotice}
      />
      <div className="flex flex-col h-full" style={{ background: 'var(--color-bg)' }}>
        <TitleBar
          screen={screen}
          onNew={handleNew}
          onSave={handleSave}
          onOpen={handleOpen}
          onSettingsToggle={() => setSettingsOpen((o) => !o)}
          onUndo={subtitleUndo?.undo}
          onRedo={subtitleUndo?.redo}
          canUndo={subtitleUndo?.canUndo ?? false}
          canRedo={subtitleUndo?.canRedo ?? false}
          autosavedLabel={
            lastSavedAt
              ? `Saved ${new Date(lastSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
              : undefined
          }
        />

        {recoverySnapshot && (
          <div
            className="app-no-drag flex items-center gap-3 px-4 py-2 text-xs border-b border-[var(--color-border)]"
            style={{ background: 'var(--color-surface-2)' }}
          >
            <span style={{ color: 'var(--color-text-2)' }}>
              Unsaved session recovered
              {recoverySnapshot.savedAt
                ? ` from ${new Date(recoverySnapshot.savedAt).toLocaleString()}`
                : ''}
              .
            </span>
            <Button variant="titlebar" onClick={handleRecover}>
              Restore
            </Button>
            <Button
              variant="titlebar"
              style={{ color: 'var(--color-text-3)' }}
              onClick={handleDiscardRecovery}
            >
              Discard
            </Button>
          </div>
        )}

        <main className="flex-1 flex min-h-0 overflow-hidden">
          {/* ── Main content (left column) ────────────────────────── */}
          {screen === 'file' && (
            <div className="screen-in flex-1 flex flex-col items-center justify-center overflow-hidden min-w-0">
              <DropZoneScreen
                filePath={filePath}
                onFileSelected={handleFileSelected}
                onStart={handleStart}
              />
            </div>
          )}
          {screen === 'progress' && (
            <div className="screen-in flex-1 flex flex-col items-center justify-center overflow-hidden min-w-0">
              <ProgressScreen
                filePath={filePath!}
                onDone={handleTranscribeDone}
                onCancel={handleNew}
              />
            </div>
          )}
          {screen === 'results' && activeResult && (
            <div className="screen-in flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
              {/* The tab strip lives HERE, above the editor and outside it:
                  ResultsScreen is remounted on every tab switch, so a strip
                  inside it would unmount itself mid-click. */}
              <TrackTabs
                tracks={trackActions.tabs}
                activeTrackId={activeTrackId}
                onSelect={setActiveTrackId}
                onAdd={trackActions.addTrack}
                onClose={trackActions.closeTrack}
              />
              <div className="flex-1 flex min-h-0 min-w-0 overflow-hidden">
                {/* Keyed by session + track + that track's revision: switching tab
                    (or a write that landed underneath the editor) remounts it with
                    fresh state from the store. Nothing has to be checkpointed
                    first, because raw editor state is published continuously. */}
                <ResultsScreen
                  key={`${resultsSessionId}:${activeTrackId}:${revisions[activeTrackId] ?? 0}`}
                  result={activeResult}
                  trackId={activeTrackId}
                  settings={settings}
                  autoGroup={activeTrack.isSource}
                  widToSegment={widToSegment}
                  initialGroups={activeTrack.groups.length > 0 ? activeTrack.groups : null}
                  initialGroupsEdited={activeTrack.groupsEdited}
                  initialSegmentsEdited={activeTrack.segmentsEdited}
                  groupStates={trackActions.activeClassification?.byGroup}
                  reflowNeeded={trackActions.activeClassification?.reflowNeeded ?? false}
                  staleCount={trackActions.activeClassification?.staleCount ?? 0}
                  onReflow={activeTrack.isSource ? undefined : trackActions.reflowActiveTrack}
                  onTrackStateChange={handleTrackStateChange}
                  onAlignmentDegraded={markAlignmentDegraded}
                  projectIORef={projectIORef}
                  onUndoRedoChange={setSubtitleUndo}
                />
              </div>
            </div>
          )}

          {/* ── Studio sidebar (always visible) ──────────────────── */}
          <StudioPanel
            settings={settings}
            onChange={handleSettingsChange}
            groups={displayGroups}
            groupsEdited={renderEditedFlag(activeTrack)}
            nameSuffix={nameSuffixFor(activeTrack)}
            exportTrack={
              activeTrack.isSource
                ? null
                : { id: activeTrack.id, lang: activeTrack.lang, segments: displayGroups }
            }
            audioPath={result?.audioPath ?? filePath ?? ''}
            sourceVideoInfo={sourceVideoInfo}
            userPresets={userPresets}
            onPresetsChanged={refreshUserPresets}
            onPresetApplied={handlePresetApplied}
            activeTrackIsSource={activeTrack.isSource}
          />
        </main>

        <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
        <ShortcutOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
        <AgentLiveSync
          resultsActive={screen === 'results'}
          settingsForTrack={settingsForTrack}
          userPresets={userPresets}
          applyResult={handleApplyAgentResult}
          applySettings={handleAgentSettings}
          applyWordOverrides={handleApplyWordOverrides}
          onPresetApplied={handlePresetApplied}
          loadVideo={handleLoadVideo}
          applyTrackCommand={handleAgentTrackCommand}
          onAgentCommandEcho={setAgentEcho}
        />
      </div>
    </ToastProvider>
  )
}
