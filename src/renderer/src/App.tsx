import { useCallback, useMemo, useRef, useState } from 'react'
import type { Screen, TranscriptionResult } from './types/app'
import type { ProjectFile, ProjectIOHandle } from './lib/project'
import { projectFileFromTracks } from './lib/project'
import {
  backendUpdateFailedMessage,
  planProjectRestore,
  restoreErrorMessage,
} from './lib/projectRestore'
import type { ProjectRestorePlan } from './lib/projectRestore'
import { api } from './lib/api'
import { SOURCE_TRACK_ID } from './lib/tracks'
import type { TrackEditorState } from './lib/tracks'
import { IDLE_AGENT_ECHO, nameSuffixFor, renderEditedFlag } from './lib/uiStateMirror'
import type { AgentCommandEcho } from './lib/uiStateMirror'
import { TitleBar } from './components/TitleBar/TitleBar'
import { TrackTabs } from './components/tracks/TrackTabs'
import { DropZoneScreen } from './components/screens/DropZoneScreen'
import { LibraryHome } from './components/library/LibraryHome'
import { RecoveryBanner } from './components/screens/RecoveryBanner'
import { ProgressScreen } from './components/screens/ProgressScreen'
import { ResultsScreen } from './components/screens/ResultsScreen'
import { SettingsDialog } from './components/settings/SettingsDialog'
import { ShortcutOverlay } from './components/ShortcutOverlay'
import { StartupPrompts } from './components/onboarding/StartupPrompts'
import type { StudioSettings } from './components/studio/StudioPanel'
import { PublishAside } from './components/publish/PublishAside'
import { AgentLiveSync } from './components/AgentLiveSync'
import { ToastProvider } from './hooks/useToast'
import { ToastRelay } from './components/ui/ToastRelay'
import { useSettingsUndo } from './hooks/useSettingsUndo'
import { useAutosave } from './hooks/useAutosave'
import { useSourceVideoInfo } from './hooks/useSourceVideoInfo'
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts'
import { useCrashRecovery } from './hooks/useCrashRecovery'
import { useAgentBridge } from './hooks/useAgentBridge'
import { useLibrarySession } from './hooks/useLibrarySession'
import { useImportChannels, type EnsureRecord } from './hooks/useImportChannels'
import { useScreenNavigation } from './hooks/useScreenNavigation'
import { usePublishRecord } from './hooks/usePublishRecord'
import { PublishRecordProvider } from './hooks/usePublishRecordContext'
import { useSourceTimingLink } from './hooks/useSourceTimingLink'
import { usePublishWorkspace } from './hooks/usePublishWorkspace'
import { useTourNavigator } from './hooks/useTourNavigator'
import { useUiStateMirror } from './hooks/useUiStateMirror'
import { useUserPresets } from './hooks/useUserPresets'
import {
  emptySourceTrack,
  projectMetaFor,
  sourceTrackFromResult,
  useTrackStore,
} from './hooks/useTrackStore'
import { useTrackActions } from './hooks/useTrackActions'

