import { useState } from 'react'
import type { Screen, TranscriptionResult } from './types/app'
import { TitleBar } from './components/TitleBar/TitleBar'
import { DropZoneScreen } from './components/screens/DropZoneScreen'
import { ProgressScreen } from './components/screens/ProgressScreen'
import { ResultsScreen } from './components/screens/ResultsScreen'

export function App() {
  const [screen, setScreen] = useState<Screen>('file')
  const [filePath, setFilePath] = useState<string | null>(null)
  const [result, setResult] = useState<TranscriptionResult | null>(null)

  function handleFileSelected(path: string) {
    setFilePath(path)
  }

  function handleTranscribeStart() {
    setScreen('progress')
  }

  function handleTranscribeDone(data: TranscriptionResult) {
    setResult(data)
    setScreen('results')
  }

  function handleNewTranscription() {
    setFilePath(null)
    setResult(null)
    setScreen('file')
  }

  return (
    <div className="flex flex-col h-full">
      <TitleBar
        screen={screen}
        onNew={handleNewTranscription}
      />

      <main className="flex-1 overflow-hidden">
        {screen === 'file' && (
          <DropZoneScreen
            filePath={filePath}
            onFileSelected={handleFileSelected}
            onStart={handleTranscribeStart}
          />
        )}

        {screen === 'progress' && (
          <ProgressScreen
            filePath={filePath!}
            onDone={handleTranscribeDone}
            onCancel={handleNewTranscription}
          />
        )}

        {screen === 'results' && result && (
          <ResultsScreen
            result={result}
          />
        )}
      </main>
    </div>
  )
}
