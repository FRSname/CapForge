/**
 * Effects controls — user-placed animated overlays composited by the
 * HyperFrames renderer: logo, lower-third, kinetic-stat, highlight marker, and
 * b-roll image. Effects are sent in the HyperFrames render body
 * (useRender → buildRenderBody → /api/export-hyperframes).
 *
 * Rendered (without card chrome) inside the "HyperFrames ✦" card — see
 * HyperFramesPanel. State lives in App (mirrored from the agent's server-side
 * timeline); project persistence comes in a later phase.
 */

import { useCallback, useEffect, useState } from 'react'
import { Button } from '../ui/Button'
import { Select } from '../ui/Select'
import { useToast } from '../../hooks/useToast'
import { api, type EffectTemplate } from '../../lib/api'
import type { EffectClip, EffectType } from '../../types/app'

interface EffectsControlsProps {
  effects: EffectClip[]
  onChange: (effects: EffectClip[]) => void
}

let _fxSeq = 0

// Mirror the backend's per-type default anchors (mcp_server `_DEFAULT_ANCHORS`).
const DEFAULT_ANCHORS: Record<EffectType, [number, number]> = {
  logo: [0.82, 0.2],
  lower_third: [0.06, 0.82],
  kinetic_stat: [0.5, 0.4],
  highlight: [0.4, 0.5],
  b_roll: [0.5, 0.5],
}

const DEFAULT_VARS: Record<EffectType, Record<string, unknown>> = {
  logo: { width: 200 },
  lower_third: { title: 'Name', subtitle: '' },
  kinetic_stat: { value: '100%', label: '' },
  highlight: {},
  b_roll: { width: 600 },
}

const TYPE_LABEL: Record<EffectType, string> = {
  logo: 'Logo',
  lower_third: 'Lower third',
  kinetic_stat: 'Stat',
  highlight: 'Highlight',
  b_roll: 'B-roll',
}

const NEEDS_IMAGE: EffectType[] = ['logo', 'b_roll']

