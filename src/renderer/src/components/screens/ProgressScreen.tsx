import { useEffect } from 'react'
import type { TranscriptionResult } from '../../types/app'
import { useTranscription } from '../../hooks/useTranscription'

const PIPELINE_STEPS = [
  { key: 'loading_model', label: 'Load model' },
  { key: 'transcribing',  label: 'Transcribe' },
  { key: 'aligning',      label: 'Align' },
  { key: 'diarizing',     label: 'Diarize' },
  { key: 'exporting',     label: 'Export' },
] as const

interface ProgressScreenProps {
  filePath: string
  onDone: (result: TranscriptionResult) => void
  onCancel: () => void
}

export function ProgressScreen({ filePath, onDone, onCancel }: ProgressScreenProps) {
  const { progress, start, cancel } = useTranscription()

  useEffect(() => {
    start(filePath)
      .then(onDone)
      .catch(err => {
        if ((err as Error).message !== 'WebSocket closed unexpectedly') {
          console.error('Transcription error:', err)
        }
      })

    return cancel
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath])

  const currentStep = progress?.step ?? 'loading_model'
  const pct = progress?.pct ?? 0

  function handleCancel() {
    cancel()
    onCancel()
  }

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 p-8">
      <div className="w-full max-w-sm flex flex-col gap-5">

        {/* Pipeline step indicators */}
        <div className="flex items-center justify-between">
          {PIPELINE_STEPS.map((step, i) => {
            const stepKeys = PIPELINE_STEPS.map(s => s.key)
            const currentIdx = stepKeys.indexOf(currentStep as typeof stepKeys[number])
            const isDone    = i < currentIdx
            const isActive  = i === currentIdx

            return (
              <div key={step.key} className="flex flex-col items-center gap-1.5">
                <div
                  className={[
                    'w-2.5 h-2.5 rounded-full transition-all',
                    isDone   ? 'bg-[var(--color-success)]' : '',
                    isActive ? 'bg-[var(--color-accent)] ring-2 ring-[var(--color-accent)]/30 scale-125' : '',
                    !isDone && !isActive ? 'bg-white/10' : '',
                  ].join(' ')}
                />
                <span className={[
                  'text-[10px]',
                  isActive ? 'text-[var(--color-text-muted)]' : 'text-[var(--color-text-subtle)]',
                ].join(' ')}>
                  {step.label}
                </span>
              </div>
            )
          })}
        </div>

        {/* Step message */}
        <div className="text-center">
          <p className="text-sm font-medium">{progress?.message ?? 'Starting…'}</p>
          {progress?.sub_message && (
            <p className="text-xs text-[var(--color-text-muted)] mt-1">{progress.sub_message}</p>
          )}
        </div>

        {/* Progress bar */}
        <div className="w-full h-1 rounded-full bg-white/[0.06] overflow-hidden">
          <div
            className="h-full bg-[var(--color-accent)] rounded-full transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>

        <p className="text-center text-xs text-[var(--color-text-muted)]">{pct}%</p>

        <button
          className="mx-auto px-4 py-1.5 rounded-lg border border-[var(--color-danger)]/40 text-[var(--color-danger)] text-xs hover:bg-[var(--color-danger)]/10 transition-colors"
          onClick={handleCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
