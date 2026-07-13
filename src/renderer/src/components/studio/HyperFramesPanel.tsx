/**
 * HyperFrames ✦ — the "level up" card. Groups everything that drives the rich
 * HyperFrames engine in one place, separate from the classic Pillow render:
 *   - Open in HyperFrames Studio  (scaffold the project + open the local
 *     preview webapp to inspect/refine it — the primary action)
 *   - Render with HyperFrames     (GSAP render of captions + effects)
 *   - Caption style               (classic, or a native registry caption style)
 *   - Effects                     (logo / lower-third / stat / highlight / b-roll)
 *
 * All of this needs Node.js 22+. Effects state lives in App so agent-placed
 * effects mirror in live (see EffectsControls).
 */

import { useEffect, useState } from 'react'
import { StudioCard } from './StudioCard'
import { Button } from '../ui/Button'
import { Select } from '../ui/Select'
import { EffectsControls } from './EffectsPanel'
import { dirname } from '../../lib/render'
import { api } from '../../lib/api'
import { useToast } from '../../hooks/useToast'
import type { EffectClip } from '../../types/app'
import type { RenderController } from '../../hooks/useRender'

interface HyperFramesPanelProps {
  effects: EffectClip[]
  onEffectsChange: (effects: EffectClip[]) => void
  captionStyle: string
  onCaptionStyleChange: (style: string) => void
  audioPath: string
  outputDir: string
  onOutputDir: (dir: string) => void
  render: RenderController
}

