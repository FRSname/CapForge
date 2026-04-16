/**
 * Font picker: lists bundled fonts + custom uploaded fonts.
 * Mirrors the studio-font <select> + custom font upload button from app.js.
 */

import { useEffect, useState } from 'react'

export interface FontOption {
  name: string
  path: string
  bundled?: boolean
}

interface FontPickerProps {
  value: string        // font name
  onChange: (name: string, path: string) => void
}

export function FontPicker({ value, onChange }: FontPickerProps) {
  const [fonts,   setFonts]   = useState<FontOption[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const [bundled, custom] = await Promise.all([
          window.subforge.listBundledFonts(),
          window.subforge.listFonts(),
        ])
        const all: FontOption[] = [
          ...bundled.map(f => ({ ...f, bundled: true  })),
          ...custom.map( f => ({ ...f, bundled: false })),
        ]
        setFonts(all)
      } catch {
        setFonts([])
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [])

  async function handleUpload() {
    // Open file picker via Electron IPC then save the font
    const input = document.createElement('input')
    input.type   = 'file'
    input.accept = '.ttf,.otf,.woff,.woff2'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      const buf  = await file.arrayBuffer()
      const path = await window.subforge.saveFont(file.name, buf)
      const name = file.name.replace(/\.[^.]+$/, '')
      setFonts(prev => [...prev, { name, path }])
      onChange(name, path)
    }
    input.click()
  }

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const opt = fonts.find(f => f.name === e.target.value)
    if (opt) onChange(opt.name, opt.path)
  }

  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span className="w-[72px] shrink-0 text-xs text-[var(--color-text-2)]">Font</span>
      <select
        className="field-input flex-1 min-w-0 text-xs"
        value={value}
        onChange={handleChange}
        disabled={loading}
      >
        {loading && <option>Loading…</option>}
        {fonts.length === 0 && !loading && <option value="">System default</option>}
        {fonts.map(f => (
          <option key={f.path} value={f.name}>{f.name}</option>
        ))}
      </select>
      <button
        type="button"
        className="icon-btn shrink-0"
        title="Upload font (.ttf / .otf)"
        onClick={handleUpload}
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8.75 1.75a.75.75 0 0 0-1.5 0v5.19L5.03 4.72a.75.75 0 0 0-1.06 1.06l3.5 3.5a.75.75 0 0 0 1.06 0l3.5-3.5a.75.75 0 0 0-1.06-1.06L8.75 6.94V1.75ZM1.5 9.25a.75.75 0 0 1 1.5 0v3.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.75 14h-9.5A1.75 1.75 0 0 1 1.5 12.75v-3.5Z"/>
        </svg>
      </button>
    </div>
  )
}
