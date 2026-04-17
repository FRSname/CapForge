/**
 * Preset picker — dropdown for applying built-in + user style presets.
 *
 * Ports the preset-tile behaviour from app.js:1941-2340, compressed into a
 * compact dropdown that fits the React panel's layout. Each row shows a small
 * color-chip preview, the preset name, and a delete icon for user presets.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { StudioSettings } from './StudioPanel'
import {
  BUILTIN_PRESETS,
  applyPreset,
  studioToVanilla,
  type BuiltinPreset,
  type VanillaPreset,
} from '../../lib/presets'

interface PresetPickerProps {
  settings: StudioSettings
  onChange: (next: StudioSettings) => void
}

interface UserPreset {
  name:     string
  settings: VanillaPreset
}

export function PresetPicker({ settings, onChange }: PresetPickerProps) {
  const [open, setOpen]               = useState(false)
  const [userPresets, setUserPresets] = useState<UserPreset[]>([])
  const [busy, setBusy]               = useState(false)
  const rootRef                       = useRef<HTMLDivElement>(null)

  // ── Load user presets once on mount (and after save/delete) ─────
  const refresh = useCallback(async () => {
    if (!window.subforge?.listPresets) return
    try {
      const names = await window.subforge.listPresets()
      const loaded: UserPreset[] = []
      for (const n of names) {
        try {
          const s = await window.subforge.loadPreset(n)
          if (s) loaded.push({ name: n, settings: s as VanillaPreset })
        } catch { /* skip broken entry */ }
      }
      setUserPresets(loaded)
    } catch {
      // Preset API unavailable — leave userPresets empty.
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  // ── Close on outside click ───────────────────────────────────────
  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  // ── Actions ──────────────────────────────────────────────────────
  const applyBuiltin = (tpl: BuiltinPreset) => {
    onChange(applyPreset(settings, tpl.settings))
    setOpen(false)
  }

  const applyUser = (p: UserPreset) => {
    onChange(applyPreset(settings, p.settings))
    setOpen(false)
  }

  const handleSave = async () => {
    const name = window.prompt('Save current style as preset:\nName?')?.trim()
    if (!name) return
    if (!window.subforge?.savePreset) {
      window.alert('Preset API not available.')
      return
    }
    setBusy(true)
    try {
      await window.subforge.savePreset(name, studioToVanilla(settings) as Record<string, unknown>)
      await refresh()
    } catch (err) {
      window.alert(`Failed to save preset: ${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (p: UserPreset, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!window.confirm(`Delete preset "${p.name}"?`)) return
    if (!window.subforge?.deletePreset) return
    setBusy(true)
    try {
      await window.subforge.deletePreset(p.name)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        className="btn-ghost text-[11px] py-0.5 px-2"
        onClick={() => setOpen(o => !o)}
        title="Apply or save style presets"
      >
        Presets ▾
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 w-64 z-50 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] shadow-lg overflow-hidden"
          // Keep picker from being clipped by the sidebar
          style={{ maxHeight: '70vh' }}
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)]">
            <span className="text-[11px] font-medium text-[var(--color-text-2)]">Style presets</span>
            <button
              className="btn-ghost text-[10px] py-0.5 px-1.5"
              onClick={handleSave}
              disabled={busy}
              title="Save current settings as a new preset"
            >
              + Save current
            </button>
          </div>

          <div className="overflow-y-auto" style={{ maxHeight: 'calc(70vh - 40px)' }}>
            {/* Built-in */}
            <div className="px-3 py-1 text-[9px] uppercase tracking-wider text-[var(--color-text-3)]">
              Built-in
            </div>
            {BUILTIN_PRESETS.map(tpl => (
              <PresetRow
                key={`b-${tpl.name}`}
                name={tpl.name}
                colors={extractColors(tpl.settings)}
                onClick={() => applyBuiltin(tpl)}
              />
            ))}

            {/* User */}
            {userPresets.length > 0 && (
              <>
                <div className="px-3 py-1 mt-1 text-[9px] uppercase tracking-wider text-[var(--color-text-3)]">
                  My presets
                </div>
                {userPresets.map(p => (
                  <PresetRow
                    key={`u-${p.name}`}
                    name={p.name}
                    colors={extractColors(p.settings)}
                    onClick={() => applyUser(p)}
                    onDelete={e => handleDelete(p, e)}
                  />
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Row ────────────────────────────────────────────────────────────

interface PresetRowProps {
  name:     string
  colors:   { text: string; active: string; bg: string }
  onClick:  () => void
  onDelete?: (e: React.MouseEvent) => void
}

function PresetRow({ name, colors, onClick, onDelete }: PresetRowProps) {
  return (
    <button
      className="group flex items-center gap-2 w-full px-3 py-1.5 text-left hover:bg-[var(--color-surface-3)] transition-colors"
      onClick={onClick}
    >
      {/* Color chip preview */}
      <div className="flex items-center shrink-0 rounded overflow-hidden border border-[var(--color-border)]">
        <span className="w-3 h-4" style={{ background: colors.bg }} />
        <span className="w-3 h-4" style={{ background: colors.text }} />
        <span className="w-3 h-4" style={{ background: colors.active }} />
      </div>
      <span className="flex-1 min-w-0 truncate text-xs text-[var(--color-text)]">{name}</span>
      {onDelete && (
        <span
          role="button"
          className="opacity-0 group-hover:opacity-70 hover:!opacity-100 shrink-0 text-[var(--color-text-3)] text-xs px-1"
          onClick={onDelete}
          title="Delete preset"
        >
          ✕
        </span>
      )}
    </button>
  )
}

function extractColors(p: VanillaPreset): { text: string; active: string; bg: string } {
  return {
    text:   p.textColor   ?? '#FFFFFF',
    active: p.activeColor ?? '#FFD700',
    bg:     p.bgColor     ?? '#000000',
  }
}
