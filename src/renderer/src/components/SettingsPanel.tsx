/**
 * Settings panel — slides in from the right.
 * Ports the #settings-panel sidebar from index.html.
 */

import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { Toggle } from './ui/Toggle'

interface SettingsPanelProps {
  open: boolean
  onClose: () => void
}

interface SystemInfo {
  gpu_name?: string
  cpu_name?: string
  vram_gb?: number
}

export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const [languages, setLanguages] = useState<string[]>([])
  const [language,  setLanguage]  = useState('')
  const [diarize,   setDiarize]   = useState(false)
  const [hfToken,   setHfToken]   = useState('')
  const [sysInfo,   setSysInfo]   = useState<SystemInfo | null>(null)

  useEffect(() => {
    async function init() {
      try {
        const port = await window.subforge.getBackendPort()
        api.setPort(port)
        const [langs, info, savedLang, savedDiarize, savedToken] = await Promise.all([
          api.getLanguages(),
          api.getSystemInfo() as Promise<SystemInfo>,
          window.subforge.getState('language', ''),
          window.subforge.getState('diarize', false),
          window.subforge.getState('hf_token', ''),
        ])
        setLanguages(langs)
        setSysInfo(info)
        setLanguage(savedLang as string)
        setDiarize(savedDiarize as boolean)
        setHfToken(savedToken as string)
      } catch { /* backend may not be up yet */ }
    }
    void init()
  }, [])

  async function handleLanguageChange(lang: string) {
    setLanguage(lang)
    await window.subforge.setState('language', lang)
  }

  async function handleDiarizeChange(v: boolean) {
    setDiarize(v)
    await window.subforge.setState('diarize', v)
  }

  async function handleTokenChange(token: string) {
    setHfToken(token)
    await window.subforge.setState('hf_token', token)
  }

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
          onClick={onClose}
        />
      )}

      {/* Panel */}
      <aside
        className="fixed right-0 top-0 bottom-0 z-50 w-72 flex flex-col border-l shadow-2xl transition-transform"
        style={{
          background:    'var(--color-base)',
          borderColor:   'var(--color-border-2)',
          transform:     open ? 'translateX(0)' : 'translateX(100%)',
          transitionDuration: '220ms',
          transitionTimingFunction: 'var(--ease-out-expo)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 shrink-0 border-b"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <span className="font-semibold text-sm">Settings</span>
          <button className="icon-btn" onClick={onClose} aria-label="Close settings">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-5">

          {/* Hardware info */}
          {sysInfo && (
            <div className="rounded-lg p-3 text-xs flex flex-col gap-1" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <span className="label-xs mb-1">Hardware</span>
              {sysInfo.gpu_name ? (
                <>
                  <span style={{ color: 'var(--color-accent-2)' }}>{sysInfo.gpu_name}</span>
                  {sysInfo.vram_gb && <span style={{ color: 'var(--color-text-3)' }}>{sysInfo.vram_gb} GB VRAM</span>}
                </>
              ) : (
                <span style={{ color: 'var(--color-text-2)' }}>CPU mode</span>
              )}
            </div>
          )}

          {/* Language */}
          <div className="flex flex-col gap-2">
            <label className="label-xs">Language</label>
            <select
              className="field-input"
              value={language}
              onChange={e => handleLanguageChange(e.target.value)}
            >
              <option value="">Auto-detect</option>
              {languages.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>

          {/* Diarization */}
          <div className="flex flex-col gap-2">
            <label className="label-xs">Speaker Diarization</label>
            <Toggle
              checked={diarize}
              onChange={handleDiarizeChange}
              label="Identify speakers"
            />
            {diarize && (
              <div className="flex flex-col gap-1.5 mt-1">
                <label className="label-xs">HuggingFace Token</label>
                <input
                  type="password"
                  value={hfToken}
                  onChange={e => handleTokenChange(e.target.value)}
                  placeholder="hf_…"
                  className="field-input text-xs font-mono"
                />
                <p className="text-[11px]" style={{ color: 'var(--color-text-3)' }}>
                  Required for pyannote diarization. Get a token at huggingface.co.
                </p>
              </div>
            )}
          </div>

          {/* Logs */}
          <div className="flex flex-col gap-2">
            <label className="label-xs">Logs</label>
            <div className="flex gap-2">
              <button className="btn-ghost flex-1 text-xs justify-center" onClick={() => window.subforge.openLogsFolder()}>Open folder</button>
              <button className="btn-ghost flex-1 text-xs justify-center" onClick={() => window.subforge.openLogFile()}>Open log</button>
            </div>
          </div>
        </div>
      </aside>
    </>
  )
}