export function HyperFramesPanel({
  effects,
  onEffectsChange,
  captionStyle,
  onCaptionStyleChange,
  audioPath,
  outputDir,
  onOutputDir,
  render,
}: HyperFramesPanelProps) {
  const { busy, startRender, openStudio, lastOutputFile } = render
  const { toast } = useToast()
  // Empty outputDir means "Same as source" — derive the source file's folder.
  const effectiveOutputDir = outputDir || dirname(audioPath)
  const [styles, setStyles] = useState<Array<{ name: string; title: string }>>([])
  // Tracks that THIS panel started a HyperFrames render, so the Cancel button
  // shows only for our render — never during a classic Pillow render triggered
  // from another panel (which /api/render-cancel wouldn't stop anyway). `busy`
  // is the shared render flag; `hfRendering` narrows it to our engine.
  const [hfRendering, setHfRendering] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  // null = status not yet known; we only offer the install once we know it's missing.
  const [hfReady, setHfReady] = useState<boolean | null>(null)
  const [installing, setInstalling] = useState(false)
  const [installMsg, setInstallMsg] = useState('')
  // Co-author mode: null = status not yet known.
  const [coauthor, setCoauthor] = useState<boolean | null>(null)
  const [coauthorBusy, setCoauthorBusy] = useState(false)

  useEffect(() => {
    api
      .listCaptionStyles()
      .then(setStyles)
      .catch(() => {
        /* picker is best-effort; the chosen value still renders */
      })
    window.subforge.hyperframes
      .status()
      .then((s) => setHfReady(s.hyperframesReady))
      .catch(() => setHfReady(null))
    api
      .getCoauthor()
      .then((s) => setCoauthor(s.coauthor))
      .catch(() => setCoauthor(null))
  }, [])

  // The shared controller flips busy=false on every terminal state (done /
  // error / idle-after-cancel). Mirror how the panel's other buttons re-enable
  // off `busy` and drop our local in-flight flags there too.
  useEffect(() => {
    if (!busy) {
      setHfRendering(false)
      setCancelling(false)
    }
  }, [busy])

  // Enter/exit co-author mode: the connected agent takes ownership of the
  // HyperFrames project (builds custom effects/animations directly); CapForge
  // keeps the transcript + captions in sync. Entering seeds a starter project.
  const toggleCoauthor = async (enable: boolean) => {
    setCoauthorBusy(true)
    try {
      const s = await api.setCoauthor(enable)
      setCoauthor(s.coauthor)
      toast(
        enable
          ? 'Co-author mode on — the agent now owns this composition.'
          : 'Co-author mode off — CapForge composes again.',
        enable ? 'success' : 'info'
      )
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not change co-author mode.', 'error')
    } finally {
      setCoauthorBusy(false)
    }
  }

  const syncCaptionsIntoProject = async () => {
    setCoauthorBusy(true)
    try {
      await api.syncCaptions()
      toast('Captions synced into the co-author project.', 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not sync captions.', 'error')
    } finally {
      setCoauthorBusy(false)
    }
  }

  // Provision the bundled HyperFrames engine (Node + CLI + render browser). This
  // is the heavy, opt-in step; it also covers existing installs. The classic
  // Pillow path and a system Node still work whether or not this runs. Returns
  // true once the engine is ready. The backend resolves the freshly provisioned
  // Node/CLI on its next call (paths are injected at spawn, checked lazily), so
  // no app restart is needed.
  const provision = async (): Promise<boolean> => {
    setInstalling(true)
    setInstallMsg('Starting…')
    const off = window.subforge.hyperframes.onProvisionProgress((p) => setInstallMsg(p.message))
    try {
      const res = await window.subforge.hyperframes.provision()
      if (res.ok) {
        setHfReady(true)
        toast('HyperFrames is ready.', 'success')
        return true
      }
      toast(res.error || 'HyperFrames setup failed.', 'error')
      return false
    } catch {
      toast('HyperFrames setup failed.', 'error')
      return false
    } finally {
      off()
      setInstalling(false)
    }
  }

  // Render button: if the engine isn't provisioned yet, run the one-time setup
  // first, then render. Only auto-provisions when we *know* it's missing
  // (hfReady === false); if status is unknown we attempt the render and let the
  // backend report what's missing.
  const renderWithHyperframes = async () => {
    if (hfReady === false && !(await provision())) return
    // Preflight the CLI version: refuse up front on a known-incompatible CLI so
    // the user gets a clear remediation toast instead of a cryptic mid-render
    // failure. A compatible CLI (compat_ok true) or an unknown one (compat_ok
    // null — probe failed) both proceed; status is best-effort and never blocks.
    try {
      const status = await api.getHyperframesStatus()
      if (status.compat_ok === false) {
        toast(status.compat_reasons[0] || 'HyperFrames CLI is out of date.', 'error')
        return
      }
    } catch {
      /* preflight is advisory — a status hiccup must not block a valid render */
    }
    setHfRendering(true)
    startRender({}, effectiveOutputDir, 'hyperframes')
  }

  // Stop the in-progress HyperFrames render. The backend kills the CLI process
  // tree; the export request then resolves with status:"cancelled", which
  // resets the shared controller to idle (busy=false) — clearing our flags via
  // the effect above. Best-effort: a transport hiccup here must not strand the
  // button, since the render's own resolution still resets us.
  const cancelHyperframesRender = async () => {
    setCancelling(true)
    toast('Cancelling render…', 'info')
    try {
      await api.renderCancel()
    } catch {
      /* the backend polls the cancel signal server-side; ignore transport errors */
    }
  }

  return (
    <StudioCard title="HyperFrames ✦" defaultOpen={false}>
      {hfReady === false && (
        <div
          className="mb-2 rounded-md p-2.5"
          style={{
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border)',
          }}
        >
          <p className="text-xs mb-2" style={{ color: 'var(--color-text-2)' }}>
            One-time setup downloads the bundled HyperFrames engine (Node + render browser) so this
            works without installing Node yourself.
          </p>
          <Button
            variant="primary"
            className="w-full justify-center"
            disabled={installing}
            onClick={provision}
            title="Download and install the bundled HyperFrames engine. ~150 MB, one time."
          >
            {installing ? 'Installing…' : 'Install HyperFrames extras'}
          </Button>
          {installing && installMsg && (
            <p
              className="text-2xs mt-1.5 truncate"
              style={{ color: 'var(--color-text-3)' }}
              title={installMsg}
            >
              {installMsg}
            </p>
          )}
        </div>
      )}
      {/* Output folder — chosen before the render; defaults next to the source. */}
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-2xs shrink-0" style={{ color: 'var(--color-text-3)' }}>
          Output:
        </span>
        <span
          className="flex-1 min-w-0 text-[11px] truncate px-1.5 py-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)]"
          style={{ color: 'var(--color-text-2)' }}
          title={outputDir || `Same as source (${effectiveOutputDir})`}
        >
          {outputDir ? outputDir.split(/[\\/]/).pop() || outputDir : 'Same as source'}
        </span>
        <Button
          variant="ghost"
          className="text-[11px] py-1 px-2 shrink-0"
          onClick={async () => {
            const dir = await window.subforge.pickOutputDir()
            if (dir) onOutputDir(dir)
          }}
          disabled={busy}
        >
          Browse
        </Button>
        {outputDir && (
          <Button
            variant="ghost"
            className="text-[11px] py-1 px-2 shrink-0"
            onClick={() => onOutputDir('')}
            disabled={busy}
            title="Reset to Same as source"
          >
            ✕
          </Button>
        )}
      </div>

      <Button
        variant="primary"
        className="w-full justify-center"
        disabled={busy}
        onClick={() => openStudio(effectiveOutputDir)}
        title="Open the generated composition in the local HyperFrames Studio to inspect and refine it in your browser. Requires Node.js 22+."
      >
        Open in HyperFrames Studio ⧉
      </Button>
      <Button
        variant="ghost"
        className="w-full justify-center mt-1.5"
        disabled={busy || installing}
        onClick={renderWithHyperframes}
        title="Render captions + effects with the HyperFrames engine (GSAP animation). First use downloads the bundled engine (~150 MB)."
      >
        {installing ? 'Setting up…' : 'Render with HyperFrames ✦'}
      </Button>
      {hfRendering && busy && (
        <Button
          variant="ghost"
          className="w-full justify-center mt-1.5"
          disabled={cancelling}
          onClick={cancelHyperframesRender}
          title="Stop the in-progress HyperFrames render. The engine's process is terminated and no file is written."
        >
          {cancelling ? 'Cancelling…' : 'Cancel render ✕'}
        </Button>
      )}

      {lastOutputFile && (
        <button
          type="button"
          onClick={() => window.subforge.showInFolder(lastOutputFile)}
          className="mt-1.5 w-full text-[11px] truncate text-left px-1.5 py-1 rounded hover:bg-[var(--color-surface-2)]"
          style={{ color: 'var(--color-text-3)' }}
          title={`Reveal in file browser:\n${lastOutputFile}`}
        >
          ✓ Saved to {lastOutputFile.split(/[\\/]/).pop()} — reveal
        </button>
      )}

      <div className="divider" />
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span
          className="text-2xs uppercase tracking-wider"
          style={{ color: 'var(--color-text-3)' }}
        >
          Co-author
        </span>
        {coauthor && (
          <span
            className="text-2xs px-1.5 py-0.5 rounded-full font-medium"
            style={{ background: 'var(--color-brand-glow)', color: 'var(--color-brand)' }}
          >
            Agent owns this ✦
          </span>
        )}
      </div>
      {coauthor ? (
        <>
          <Button
            variant="ghost"
            className="w-full justify-center"
            disabled={coauthorBusy}
            onClick={syncCaptionsIntoProject}
            title="Refresh CapForge's transcript + captions into the agent's project. Never touches the agent's index.html."
          >
            {coauthorBusy ? 'Working…' : 'Sync captions into project'}
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-center mt-1.5"
            disabled={coauthorBusy}
            onClick={() => toggleCoauthor(false)}
            title="Exit co-author mode — CapForge composes the render from the panel again."
          >
            Exit co-author mode
          </Button>
        </>
      ) : (
        <>
          <p className="text-2xs mb-1.5" style={{ color: 'var(--color-text-3)' }}>
            Hand the HyperFrames project to the connected agent to build custom effects and
            animations directly. CapForge keeps the transcript and captions in sync.
          </p>
          <Button
            variant="ghost"
            className="w-full justify-center"
            disabled={coauthorBusy || coauthor === null}
            onClick={() => toggleCoauthor(true)}
            title="Seed a starter project and let the connected agent author it freely."
          >
            {coauthorBusy ? 'Starting…' : 'Co-author with agent ✦'}
          </Button>
        </>
      )}

      <div className="divider" />
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="w-[72px] shrink-0 text-xs" style={{ color: 'var(--color-text-2)' }}>
          Captions
        </span>
        <Select
          className="flex-1 min-w-0 text-xs"
          value={captionStyle}
          onChange={(e) => onCaptionStyleChange(e.target.value)}
          title="Caption look for the HyperFrames render. Classic is CapForge's built-in track; the rest are native HyperFrames styles."
        >
          {styles.length === 0 && <option value="classic">Classic (CapForge)</option>}
          {styles.map((s) => (
            <option key={s.name} value={s.name}>
              {s.title}
            </option>
          ))}
        </Select>
      </div>

      <div className="divider" />
      <span className="text-2xs uppercase tracking-wider" style={{ color: 'var(--color-text-3)' }}>
        Effects
      </span>
      <EffectsControls effects={effects} onChange={onEffectsChange} />
    </StudioCard>
  )
}
