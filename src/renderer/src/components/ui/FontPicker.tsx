/**
 * Font picker: lists bundled fonts + user-uploaded fonts, registers them with
 * document.fonts so the overlay canvas can actually render in that face, and
 * lets the user upload or delete custom fonts.
 *
 * Ports the font-related logic from app.js:1848-1930 + addFontToDropdown().
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { loadAllFonts, registerFontFromBuffer, type FontInfo } from '../../lib/fonts'

interface FontPickerProps {
  value:    string
  onChange: (name: string, path: string) => void
}

export function FontPicker({ value, onChange }: FontPickerProps) {
  const [fonts,    setFonts]    = useState<FontInfo[]>([])
  const [loading,  setLoading]  = useState(true)
  const [busy,     setBusy]     = useState(false)
  const inputRef                = useRef<HTMLInputElement>(null)

  // Load + register fonts on mount. Re-runs only if the subforge bridge
  // reports new paths (not expected during a session).
  const refresh = useCallback(async () => {
    try {
      const all = await loadAllFonts()
      setFonts(all)
    } catch {
      setFonts([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  async function handleFile(file: File) {
    const name = file.name.replace(/\.[^.]+$/, '')
    setBusy(true)
    try {
      // Dual-register: once from in-memory data (for immediate use), once
      // from the saved path (survives across sessions).
      const buf = await file.arrayBuffer()
      await registerFontFromBuffer(name, buf.slice(0))
      let savedPath = ''
      try {
        savedPath = await window.subforge.saveFont(file.name, buf)
      } catch {
        // Save failed — font still works for this session.
      }
      setFonts(prev => {
        if (prev.some(f => f.name === name)) return prev
        return [{ name, path: savedPath, bundled: false }, ...prev]
      })
      onChange(name, savedPath)
    } finally {
      setBusy(false)
    }
  }

  function handleUploadClick() {
    inputRef.current?.click()
  }

  async function handleDelete(font: FontInfo, e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!window.subforge?.deleteFont || !font.path) return
    if (!window.confirm(`Delete font "${font.name}"?`)) return
    setBusy(true)
    try {
      const ok = await window.subforge.deleteFont(font.path)
      if (ok) {
        setFonts(prev => prev.filter(f => f.path !== font.path))
        if (value === font.name) onChange('', '')
      }
    } finally {
      setBusy(false)
    }
  }

  function handleSelectChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const opt = fonts.find(f => f.name === e.target.value)
    if (opt) onChange(opt.name, opt.path)
    else onChange('', '')
  }

  const selectedIsCustom = fonts.find(f => f.name === value)?.bundled === false

  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span className="w-[72px] shrink-0 text-xs text-[var(--color-text-2)]">Font</span>
      <select
        className="field-input flex-1 min-w-0 text-xs"
        value={value}
        onChange={handleSelectChange}
        disabled={loading || busy}
        // Preview the currently selected font in the collapsed <select>
        style={value ? { fontFamily: `"${value}", sans-serif` } : undefined}
      >
        {loading && <option>Loading…</option>}
        {!loading && <option value="">System default</option>}
        {fonts.map(f => (
          <option
            key={`${f.name}|${f.path}`}
            value={f.name}
            style={{ fontFamily: `"${f.name}", sans-serif` }}
          >
            {f.bundled ? f.name : `${f.name} ★`}
          </option>
        ))}
      </select>

      {/* Delete (only for user-added fonts, only when one is selected) */}
      {selectedIsCustom && (
        <button
          type="button"
          className="icon-btn shrink-0"
          title="Delete this custom font"
          onClick={e => {
            const font = fonts.find(f => f.name === value)
            if (font) void handleDelete(font, e)
          }}
          disabled={busy}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M6.5 1.75V3h3V1.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25ZM11 3V1.75A1.75 1.75 0 0 0 9.25 0h-2.5A1.75 1.75 0 0 0 5 1.75V3H1.75a.75.75 0 0 0 0 1.5h.609l.403 8.05A1.75 1.75 0 0 0 4.51 14.25h6.978a1.75 1.75 0 0 0 1.748-1.7l.403-8.05h.61a.75.75 0 0 0 0-1.5ZM4.5 5.5h7l-.397 7.95a.25.25 0 0 1-.25.25H5.148a.25.25 0 0 1-.25-.25L4.5 5.5Z"/>
          </svg>
        </button>
      )}

      <button
        type="button"
        className="icon-btn shrink-0"
        title="Upload font (.ttf / .otf / .woff / .woff2)"
        onClick={handleUploadClick}
        disabled={busy}
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8.75 1.75a.75.75 0 0 0-1.5 0v5.19L5.03 4.72a.75.75 0 0 0-1.06 1.06l3.5 3.5a.75.75 0 0 0 1.06 0l3.5-3.5a.75.75 0 0 0-1.06-1.06L8.75 6.94V1.75ZM1.5 9.25a.75.75 0 0 1 1.5 0v3.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.75 14h-9.5A1.75 1.75 0 0 1 1.5 12.75v-3.5Z"/>
        </svg>
      </button>

      <input
        ref={inputRef}
        type="file"
        accept=".ttf,.otf,.woff,.woff2"
        className="hidden"
        onChange={async e => {
          const f = e.target.files?.[0]
          if (f) await handleFile(f)
          // Reset so picking the same file again still fires change
          if (inputRef.current) inputRef.current.value = ''
        }}
      />
    </div>
  )
}