export function App() {
  const [screen, setScreen] = useState<Screen>('library')
  const [filePath, setFilePath] = useState<string | null>(null)
  // Project metadata only — language, duration, audio path, the alignment flag.
  // The transcript itself is the source track's `segments` (see useTrackStore).
  const [result, setResult] = useState<TranscriptionResult | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsTo = (open: boolean) => () => setSettingsOpen(open)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const toggleShortcuts = useCallback(() => setShortcutsOpen((o) => !o), [])
  // App sits above ToastProvider, so failures raised here are relayed into the
  // toast system by <ToastRelay> below rather than reported directly.
  const [restoreWarning, setRestoreWarning] = useState<string | null>(null)

  const projectIORef = useRef<ProjectIOHandle | null>(null)
  // The library session is created further down (it needs `restoreFromProjectFile`),
  // so the handlers declared above it reach it through this ref.
  const ensureRecordRef = useRef<EnsureRecord | null>(null)

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

  // ── Source video info probe ─────────────────────────────────────
  // Runs once per result.audioPath — auto-sets resolution + fps on every track.
  const { sourceVideoInfo, resetSourceVideoInfo } = useSourceVideoInfo(
    result?.audioPath,
    updateAllTracks
  )

  // ── File handling ───────────────────────────────────────────────
  function handleFileSelected(path: string) {
    setFilePath(path || null)
  }

  /** A file dropped on the library, or a card with no session yet: pick it up on
   *  the drop screen so the user can review it and start the transcription. */
  function handleOpenFromLibrary(path: string) {
    handleFileSelected(path)
    setScreen('file')
  }

  // Create-on-drop, after asking which channels the video publishes to.
  const importChannels = useImportChannels({
    ensureRecordRef,
    onStarted: () => setScreen('progress'),
  })

  function handleTranscribeDone(data: TranscriptionResult) {
    setResult(data)
    // A new transcript replaces the whole store: any translated track was
    // written against the *previous* video's words and means nothing now. The
    // style carries over (only New / load_video reset it).
    replaceTracks([sourceTrackFromResult(data, sourceTrack)], SOURCE_TRACK_ID)
    setResultsSessionId((n) => n + 1)
    setScreen('results')
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
      resetSourceVideoInfo()
      setFilePath(path)
      setScreen('progress')
      // Fire-and-forget: the agent's contract is a synchronous refusal string,
      // and a record that fails to mint only costs the fallback autosave.
      void ensureRecordRef.current?.(path)
      return null
    },
    [screen, replaceTracks, resetSourceVideoInfo]
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
    setResult((prev) =>
      !prev || prev.alignmentDegraded ? prev : { ...prev, alignmentDegraded: true }
    )
  }, [])

  // ── Agent live-sync ─────────────────────────────────────────────
  // The five handlers AgentLiveSync calls live in `hooks/useAgentBridge.ts`;
  // App only supplies the store, the mounted editor and the undoable setter.
  const agent = useAgentBridge({
    tracks,
    activeTrackId,
    sourceTrack,
    updateTrack,
    commitTracks,
    bumpRevision,
    projectIORef,
    markAlignmentDegraded,
    applyActiveSettings: handleSettingsChange,
    setTrackSettings,
  })

  // ── Source-track timing link ────────────────────────────────────
  // Linked translated groups follow the source's spans (D4; `hooks/useSourceTimingLink.ts`).
  useSourceTimingLink({
    tracks,
    activeTrackId,
    sourceTrack,
    widToSegment,
    commitTracks,
    bumpRevision,
  })

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
    async (raw: unknown): Promise<boolean> => {
      // The trust boundary + every derivation live in `lib/projectRestore.ts`,
      // so a file opened from anywhere else installs an identical store. A file
      // from a newer build (or a damaged one) throws before anything is
      // touched, leaving the session exactly as it was, with a real message.
      let plan: ProjectRestorePlan
      try {
        plan = planProjectRestore(raw)
      } catch (err) {
        setRestoreWarning(restoreErrorMessage(err))
        return false
      }

      // Push transcription to backend so render/export work.
      await api.updateResult(plan.backendResult).catch((err) => {
        // Never swallow this. Without the transcript the backend cannot
        // render or export, and every later failure looks unrelated.
        setRestoreWarning(backendUpdateFailedMessage(err))
      })

      setFilePath(plan.file.selectedFilePath)
      // Opening a project adopts (or mints) its record, so editing it from here
      // autosaves into the library like any other session.
      if (plan.file.selectedFilePath) await ensureRecordRef.current?.(plan.file.selectedFilePath)
      setResult(plan.file.transcriptionResult)
      // The plan has already merged each track's settings over the defaults (an
      // older file has no value for fields added since, and buildRenderBody
      // divides some of them → NaN → JSON null → a 422) and sanitized them (a
      // value that IS present but out of the backend's range).
      replaceTracks(plan.tracks, plan.activeTrackId)
      setResultsSessionId((n) => n + 1)
      setScreen('results')
      return true
    },
    [replaceTracks]
  )

  // ── Library session + UI-state mirror ───────────────────────────
  // The record this session belongs to (`activeVideoId`), the autosave writer
  // that keeps it primary, the export folder, and `open_video` — which installs
  // a stored record through the very same plan an Open takes.
  const session = useLibrarySession({
    screen,
    restoreFromProjectFile,
    applyTrackCommand: agent.applyTrackCommand,
    onChooseFile: handleOpenFromLibrary,
    notify: setRestoreWarning,
  })
  // The session needs `restoreFromProjectFile` and the handlers above need its
  // `ensureRecordFor`; a ref breaks the cycle without reordering.
  ensureRecordRef.current = session.ensureRecordFor

  // ── The Publish workspace ───────────────────────────────────────
  // `workspace` is an axis over the open record, not a fifth screen: both
  // asides stay mounted and the player is shared (vision §4).
  const publishWorkspace = usePublishWorkspace({ activeVideoId: session.activeVideoId })
  useTourNavigator({ setWorkspace: publishWorkspace.setWorkspace })
  const publish = usePublishRecord({
    videoId: session.activeVideoId,
    segments: sourceTrack.segments,
    duration: result?.duration ?? null,
    notify: setRestoreWarning,
  })

  useUiStateMirror({
    screen,
    workspace: publishWorkspace.workspace,
    activeChannelId: publishWorkspace.activeChannelId,
    result,
    activeTrack,
    displayGroups,
    userPresetNames,
    activeVideoId: session.activeVideoId,
    agentEcho,
    tracks,
    sourceTrack,
    classifications,
  })

  // ── Crash recovery ──────────────────────────────────────────────
  // An autosave snapshot left on disk by a session that didn't end via an
  // explicit Save or New (i.e. a crash or accidental close); restored through
  // the same path a library record's project restore takes.
  const {
    snapshot: recoverySnapshot,
    recover: handleRecover,
    discard: handleDiscardRecovery,
  } = useCrashRecovery(restoreFromProjectFile)

  // ── Autosave ────────────────────────────────────────────────────
  // Snapshot the live session ~2s after any edit; the writer stores it in the
  // active library record and only falls back to `autosave.json` when that
  // fails (docs/plans/library-home-screen.md §9.1).
  const autosave = useAutosave(
    projectFile,
    [screen, tracks, activeTrackId, result],
    session.writeSnapshot
  )

  // New (ends the session) and Library (flushes, then goes home keeping it).
  const nav = useScreenNavigation({
    screen,
    setScreen,
    setFilePath,
    setResult,
    replaceTracks,
    resetSourceVideoInfo,
    clearActive: session.clearActive,
    flushAutosave: autosave.flush,
    notify: setRestoreWarning,
  })

  // ── Global keyboard shortcuts ───────────────────────────────────
  useGlobalShortcuts({
    onSave: handleSave,
    onUndo: settingsUndo.undo,
    onRedo: settingsUndo.redo,
    onToggleShortcutOverlay: toggleShortcuts,
  })

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
          onLibrary={nav.goToLibrary}
          onNew={nav.handleNew}
          onSave={handleSave}
          onSettingsToggle={() => setSettingsOpen((o) => !o)}
          onUndo={subtitleUndo?.undo}
          onRedo={subtitleUndo?.redo}
          canUndo={subtitleUndo?.canUndo ?? false}
          canRedo={subtitleUndo?.canRedo ?? false}
          autosavedLabel={
            autosave.lastSavedAt
              ? `Saved ${new Date(autosave.lastSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
              : undefined
          }
        />

        <RecoveryBanner
          snapshot={recoverySnapshot}
          onRestore={handleRecover}
          onDiscard={handleDiscardRecovery}
        />

        <main className="flex-1 flex min-h-0 overflow-hidden">
          {/* ── Main content (left column) ────────────────────────── */}
          {screen === 'library' && (
            <LibraryHome
              onOpen={session.openRecord}
              openingVideoId={session.openingVideoId}
              onAddVideo={() => setScreen('file')}
              onFileDropped={handleOpenFromLibrary}
              notify={setRestoreWarning}
            />
          )}
          {screen === 'file' && (
            <div className="screen-in flex-1 flex flex-col items-center justify-center overflow-hidden min-w-0">
              <DropZoneScreen
                filePath={filePath}
                onFileSelected={handleFileSelected}
                onStart={() => void importChannels.start(filePath)}
              />
            </div>
          )}
          {screen === 'progress' && (
            <div className="screen-in flex-1 flex flex-col items-center justify-center overflow-hidden min-w-0">
              <ProgressScreen
                filePath={filePath!}
                onDone={handleTranscribeDone}
                onCancel={nav.handleNew}
              />
            </div>
          )}
          {screen === 'results' && activeResult && (
            <div className="screen-in flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
              {/* The tab strip lives HERE, above the editor and outside it:
                  ResultsScreen is remounted on every tab switch, so a strip
                  inside it would unmount itself mid-click. The workspace
                  toggle used to ride this row; it now heads the aside it
                  switches (docs/plans/ux-ui-refresh.md §4). */}
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
                    first, because raw editor state is published continuously.
                    The provider hands the record's chapters to the Transcript tab. */}
                <PublishRecordProvider publish={publish}>
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
                    seekTo={publishWorkspace.pendingSeek}
                    onTimeUpdate={publishWorkspace.handleTimeUpdate}
                  />
                </PublishRecordProvider>
              </div>
            </div>
          )}

          {/* ── The right-hand column ────────────────────────────
              Both asides stay mounted: hidden on the library screen (§4) so
              the studio's render state survives a trip home, and hidden by
              workspace so switching costs nothing. */}
          <PublishAside
            publishWorkspace={publishWorkspace}
            hidden={screen === 'library'}
            publish={publish}
            segments={sourceTrack.segments}
            tracks={tracks}
            outputDir={session.outputDir}
            studio={{
              settings,
              onChange: handleSettingsChange,
              groups: displayGroups,
              groupsEdited: renderEditedFlag(activeTrack),
              nameSuffix: nameSuffixFor(activeTrack),
              exportTrack: activeTrack.isSource
                ? null
                : { id: activeTrack.id, lang: activeTrack.lang, segments: displayGroups },
              audioPath: result?.audioPath ?? filePath ?? '',
              sourceVideoInfo,
              userPresets,
              onPresetsChanged: refreshUserPresets,
              onPresetApplied: handlePresetApplied,
              activeTrackIsSource: activeTrack.isSource,
              outputDir: session.outputDir,
              onOutputDirChange: session.setOutputDir,
            }}
          />
        </main>

        <SettingsDialog open={settingsOpen} onClose={settingsTo(false)} onOpen={settingsTo(true)} />
        <ShortcutOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
        <StartupPrompts screen={screen} />
        {importChannels.sheet}
        <AgentLiveSync
          resultsActive={screen === 'results'}
          settingsForTrack={agent.settingsForTrack}
          userPresets={userPresets}
          applyResult={agent.applyResult}
          applySettings={agent.applySettings}
          applyWordOverrides={agent.applyWordOverrides}
          onPresetApplied={handlePresetApplied}
          loadVideo={handleLoadVideo}
          applyEchoedCommand={session.applyEchoedCommand}
          onAgentCommandEcho={setAgentEcho}
        />
      </div>
    </ToastProvider>
  )
}
