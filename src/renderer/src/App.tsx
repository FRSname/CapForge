import { useCallback, useEffect, useRef, useState } from 'react'
import type { Screen, TranscriptionResult, Segment } from './types/app'
import type { ProjectFile, ProjectIOHandle } from './lib/project'
import { api, type VideoInfo } from './lib/api'
import { TitleBar } from './components/TitleBar/TitleBar'
import { DropZoneScreen } from './components/screens/DropZoneScreen'
import { ProgressScreen } from './components/screens/ProgressScreen'
import { ResultsScreen } from './components/screens/ResultsScreen'
import { SettingsPanel } from './components/SettingsPanel'
import { StudioPanel, STUDIO_DEFAULTS, snapFps } from './components/studio/StudioPanel'
import type { StudioSettings } from './components/studio/StudioPanel'
import { Button } from './components/ui/Button'
import { ToastProvider } from './hooks/useToast'
import { useSettingsUndo } from './hooks/useSettingsUndo'
import { useAutosave } from './hooks/useAutosave'

export function App() {
  const [screen, setScreen] = useState<Screen>('file')
  const [filePath, setFilePath] = useState<string | null>(null)
  const [result, setResult] = useState<TranscriptionResult | null>(null)
  const [settings, setSettings] = useState<StudioSettings>({ ...STUDIO_DEFAULTS })
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Published from ResultsScreen — forwarded to StudioPanel for render/export.
  const [groups, setGroups] = useState<Segment[]>([])
  const [groupsEdited, setGroupsEdited] = useState(false)
  const [sourceVideoInfo, setSourceVideoInfo] = useState<VideoInfo | null>(null)

  const projectIORef = useRef<ProjectIOHandle | null>(null)
  const pendingRestore = useRef<ProjectFile | null>(null)

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

  // Settings undo — wraps setSettings so every UI change is undoable.
  const settingsUndo = useSettingsUndo(settings, setSettings)
  const handleSettingsChange = useCallback(
    (next: StudioSettings) => {
      settingsUndo.push(settings)
      setSettings(next)
    },
    [settings, settingsUndo]
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
    setScreen('results')
  }

  function handleNew() {
    setFilePath(null)
    setResult(null)
    setScreen('file')
    setSettings({ ...STUDIO_DEFAULTS })
    setGroups([])
    setGroupsEdited(false)
    setSourceVideoInfo(null)
    window.subforge.autosaveClear()
  }

  // ── Groups published from ResultsScreen ─────────────────────────
  const handleGroupsUpdate = useCallback((g: Segment[], edited: boolean) => {
    setGroups(g)
    setGroupsEdited(edited)
  }, [])

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
        setSettings((prev) => {
          const next = { ...prev }
          if (info.width && info.height) {
            next.resolution = [info.width, info.height]
            next.resolutionIsSource = true
          }
          if (info.fps) next.fps = snapFps(info.fps)
          return next
        })
      })
      .catch(() => {
        /* ignore — likely audio-only */
      })
    return () => {
      cancelled = true
    }
  }, [result?.audioPath])

  // ── Project save ────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    const handle = projectIORef.current
    if (!handle) return
    const savedPath = await window.subforge.saveProject(handle.gather())
    // Explicit save is now the source of truth — drop the autosave snapshot so
    // it isn't offered as "unsaved" next launch. Later edits re-arm it.
    if (savedPath) await window.subforge.autosaveClear()
  }, [])

  // ── Project restore (shared by Open and crash-recovery) ─────────
  const restoreFromProjectFile = useCallback(async (file: ProjectFile) => {
    // Push transcription to backend so render/export work.
    if (file.transcriptionResult) {
      const tr = file.transcriptionResult
      await api
        .updateResult({
          segments: tr.segments as never,
          language: tr.language,
          duration: tr.duration,
          audio_path: tr.audioPath,
        })
        .catch(() => {})
    }

    setFilePath(file.selectedFilePath)
    setResult(file.transcriptionResult)
    setSettings(file.studioSettings)
    setScreen('results')

    pendingRestore.current = file
  }, [])

  // ── Project open ────────────────────────────────────────────────
  const handleOpen = useCallback(async () => {
    const raw = await window.subforge.openProject()
    if (!raw) return
    await restoreFromProjectFile(raw as ProjectFile)
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

  // Flush any pending restore once ResultsScreen mounts its handle.
  useEffect(() => {
    if (pendingRestore.current && projectIORef.current) {
      projectIORef.current.restore(pendingRestore.current)
      pendingRestore.current = null
    }
  })

  // ── Autosave (crash recovery) ───────────────────────────────────
  // Snapshot the live session ~2s after any edit; cleared on Save / New.
  const lastSavedAt = useAutosave(
    () => (screen === 'results' ? (projectIORef.current?.gather() ?? null) : null),
    [screen, groups, groupsEdited, settings]
  )

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
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleSave, handleOpen, settingsUndo])

  return (
    <ToastProvider>
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
            <span className="text-[var(--color-text-2)]">
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
              className="text-[var(--color-text-3)]"
              onClick={handleDiscardRecovery}
            >
              Discard
            </Button>
          </div>
        )}

        <main className="flex-1 flex min-h-0 overflow-hidden">
          {/* ── Main content (left column) ────────────────────────── */}
          {screen === 'file' && (
            <div className="flex-1 flex flex-col items-center justify-center overflow-hidden min-w-0">
              <DropZoneScreen
                filePath={filePath}
                onFileSelected={handleFileSelected}
                onStart={handleStart}
              />
            </div>
          )}
          {screen === 'progress' && (
            <div className="flex-1 flex flex-col items-center justify-center overflow-hidden min-w-0">
              <ProgressScreen
                filePath={filePath!}
                onDone={handleTranscribeDone}
                onCancel={handleNew}
              />
            </div>
          )}
          {screen === 'results' && result && (
            <ResultsScreen
              result={result}
              settings={settings}
              onGroupsUpdate={handleGroupsUpdate}
              projectIORef={projectIORef}
              onUndoRedoChange={setSubtitleUndo}
            />
          )}

          {/* ── Studio sidebar (always visible) ──────────────────── */}
          <StudioPanel
            settings={settings}
            onChange={handleSettingsChange}
            groups={groups}
            groupsEdited={groupsEdited}
            audioPath={result?.audioPath ?? filePath ?? ''}
            sourceVideoInfo={sourceVideoInfo}
          />
        </main>

        <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      </div>
    </ToastProvider>
  )
}
