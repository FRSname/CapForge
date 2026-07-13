import { useEffect, useRef } from 'react'
import lottie from 'lottie-web/build/player/lottie_light'
import type { TranscriptionResult } from '../../types/app'
import { useTranscription } from '../../hooks/useTranscription'
import { useToast } from '../../hooks/useToast'
import type { ToastType } from '../../hooks/useToast'
import chatAnimation from '../../assets/chat-loading.json'

const STEPS = [
  { key: 'loading_model', label: 'Load Model' },
  { key: 'transcribing', label: 'Transcribe' },
  { key: 'aligning', label: 'Align' },
  { key: 'diarizing', label: 'Diarize' },
  { key: 'exporting', label: 'Export' },
] as const

type StepKey = (typeof STEPS)[number]['key']

/**
 * Handles a rejected transcription promise: silently short-circuits on a
 * user-initiated cancel, otherwise surfaces the failure via toast and hands
 * control back to the caller (App.tsx's existing `onCancel` state path) so
 * the user is never stranded on the progress spinner.
 *
 * Exported as a pure function so it's testable without mounting the
 * component (this repo's vitest config runs in plain node, no DOM).
 */
export function handleTranscriptionError(
  err: unknown,
  toast: (message: string, type?: ToastType) => void,
  onFailure: () => void
): void {
  const rawMessage = err instanceof Error ? err.message : undefined
  if (rawMessage === 'Cancelled') return

  console.error('Transcription error:', err)
  toast(rawMessage || 'Transcription failed', 'error')
  onFailure()
}

interface ProgressScreenProps {
  filePath: string
  onDone: (result: TranscriptionResult) => void
  onCancel: () => void
}

export function ProgressScreen({ filePath, onDone, onCancel }: ProgressScreenProps) {
  const { progress, start, cancel } = useTranscription()
  const { toast } = useToast()
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
    run()
      .then(onDone)
      .catch((err) => handleTranscriptionError(err, toast, onCancel))
    // No cleanup: we don't want StrictMode's unmount to cancel an in-flight job.
    // Real user-initiated cancel goes through handleCancel below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath])

  const stepKeys = STEPS.map((s) => s.key)
  const currentKey = (progress?.step ?? 'loading_model') as StepKey
  const currentIdx = stepKeys.indexOf(currentKey)
  const pct = Math.round(progress?.pct ?? 0)

  function handleCancel() {
    cancel()
    onCancel()
  }

  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 p-10">
      <div className="w-full max-w-[400px] flex flex-col items-center gap-5">
        {/* Lottie chat animation */}
        <LottieChat />

        {/* Pipeline pills */}
        <div className="flex items-center gap-2 w-full">
          {STEPS.map((step, i) => {
            const isDone = i < currentIdx
            const isActive = i === currentIdx
            const isPending = i > currentIdx

            return (
              <div key={step.key} className="flex-1 flex flex-col items-center gap-1.5">
                {/* Connector bar */}
                {i > 0 && (
                  <div
                    className="absolute"
                    style={
                      {
                        /* connector handled by flex gap */
                      }
                    }
                  />
                )}
                {/* Dot */}
                <div
                  className={`relative flex items-center justify-center w-7 h-7 rounded-full border transition-all duration-300 ${
                    isDone
                      ? 'bg-[var(--color-success)] border-[var(--color-success)]'
                      : isActive
                        ? 'bg-[var(--color-brand)] border-[var(--color-brand)]'
                        : 'bg-[var(--color-surface-3)] border-[var(--color-border-2)]'
                  }`}
                  style={{
                    boxShadow: isActive ? '0 0 12px 2px var(--color-brand-glow)' : 'none',
                    transform: isActive ? 'scale(1.15)' : 'scale(1)',
                  }}
                >
                  {isDone ? (
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="white">
                      <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
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
                  className={`text-2xs font-medium tracking-wide text-center ${isActive ? 'text-[var(--color-text-2)]' : 'text-[var(--color-text-3)]'}`}
                >
                  {step.label}
                </span>
              </div>
            )
          })}
        </div>

        {/* Message */}
        <div className="text-center">
          <p
            aria-live="polite"
            className="text-lg mb-1.5"
            style={{
              fontFamily: 'var(--cf-font-display)',
              fontStyle: 'italic',
              color: 'var(--color-text)',
            }}
          >
            {progress?.message ?? 'Starting\u2026'}
          </p>
          {progress?.sub_message && (
            <p className="text-xs text-[var(--color-text-2)]">{progress.sub_message}</p>
          )}
        </div>

        {/* Progress bar */}
        <div className="flex flex-col gap-2 w-full">
          <div className="w-full h-1.5 rounded-full overflow-hidden bg-[var(--color-surface-3)]">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${pct}%`,
                background:
                  'linear-gradient(90deg, var(--color-brand) 0%, color-mix(in srgb, var(--color-brand) 60%, white) 100%)',
              }}
            />
          </div>
          <div className="text-right text-[11px] text-[var(--color-text-3)]">
            <span className="tabular-nums">{pct > 0 ? `${pct}%` : ''}</span>
          </div>
        </div>

        {/* Cancel */}
        <div className="flex justify-center">
          <button className="btn-danger" onClick={handleCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

function LottieChat() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const anim = lottie.loadAnimation({
      container: el,
      renderer: 'svg',
      loop: true,
      autoplay: true,
      animationData: chatAnimation,
    })
    return () => anim.destroy()
  }, [])

  return <div ref={containerRef} className="w-[120px] h-[120px]" />
}
