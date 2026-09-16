/**
 * Settings → Claude & Skills: the MCP connect block, then the skills editor.
 *
 * Moved verbatim out of the old slide-over `SettingsPanel`. `SkillsPanel` gets
 * `open` hard-coded to true because this pane only exists while its category is
 * selected — mounting *is* opening.
 */

import { useEffect, useState } from 'react'
import { useToast } from '../../hooks/useToast'
import { Button } from '../ui/Button'
import { SkillsPanel } from './SkillsPanel'

interface ClaudeClients {
  desktop: boolean
  code: boolean
  runtimeReady: boolean
}

export function ClaudeSettings() {
  const { toast } = useToast()
  const [claudeClients, setClaudeClients] = useState<ClaudeClients | null>(null)

  // `claude` may be absent on an older preload (e.g. after a renderer-only
  // reload). Guard everything so a missing API degrades gracefully instead of
  // crashing the pane.
  useEffect(() => {
    window.subforge.claude
      ?.detect()
      .then(setClaudeClients)
      .catch(() => {
        /* best-effort — section just shows enabled buttons */
      })
  }, [])

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
    <div className="flex flex-col gap-5">
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
        <div data-tour="settings-claude-connect" className="flex gap-2">
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

      {/* Skills — the per-user copies of CapForge's bundled Claude workflows. */}
      <SkillsPanel open />
    </div>
  )
}
