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
import { ToastProvider } from './hooks/useToast'
import { useSettingsUndo } from './hooks/useSettingsUndo'

export function App() {
  const [screen,          setScreen]          = useState<Screen>('file')
  const [filePath,        setFilePath]        = useState<string | null>(null)
  const [result,          setResult]          = useState<TranscriptionResult | null>(null)
  const [settings,        setSettings]        = useState<StudioSettings>({ ...STUDIO_DEFAULTS })
  const [settingsOpen,    setSettingsOpen]    = useState(false)

  // Published from ResultsScreen — forwarded to StudioPanel for render/export.
  const [groups,          setGroups]          = useState<Segment[]>([])
  const [groupsEdited,    setGroupsEdited]    = useState(false)
  const [sourceVideoInfo, setSourceVideoInfo] = useState<VideoInfo | null>(null)

  const projectIORef   = useRef<ProjectIOHandle | null>(null)
  const pendingRestore = useRef<ProjectFile | null>(null)

  // Settings undo — wraps setSettings so every UI change is undoable.
  const settingsUndo = useSettingsUndo(settings, setSettings)
  const handleSettingsChange = useCallback((next: StudioSettings) => {
    settingsUndo.push(settings)
    setSettings(next)
  }, [settings, settingsUndo])

  // ── File handling ───────────────────────────────────────────────
  function handleFileSelected(path: string) { setFilePath(path || null) }

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
    api.getVideoInfo(result.audioPath)
      .then(info => {
        if (cancelled) return
        setSourceVideoInfo(info)
        setSettings(prev => {
          const next = { ...prev }
          if (info.width && info.height) {
            next.resolution = [info.width, info.height]
            next.resolutionIsSource = true
          }
          if (info.fps) next.fps = snapFps(info.fps)
          return next
        })
      })
      .catch(() => { /* ignore — likely audio-only */ })
    return () => { cancelled = true }
  }, [result?.audioPath])

  // ── Project save ────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    const handle = projectIORef.current
    if (!handle) return
    await window.subforge.saveProject(handle.gather())
  }, [])

  // ── Project open ────────────────────────────────────────────────
  const handleOpen = useCallback(async () => {
    const raw = await window.subforge.openProject()
    if (!raw) return
    const file = raw as ProjectFile

    // Push transcription to backend so render/export work.
    if (file.transcriptionResult) {
      const tr = file.transcriptionResult
      await api.updateResult({
        segments:   tr.segments as never,
        language:   tr.language,
        duration:   tr.duration,
        audio_path: tr.audioPath,
      }).catch(() => {})
    }

    setFilePath(file.selectedFilePath)
    setResult(file.transcriptionResult)
    setSettings(file.studioSettings)
    setScreen('results')

    pendingRestore.current = file
  }, [])

  // Flush any pending restore once ResultsScreen mounts its handle.
  useEffect(() => {
    if (pendingRestore.current && projectIORef.current) {
      projectIORef.current.restore(pendingRestore.current)
      pendingRestore.current = null
    }
  })

  // ── Global keyboard shortcuts ───────────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey
      const tag = (e.target as HTMLElement).tagName
      const editable = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable
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
        onSettingsToggle={() => setSettingsOpen(o => !o)}
      />

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

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
    </ToastProvider>
  )
}
