import { useState } from 'react'
import type { Screen, TranscriptionResult } from './types/app'
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

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--color-bg)' }}>
      <TitleBar
        screen={screen}
        onNew={handleNew}
        onSettingsToggle={() => setSettingsOpen(o => !o)}
      />

      <main className="flex-1 overflow-hidden">
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
          <ResultsScreen result={result} />
        )}
      </main>

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  )
}
