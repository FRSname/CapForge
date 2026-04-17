import { useCallback, useEffect, useRef, useState } from 'react'
import type { Screen, TranscriptionResult } from './types/app'
import type { ProjectFile, ProjectIOHandle } from './lib/project'
import { api } from './lib/api'
import { TitleBar } from './components/TitleBar/TitleBar'
import { DropZoneScreen } from './components/screens/DropZoneScreen'
import { ProgressScreen } from './components/screens/ProgressScreen'
import { ResultsScreen } from './components/screens/ResultsScreen'
import { SettingsPanel } from './components/SettingsPanel'

export function App() {
  const [screen,          setScreen]          = useState<Screen>('file')
  const [filePath,        setFilePath]        = useState<string | null>(null)
  const [result,          setResult]          = useState<TranscriptionResult | null>(null)
  const [settingsOpen,    setSettingsOpen]    = useState(false)

  // Ref-based handle so we can gather/restore ResultsScreen state without
  // lifting every piece of editor state up to App.
  const projectIORef = useRef<ProjectIOHandle | null>(null)
  // Queued restore — applied once ResultsScreen mounts and assigns its handle.
  const pendingRestore = useRef<ProjectFile | null>(null)

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
  }

  // ── Project save ────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    const handle = projectIORef.current
    if (!handle) return
    const payload = handle.gather()
    await window.subforge.saveProject(payload)
  }, [])

  // ── Project open ────────────────────────────────────────────────
  const handleOpen = useCallback(async () => {
    const raw = await window.subforge.openProject()
    if (!raw) return
    const file = raw as ProjectFile

    // Push the transcription result to the backend so render/export can work.
    // The backend expects snake_case `audio_path`; our app type uses camelCase.
    if (file.transcriptionResult) {
      const tr = file.transcriptionResult
      await api.updateResult({
        segments:   tr.segments as never,
        language:   tr.language,
        duration:   tr.duration,
        audio_path: tr.audioPath,
      }).catch(() => {})
    }

    // Transition to results screen with the loaded transcription.
    setFilePath(file.selectedFilePath)
    setResult(file.transcriptionResult)
    setScreen('results')

    // Queue the restore — ResultsScreen will pick it up once mounted.
    pendingRestore.current = file
  }, [])

  // Flush any pending restore once the handle becomes available.
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
      // Skip when typing in an input/textarea/contenteditable
      const tag = (e.target as HTMLElement).tagName
      const editable = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable
      if (editable && !mod) return

      if (mod && e.key === 's') {
        e.preventDefault()
        handleSave()
      } else if (mod && e.key === 'o') {
        e.preventDefault()
        handleOpen()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleSave, handleOpen])

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--color-bg)' }}>
      <TitleBar
        screen={screen}
        onNew={handleNew}
        onSave={handleSave}
        onOpen={handleOpen}
        onSettingsToggle={() => setSettingsOpen(o => !o)}
      />

      <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {screen === 'file' && (
          <DropZoneScreen
            filePath={filePath}
            onFileSelected={handleFileSelected}
            onStart={handleStart}
          />
        )}
        {screen === 'progress' && (
          <ProgressScreen
            filePath={filePath!}
            onDone={handleTranscribeDone}
            onCancel={handleNew}
          />
        )}
        {screen === 'results' && result && (
          <ResultsScreen result={result} projectIORef={projectIORef} />
        )}
      </main>

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  )
}
