/**
 * Settings panel — slides in from the right.
 * Ports the #settings-panel sidebar from index.html.
 */

import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { SHORTCUT_SECTIONS } from '../lib/shortcuts'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useToast } from '../hooks/useToast'
import { Toggle } from './ui/Toggle'
import { Button } from './ui/Button'
import { IconButton } from './ui/IconButton'
import { Select } from './ui/Select'

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
  const panelRef = useRef<HTMLElement>(null)
  // Trap focus inside the slide-in panel while open; restores focus on close.
  useFocusTrap(panelRef, open)

  // Escape closes the panel.
  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  const [languages, setLanguages] = useState<string[]>([])
  const [language, setLanguage] = useState('')
  const [diarize, setDiarize] = useState(false)
  const [hfToken, setHfToken] = useState('')
  const [sysInfo, setSysInfo] = useState<SystemInfo | null>(null)
  const { toast } = useToast()
  const [claudeClients, setClaudeClients] = useState<{
    desktop: boolean
    code: boolean
    runtimeReady: boolean
  } | null>(null)
  const [lightMode, setLightMode] = useState(() => {
    const stored = localStorage.getItem('capforge-theme')
    if (stored === 'light') return true
    if (stored === 'dark') return false
    // First launch: follow the OS preference
    return window.matchMedia('(prefers-color-scheme: light)').matches
  })

  // Apply theme class on mount and whenever lightMode changes
  useEffect(() => {
    document.documentElement.classList.toggle('light', lightMode)
    localStorage.setItem('capforge-theme', lightMode ? 'light' : 'dark')
  }, [lightMode])

  useEffect(() => {
    async function init() {
      try {
        const port = await window.subforge.getBackendPort()
        api.setPort(port)
        api.setLocalToken(await window.subforge.getLocalToken())
        const [langs, info, savedLang, savedDiarize, savedToken] = await Promise.all([
          api.getLanguages(),
          api.getSystemInfo() as Promise<SystemInfo>,
          window.subforge.getState('language', ''),
          window.subforge.getState('diarize', false),
          window.subforge.getState('hf_token', ''),
        ])
        setLanguages(Array.isArray(langs) ? langs : [])
        setSysInfo(info)
        setLanguage(savedLang as string)
        setDiarize(savedDiarize as boolean)
        setHfToken(savedToken as string)
      } catch {
        /* backend may not be up yet */
      }
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

  // ── Claude integration (MCP control layer) ──────────────────────
  // `claude` may be absent on an older preload (e.g. after a renderer-only
  // reload). Guard everything so a missing API degrades gracefully instead of
  // crashing the panel.
  useEffect(() => {
    if (!open) return
    window.subforge.claude
      ?.detect()
      .then(setClaudeClients)
      .catch(() => {
        /* best-effort — section just shows enabled buttons */
      })
  }, [open])

  async function handleClaudeConnect(target: 'desktop' | 'code') {
    const claude = window.subforge.claude
    if (!claude) {
      toast('Restart CapForge to enable Claude integration.', 'error')
      return
    }
    const label = target === 'desktop' ? 'Claude Desktop' : 'Claude Code'
    const res = target === 'desktop' ? await claude.connectDesktop() : await claude.connectCode()
    if (res.ok) {
      toast(`Added to ${label} — restart it to load CapForge.`, 'success')
    } else if (res.reason === 'runtime-not-ready') {
      toast('Finish first-run setup first (the AI runtime is still installing).', 'error')
    } else if (res.reason === 'not-installed') {
      toast(`${label} not found. Use "Copy config" to add it manually.`, 'info')
    } else {
      toast(`Couldn't update ${label}. Use "Copy config" instead.`, 'error')
    }
  }

  async function handleClaudeCopyConfig() {
    if (!window.subforge.claude) {
      toast('Restart CapForge to enable Claude integration.', 'error')
      return
    }
    try {
      const cfg = await window.subforge.claude.getManualConfig()
      await navigator.clipboard.writeText(cfg.desktopJson)
      toast('Config copied to clipboard.', 'success')
    } catch {
      toast('Could not copy config.', 'error')
    }
  }

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-[var(--z-panel)] bg-black/40 backdrop-blur-[2px]"
          onClick={onClose}
        />
      )}

      {/* Panel */}
      <aside
        ref={panelRef}
        aria-label="Settings"
        className="fixed right-0 top-0 bottom-0 z-[var(--z-panel)] w-72 flex flex-col border-l shadow-2xl transition-transform bg-[var(--color-base)] border-[var(--color-border-2)]"
        style={{
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transitionDuration: '220ms',
          transitionTimingFunction: 'var(--ease-out-expo)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 shrink-0 border-b border-[var(--color-border)]">
          <span className="font-semibold text-sm">Settings</span>
          <IconButton onClick={onClose} aria-label="Close settings">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
            </svg>
          </IconButton>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-5">
          {/* Hardware info */}
          {sysInfo && (
            <div className="rounded-lg p-3 text-xs flex flex-col gap-1 bg-[var(--color-surface)] border border-[var(--color-border)]">
              <span className="label-xs mb-1">Hardware</span>
              {sysInfo.gpu_name ? (
                <>
                  <span style={{ color: 'var(--color-accent-2)' }}>{sysInfo.gpu_name}</span>
                  {sysInfo.vram_gb && (
                    <span style={{ color: 'var(--color-text-3)' }}>{sysInfo.vram_gb} GB VRAM</span>
                  )}
                </>
              ) : (
                <span style={{ color: 'var(--color-text-2)' }}>CPU mode</span>
              )}
            </div>
          )}

          {/* Language */}
          <div className="flex flex-col gap-2">
            <label className="label-xs">Language</label>
            <Select value={language} onChange={(e) => handleLanguageChange(e.target.value)}>
              <option value="">Auto-detect</option>
              {(Array.isArray(languages) ? languages : []).map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </Select>
          </div>

          {/* Diarization */}
          <div className="flex flex-col gap-2">
            <label className="label-xs">Speaker Diarization</label>
            <Toggle checked={diarize} onChange={handleDiarizeChange} label="Identify speakers" />
            {diarize && (
              <div className="flex flex-col gap-1.5 mt-1">
                <label className="label-xs">HuggingFace Token</label>
                <input
                  type="password"
                  value={hfToken}
                  onChange={(e) => handleTokenChange(e.target.value)}
                  placeholder="hf_…"
                  className="field-input text-xs font-mono"
                />
                <p className="text-[11px]" style={{ color: 'var(--color-text-3)' }}>
                  Required for pyannote diarization. Get a token at huggingface.co.
                </p>
              </div>
            )}
          </div>

          {/* Theme */}
          <div className="flex flex-col gap-2">
            <label className="label-xs">Appearance</label>
            <Toggle
              checked={lightMode}
              onChange={setLightMode}
              label={lightMode ? 'Light Mode' : 'Dark Mode'}
            />
          </div>

          {/* Logs */}
          <div className="flex flex-col gap-2">
            <label className="label-xs">Logs</label>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                className="flex-1 text-xs justify-center"
                onClick={() => window.subforge.openLogsFolder()}
              >
                Open folder
              </Button>
              <Button
                variant="ghost"
                className="flex-1 text-xs justify-center"
                onClick={() => window.subforge.openLogFile()}
              >
                Open log
              </Button>
            </div>
          </div>

          {/* Claude integration (MCP control layer) */}
          <div className="flex flex-col gap-2">
            <label className="label-xs">Claude AI integration</label>
            <p className="text-[11px]" style={{ color: 'var(--color-text-3)' }}>
              Let a Claude agent edit your captions live. Connect once, then restart Claude.
            </p>
            {claudeClients && !claudeClients.runtimeReady && (
              <p className="text-[11px]" style={{ color: 'var(--color-accent-2)' }}>
                Finish first-run setup to enable this.
              </p>
            )}
            <div className="flex gap-2">
              <Button
                variant="ghost"
                className="flex-1 text-xs justify-center"
                disabled={!!claudeClients && !claudeClients.runtimeReady}
                onClick={() => handleClaudeConnect('desktop')}
              >
                Connect Desktop
              </Button>
              <Button
                variant="ghost"
                className="flex-1 text-xs justify-center"
                disabled={!!claudeClients && !claudeClients.runtimeReady}
                onClick={() => handleClaudeConnect('code')}
              >
                Connect Code
              </Button>
            </div>
            <button
              type="button"
              className="text-left text-[11px] underline"
              style={{ color: 'var(--color-text-3)' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--color-text)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--color-text-3)'
              }}
              onClick={handleClaudeCopyConfig}
            >
              Copy config manually
            </button>
          </div>

          {/* Keyboard Shortcuts — rendered from the shared lib/shortcuts.ts
              constant (also drives the `?` ShortcutOverlay). */}
          <div className="flex flex-col gap-3">
            <label className="label-xs">Keyboard Shortcuts</label>
            {SHORTCUT_SECTIONS.map((group) => (
              <div key={group.title} className="flex flex-col gap-0.5">
                <p
                  className="text-2xs uppercase tracking-wider mb-1"
                  style={{ color: 'var(--color-text-3)' }}
                >
                  {group.title}
                </p>
                {group.items.map((item) => (
                  <div key={item.description} className="flex justify-between items-center py-0.5">
                    <span className="text-[11px]" style={{ color: 'var(--color-text-2)' }}>
                      {item.description}
                    </span>
                    <kbd className="kbd">{item.keys.join(' / ')}</kbd>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </aside>
    </>
  )
}
