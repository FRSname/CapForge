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
import { useToast } from '../../hooks/useToast'

interface PresetPickerProps {
  settings: StudioSettings
  onChange: (next: StudioSettings) => void
}

interface UserPreset {
  name: string
  settings: VanillaPreset
}

export function PresetPicker({ settings, onChange }: PresetPickerProps) {
  const [open, setOpen] = useState(false)
  const [userPresets, setUserPresets] = useState<UserPreset[]>([])
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveName, setSaveName] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const saveInputRef = useRef<HTMLInputElement>(null)
  const { toast } = useToast()

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
        } catch {
          /* skip broken entry */
        }
      }
      setUserPresets(loaded)
    } catch {
      // Preset API unavailable — leave userPresets empty.
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // ── Close on outside click or Escape (pattern: WordStylePopup) ───
  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
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

  const handleSaveClick = () => {
    setSaving(true)
    setSaveName('')
    setTimeout(() => saveInputRef.current?.focus(), 50)
  }

  const handleSaveConfirm = async () => {
    const name = saveName.trim()
    if (!name) {
      setSaving(false)
      return
    }
    if (!window.subforge?.savePreset) {
      setSaving(false)
      return
    }
    setBusy(true)
    try {
      await window.subforge.savePreset(name, studioToVanilla(settings) as Record<string, unknown>)
      await refresh()
    } catch {
      /* ignore */
    } finally {
      setBusy(false)
      setSaving(false)
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

  const handleImport = async () => {
    if (!window.subforge?.importPreset) {
      toast('Import unavailable — please restart CapForge', 'error')
      return
    }
    setBusy(true)
    try {
      const res = await window.subforge.importPreset()
      if (!res) return // cancelled
      if ('error' in res) {
        toast(res.error, 'error')
        return
      }
      await refresh()
      const msg =
        res.fontStatus === 'missing'
          ? `Imported "${res.name}" — its font was missing, using default`
          : `Imported "${res.name}"`
      toast(msg, res.fontStatus === 'missing' ? 'info' : 'success')
    } catch {
      toast('Could not import preset — the file may be malformed.', 'error')
    } finally {
      setBusy(false)
    }
  }

  const handleExport = async (p: UserPreset, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!window.subforge?.exportPreset) {
      toast('Export unavailable — please restart CapForge', 'error')
      return
    }
    try {
      const res = await window.subforge.exportPreset(p.name)
      if (!res) {
        toast('Export cancelled', 'info')
        return
      }
      if ('error' in res) {
        toast(res.error, 'error')
        return
      }
      const msg =
        res.fontStatus === 'missing'
          ? `Exported "${p.name}" — its custom font wasn't included (missing or too large)`
          : `Exported to ${res.filePath}`
      toast(msg, res.fontStatus === 'missing' ? 'info' : 'success')
    } catch {
      toast('Export failed', 'error')
    }
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        className="btn-ghost text-[11px] py-0.5 px-2"
        onClick={() => setOpen((o) => !o)}
        title="Apply or save style presets"
      >
        Presets ▾
      </button>

      {open && (
        <div
          className="pop-in origin-top absolute right-0 top-full mt-1 w-64 z-[var(--z-dropdown)] rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] shadow-lg overflow-hidden"
          // Keep picker from being clipped by the sidebar
          style={{ maxHeight: '70vh' }}
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)]">
            <span className="text-[11px] font-medium text-[var(--color-text-2)]">
              Style presets
            </span>
            {saving ? (
              <div className="flex items-center gap-1">
                <input
                  ref={saveInputRef}
                  type="text"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveConfirm()
                    if (e.key === 'Escape') {
                      // Cancel the save UI only — keep the document-level
                      // Escape listener from closing the whole dropdown.
                      e.stopPropagation()
                      setSaving(false)
                    }
                  }}
                  placeholder="Preset name"
                  className="w-24 text-2xs px-1.5 py-0.5 rounded border border-[var(--color-border)] bg-[var(--color-surface)] focus:border-[var(--color-accent)] outline-none"
                />
                <button
                  className="btn-ghost text-2xs py-0.5 px-1"
                  onClick={handleSaveConfirm}
                  disabled={busy || !saveName.trim()}
                >
                  Save
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <button
                  className="btn-ghost text-2xs py-0.5 px-1.5"
                  onClick={handleImport}
                  disabled={busy}
                  title="Import preset from a .cfpreset file"
                  aria-label="Import preset"
                >
                  ↓ Import
                </button>
                <button
                  className="btn-ghost text-2xs py-0.5 px-1.5"
                  onClick={handleSaveClick}
                  disabled={busy}
                  title="Save current settings as a new preset"
                  aria-label="Save preset"
                >
                  + Save current
                </button>
              </div>
            )}
          </div>

          <div className="overflow-y-auto" style={{ maxHeight: 'calc(70vh - 40px)' }}>
            {/* Built-in */}
            <div className="px-3 py-1 text-[9px] uppercase tracking-wider text-[var(--color-text-3)]">
              Built-in
            </div>
            {BUILTIN_PRESETS.map((tpl) => (
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
                {userPresets.map((p) => (
                  <PresetRow
                    key={`u-${p.name}`}
                    name={p.name}
                    colors={extractColors(p.settings)}
                    onClick={() => applyUser(p)}
                    onExport={(e) => handleExport(p, e)}
                    onDelete={(e) => handleDelete(p, e)}
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
  name: string
  colors: { text: string; active: string; bg: string }
  onClick: () => void
  onExport?: (e: React.MouseEvent) => void
  onDelete?: (e: React.MouseEvent) => void
}

function PresetRow({ name, colors, onClick, onExport, onDelete }: PresetRowProps) {
  return (
    <div
      className="group flex items-center gap-2 w-full px-3 py-1.5 text-left hover:bg-[var(--color-surface-3)] transition-colors"
      role="option"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      {/* Mini text preview — preset's bg/text/active colors rendering "Abc" */}
      <span
        className="flex items-center justify-center shrink-0 w-10 h-[22px] rounded border border-[var(--color-border)] font-bold leading-none select-none"
        style={{ background: colors.bg, fontSize: 11 }}
        aria-hidden="true"
      >
        <span style={{ color: colors.text }}>Ab</span>
        <span style={{ color: colors.active }}>c</span>
      </span>
      <span className="flex-1 min-w-0 truncate text-xs text-[var(--color-text)]">{name}</span>
      {onExport && (
        <button
          type="button"
          className="opacity-0 group-hover:opacity-70 hover:!opacity-100 shrink-0 text-[var(--color-text-3)] text-xs px-1"
          onClick={(e) => {
            e.stopPropagation()
            onExport(e)
          }}
          title="Export preset"
          aria-label={`Export preset ${name}`}
        >
          ↑
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          className="opacity-0 group-hover:opacity-70 hover:!opacity-100 shrink-0 text-[var(--color-text-3)] text-xs px-1"
          onClick={(e) => {
            e.stopPropagation()
            onDelete(e)
          }}
          title="Delete preset"
          aria-label={`Delete preset ${name}`}
        >
          ✕
        </button>
      )}
    </div>
  )
}

function extractColors(p: VanillaPreset): { text: string; active: string; bg: string } {
  return {
    text: p.textColor ?? '#FFFFFF',
    active: p.activeColor ?? '#FFD700',
    bg: p.bgColor ?? '#000000',
  }
}
