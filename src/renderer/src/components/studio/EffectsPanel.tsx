/**
 * Effects — user-placed animated overlays (logos, etc.) composited by the
 * HyperFrames renderer. Phase B: manual logo placement. Effects are sent in
 * the HyperFrames render body (useRender → buildRenderBody → /api/export-hyperframes).
 *
 * State lives in StudioPanel for now; project persistence + agent mirroring
 * come in later phases.
 */

import { StudioCard } from './StudioCard'
import { Button } from '../ui/Button'
import { useToast } from '../../hooks/useToast'
import type { EffectClip } from '../../types/app'

interface EffectsPanelProps {
  effects: EffectClip[]
  onChange: (effects: EffectClip[]) => void
  audioPath: string
}

let _fxSeq = 0

function basename(p: string): string {
  if (!p) return ''
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? p.slice(i + 1) : p
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

export function EffectsPanel({ effects, onChange }: EffectsPanelProps) {
  const { toast } = useToast()

  async function addLogo() {
    const path = await window.subforge.pickImageFile()
    if (!path) return
    _fxSeq += 1
    const clip: EffectClip = {
      id: `fx-${Date.now()}-${_fxSeq}`,
      type: 'logo',
      start: 0,
      duration: 2,
      trackIndex: 1,
      anchorX: 0.82,
      anchorY: 0.2,
      variables: { src: path, width: 200 },
      createdBy: 'user',
    }
    onChange([...effects, clip])
    toast('Logo added — set its timing below', 'info')
  }

  function patch(id: string, next: Partial<EffectClip>) {
    onChange(effects.map((e) => (e.id === id ? { ...e, ...next } : e)))
  }
  function patchVar(id: string, key: string, val: unknown) {
    onChange(
      effects.map((e) => (e.id === id ? { ...e, variables: { ...e.variables, [key]: val } } : e))
    )
  }
  function remove(id: string) {
    onChange(effects.filter((e) => e.id !== id))
  }

  return (
    <StudioCard title="Effects" defaultOpen={false}>
      <Button variant="ghost" className="w-full justify-center text-[11px] py-1" onClick={addLogo}>
        + Add Logo
      </Button>

      {effects.length === 0 ? (
        <p className="text-2xs text-[var(--color-text-3)] text-center mt-1.5">
          Logos &amp; overlays composited over your captions when you render with HyperFrames.
        </p>
      ) : (
        <div className="flex flex-col gap-2 mt-2">
          {effects.map((e) => {
            const src = typeof e.variables.src === 'string' ? e.variables.src : ''
            const width = typeof e.variables.width === 'number' ? e.variables.width : 200
            return (
              <div
                key={e.id}
                className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2"
              >
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className="shrink-0 text-[10px] uppercase tracking-wide text-[var(--color-text-3)]">
                    Logo
                  </span>
                  <span
                    className="flex-1 min-w-0 truncate text-[11px] text-[var(--color-text-2)]"
                    title={src}
                  >
                    {basename(src) || '—'}
                  </span>
                  <button
                    type="button"
                    onClick={() => remove(e.id)}
                    className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-[var(--color-text-3)] hover:bg-[var(--color-surface-3)]"
                    title="Remove effect"
                  >
                    ✕
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                  <FxNumber
                    label="Start (s)"
                    value={e.start}
                    step={0.1}
                    min={0}
                    onChange={(v) => patch(e.id, { start: Math.max(0, v) })}
                  />
                  <FxNumber
                    label="Duration (s)"
                    value={e.duration}
                    step={0.1}
                    min={0.1}
                    onChange={(v) => patch(e.id, { duration: Math.max(0.1, v) })}
                  />
                  <FxNumber
                    label="X (0–1)"
                    value={e.anchorX}
                    step={0.01}
                    min={0}
                    max={1}
                    onChange={(v) => patch(e.id, { anchorX: clamp01(v) })}
                  />
                  <FxNumber
                    label="Y (0–1)"
                    value={e.anchorY}
                    step={0.01}
                    min={0}
                    max={1}
                    onChange={(v) => patch(e.id, { anchorY: clamp01(v) })}
                  />
                  <FxNumber
                    label="Width (px)"
                    value={width}
                    step={10}
                    min={10}
                    onChange={(v) => patchVar(e.id, 'width', Math.max(10, Math.round(v)))}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </StudioCard>
  )
}

function FxNumber({
  label,
  value,
  onChange,
  step,
  min,
  max,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  step: number
  min?: number
  max?: number
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-2xs text-[var(--color-text-3)]">{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(ev) => {
          const n = parseFloat(ev.target.value)
          if (!Number.isNaN(n)) onChange(n)
        }}
        className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-1 text-[11px]"
        style={{ color: 'var(--color-text)' }}
      />
    </label>
  )
}