function basename(p: string): string {
  if (!p) return ''
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? p.slice(i + 1) : p
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

export function EffectsControls({ effects, onChange }: EffectsControlsProps) {
  const { toast } = useToast()
  const [templates, setTemplates] = useState<EffectTemplate[]>([])

  const refreshTemplates = useCallback(() => {
    api
      .listEffectTemplates()
      .then(setTemplates)
      .catch(() => {
        /* templates are best-effort; ignore load failures */
      })
  }, [])

  useEffect(() => {
    refreshTemplates()
  }, [refreshTemplates])

  function applyTemplate(t: EffectTemplate) {
    _fxSeq += 1
    const clip: EffectClip = {
      id: `fx-${Date.now()}-${_fxSeq}`,
      type: t.type,
      start: 0,
      duration: 2,
      trackIndex: t.trackIndex,
      anchorX: t.anchorX,
      anchorY: t.anchorY,
      variables: { ...t.variables },
      createdBy: 'user',
    }
    onChange([...effects, clip])
    toast(`Applied template “${t.name}”`, 'info')
  }

  async function saveTemplate(e: EffectClip, name: string) {
    try {
      await api.saveEffectTemplate(name, e)
      toast(`Saved template “${name}”`, 'success')
      refreshTemplates()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save template', 'error')
    }
  }

  async function addEffect(type: EffectType) {
    let variables: Record<string, unknown> = { ...DEFAULT_VARS[type] }
    if (NEEDS_IMAGE.includes(type)) {
      const path = await window.subforge.pickImageFile()
      if (!path) return
      variables = { ...variables, src: path }
    }
    _fxSeq += 1
    const [anchorX, anchorY] = DEFAULT_ANCHORS[type]
    const clip: EffectClip = {
      id: `fx-${Date.now()}-${_fxSeq}`,
      type,
      start: 0,
      duration: 2,
      trackIndex: 1,
      anchorX,
      anchorY,
      variables,
      createdBy: 'user',
    }
    onChange([...effects, clip])
    toast(`${TYPE_LABEL[type]} added — set it up below`, 'info')
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
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-3 gap-1">
        {(Object.keys(TYPE_LABEL) as EffectType[]).map((t) => (
          <Button
            key={t}
            variant="ghost"
            className="justify-center text-[11px] py-1"
            onClick={() => addEffect(t)}
          >
            + {TYPE_LABEL[t]}
          </Button>
        ))}
      </div>

      {templates.length > 0 && (
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="shrink-0 text-2xs text-[var(--color-text-3)]">Saved</span>
          <Select
            className="flex-1 min-w-0 text-[11px]"
            value=""
            onChange={(ev) => {
              const t = templates.find((x) => x.name === ev.target.value)
              if (t) applyTemplate(t)
            }}
          >
            <option value="">Apply template…</option>
            {templates.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
              </option>
            ))}
          </Select>
        </div>
      )}

      {effects.length === 0 ? (
        <p className="text-2xs text-[var(--color-text-3)] text-center mt-1.5">
          Overlays composited over your captions when you render with HyperFrames.
        </p>
      ) : (
        <div className="flex flex-col gap-2 mt-2">
          {effects.map((e) => (
            <EffectRow
              key={e.id}
              e={e}
              onPatch={(next) => patch(e.id, next)}
              onPatchVar={(k, v) => patchVar(e.id, k, v)}
              onRemove={() => remove(e.id)}
              onSaveTemplate={(name) => saveTemplate(e, name)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function summary(e: EffectClip): string {
  const v = e.variables
  if (e.type === 'lower_third') return typeof v.title === 'string' ? v.title : '—'
  if (e.type === 'kinetic_stat') return typeof v.value === 'string' ? v.value : '—'
  if (e.type === 'highlight') return 'marker'
  return basename(typeof v.src === 'string' ? v.src : '') || '—'
}

function EffectRow({
  e,
  onPatch,
  onPatchVar,
  onRemove,
  onSaveTemplate,
}: {
  e: EffectClip
  onPatch: (next: Partial<EffectClip>) => void
  onPatchVar: (key: string, val: unknown) => void
  onRemove: () => void
  onSaveTemplate: (name: string) => void
}) {
  const sVar = (k: string): string =>
    typeof e.variables[k] === 'string' ? (e.variables[k] as string) : ''
  const nVar = (k: string, d: number): number =>
    typeof e.variables[k] === 'number' ? (e.variables[k] as number) : d

  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="shrink-0 text-[10px] uppercase tracking-wide text-[var(--color-text-3)]">
          {TYPE_LABEL[e.type]}
        </span>
        <span
          className="flex-1 min-w-0 truncate text-[11px] text-[var(--color-text-2)]"
          title={summary(e)}
        >
          {summary(e)}
        </span>
        <button
          type="button"
          onClick={onRemove}
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
          onChange={(v) => onPatch({ start: Math.max(0, v) })}
        />
        <FxNumber
          label="Duration (s)"
          value={e.duration}
          step={0.1}
          min={0.1}
          onChange={(v) => onPatch({ duration: Math.max(0.1, v) })}
        />
        <FxNumber
          label="X (0–1)"
          value={e.anchorX}
          step={0.01}
          min={0}
          max={1}
          onChange={(v) => onPatch({ anchorX: clamp01(v) })}
        />
        <FxNumber
          label="Y (0–1)"
          value={e.anchorY}
          step={0.01}
          min={0}
          max={1}
          onChange={(v) => onPatch({ anchorY: clamp01(v) })}
        />
      </div>

      <div className="mt-1.5 flex flex-col gap-1.5">
        {e.type === 'lower_third' && (
          <>
            <FxText label="Title" value={sVar('title')} onChange={(v) => onPatchVar('title', v)} />
            <FxText
              label="Subtitle"
              value={sVar('subtitle')}
              onChange={(v) => onPatchVar('subtitle', v)}
            />
          </>
        )}
        {e.type === 'kinetic_stat' && (
          <>
            <FxText label="Value" value={sVar('value')} onChange={(v) => onPatchVar('value', v)} />
            <FxText label="Label" value={sVar('label')} onChange={(v) => onPatchVar('label', v)} />
          </>
        )}
        {e.type === 'highlight' && (
          <div className="grid grid-cols-2 gap-1.5">
            <FxNumber
              label="Width (px)"
              value={nVar('width', 240)}
              step={10}
              min={10}
              onChange={(v) => onPatchVar('width', Math.max(10, Math.round(v)))}
            />
            <FxNumber
              label="Height (px)"
              value={nVar('height', 40)}
              step={2}
              min={4}
              onChange={(v) => onPatchVar('height', Math.max(4, Math.round(v)))}
            />
          </div>
        )}
        {e.type === 'logo' && (
          <div className="grid grid-cols-2 gap-1.5">
            <FxNumber
              label="Width (px)"
              value={nVar('width', 200)}
              step={10}
              min={10}
              onChange={(v) => onPatchVar('width', Math.max(10, Math.round(v)))}
            />
          </div>
        )}
        {e.type === 'b_roll' && (
          <div className="grid grid-cols-2 gap-1.5 items-end">
            <FxNumber
              label="Width (px)"
              value={nVar('width', 600)}
              step={20}
              min={20}
              onChange={(v) => onPatchVar('width', Math.max(20, Math.round(v)))}
            />
            <FxCheckbox
              label="Fullscreen"
              checked={e.variables.fullscreen === true}
              onChange={(c) => onPatchVar('fullscreen', c || undefined)}
            />
          </div>
        )}
      </div>

      <RowTemplateSaver onSave={onSaveTemplate} />
    </div>
  )
}

/** "★ Save as template" affordance that expands to a name input on click. */
function RowTemplateSaver({ onSave }: { onSave: (name: string) => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')

  function commit() {
    const trimmed = name.trim()
    if (!trimmed) return
    onSave(trimmed)
    setOpen(false)
    setName('')
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1.5 w-full rounded px-1.5 py-0.5 text-2xs text-[var(--color-text-3)] hover:bg-[var(--color-surface-3)]"
        title="Save this effect as a reusable template"
      >
        ★ Save as template
      </button>
    )
  }

  return (
    <div className="mt-1.5 flex items-center gap-1">
      <input
        autoFocus
        value={name}
        placeholder="Template name"
        onChange={(ev) => setName(ev.target.value)}
        onKeyDown={(ev) => {
          if (ev.key === 'Enter') commit()
          if (ev.key === 'Escape') setOpen(false)
        }}
        className="flex-1 min-w-0 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-1 text-[11px]"
        style={{ color: 'var(--color-text)' }}
      />
      <button
        type="button"
        onClick={commit}
        className="shrink-0 rounded px-2 py-1 text-[11px] bg-[var(--color-accent)] text-white"
      >
        Save
      </button>
    </div>
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

function FxText({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-2xs text-[var(--color-text-3)]">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(ev) => onChange(ev.target.value)}
        className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-1 text-[11px]"
        style={{ color: 'var(--color-text)' }}
      />
    </label>
  )
}

function FxCheckbox({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-2)] py-1">
      <input type="checkbox" checked={checked} onChange={(ev) => onChange(ev.target.checked)} />
      {label}
    </label>
  )
}
