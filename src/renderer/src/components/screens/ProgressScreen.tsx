import { useEffect, useRef } from 'react'
import type { TranscriptionResult } from '../../types/app'
import { useTranscription } from '../../hooks/useTranscription'

const STEPS = [
  { key: 'loading_model', label: 'Load Model' },
  { key: 'transcribing',  label: 'Transcribe' },
  { key: 'aligning',      label: 'Align' },
  { key: 'diarizing',     label: 'Diarize' },
  { key: 'exporting',     label: 'Export' },
] as const

type StepKey = typeof STEPS[number]['key']

interface ProgressScreenProps {
  filePath: string
  onDone:   (result: TranscriptionResult) => void
  onCancel: () => void
}

export function ProgressScreen({ filePath, onDone, onCancel }: ProgressScreenProps) {
  const { progress, start, cancel } = useTranscription()
  // Guard against React StrictMode's dev-only double-mount:
  // without this, we POST /api/transcribe twice and the second call 409s.
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    async function run() {
      const [language, diarize, hfToken] = await Promise.all([
        window.subforge.getState<string>('language', ''),
        window.subforge.getState<boolean>('diarize', false),
        window.subforge.getState<string>('hf_token', ''),
      ])
      return start(filePath, {
        language: language || undefined,
        diarize,
        hfToken: hfToken || undefined,
      })
    }
    run().then(onDone).catch(err => {
      if ((err as Error).message !== 'Cancelled') console.error('Transcription error:', err)
    })
    // No cleanup: we don't want StrictMode's unmount to cancel an in-flight job.
    // Real user-initiated cancel goes through handleCancel below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath])

  const stepKeys = STEPS.map(s => s.key)
  const currentKey  = (progress?.step ?? 'loading_model') as StepKey
  const currentIdx  = stepKeys.indexOf(currentKey)
  const pct         = Math.round(progress?.pct ?? 0)

  function handleCancel() { cancel(); onCancel() }

  return (
    <div className="flex flex-col items-center justify-center h-full gap-8 p-10">
      <div className="w-full max-w-[400px] flex flex-col gap-7">

        {/* Pipeline pills */}
        <div className="flex items-center gap-2">
          {STEPS.map((step, i) => {
            const isDone   = i < currentIdx
            const isActive = i === currentIdx
            const isPending = i > currentIdx

            return (
              <div key={step.key} className="flex-1 flex flex-col items-center gap-1.5">
                {/* Connector bar */}
                {i > 0 && (
                  <div
                    className="absolute"
                    style={{/* connector handled by flex gap */}}
                  />
                )}
                {/* Dot */}
                <div
                  className={`relative flex items-center justify-center w-7 h-7 rounded-full border transition-all duration-300 ${
                    isDone   ? 'bg-[var(--color-success)] border-[var(--color-success)]'
                  : isActive ? 'bg-[var(--color-accent)] border-[var(--color-accent)]'
                  :            'bg-[var(--color-surface-3)] border-[var(--color-border-2)]'
                  }`}
                  style={{
                    boxShadow:    isActive ? '0 0 12px 2px var(--color-accent-glow)' : 'none',
                    transform:    isActive ? 'scale(1.15)' : 'scale(1)',
                  }}
                >
                  {isDone ? (
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="white">
                      <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/>
                    </svg>
                  ) : isActive ? (
                    <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
                  ) : (
                    <div
                      className={`w-2 h-2 rounded-full ${isPending ? 'bg-[var(--color-text-3)]' : 'bg-white'}`}
                    />
                  )}
                </div>
                <span
                  className={`text-[10px] font-medium tracking-wide text-center ${isActive ? 'text-[var(--color-text-2)]' : 'text-[var(--color-text-3)]'}`}
                >
                  {step.label}
                </span>
              </div>
            )
          })}
        </div>

        {/* Step connector line behind dots — decorative */}
        <div className="relative -mt-11 mb-3 mx-3.5 h-[1px] -z-0 pointer-events-none bg-[var(--color-border)]" />

        {/* Message */}
        <div className="text-center pt-2">
          <p className="font-medium text-sm mb-1.5 text-[var(--color-text)]">
            {progress?.message ?? 'Starting…'}
          </p>
          {progress?.sub_message && (
            <p className="text-xs text-[var(--color-text-2)]">{progress.sub_message}</p>
          )}
        </div>

        {/* Progress bar */}
        <div className="flex flex-col gap-2">
          <div
            className="w-full h-1.5 rounded-full overflow-hidden bg-[var(--color-surface-3)]"
          >
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${pct}%`,
                background: 'linear-gradient(90deg, var(--color-accent) 0%, var(--color-accent-2) 100%)',
              }}
            />
          </div>
          <div className="flex justify-between text-[11px] text-[var(--color-text-3)]">
            <span>{progress?.message && pct > 0 ? `${pct}%` : ''}</span>
            <span className="tabular-nums">{pct > 0 ? `${pct}%` : ''}</span>
          </div>
        </div>

        {/* Cancel */}
        <div className="flex justify-center">
          <button className="btn-danger" onClick={handleCancel}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
