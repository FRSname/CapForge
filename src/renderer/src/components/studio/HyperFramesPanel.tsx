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
  render: RenderController
}

export function HyperFramesPanel({
  effects,
  onEffectsChange,
  captionStyle,
  onCaptionStyleChange,
  audioPath,
  outputDir,
  render,
}: HyperFramesPanelProps) {
  const { busy, startRender, openStudio } = render
  const { toast } = useToast()
  const effectiveOutputDir = outputDir || dirname(audioPath)
  const [styles, setStyles] = useState<Array<{ name: string; title: string }>>([])
  // null = status not yet known; we only offer the install once we know it's missing.
  const [hfReady, setHfReady] = useState<boolean | null>(null)
  const [installing, setInstalling] = useState(false)
  const [installMsg, setInstallMsg] = useState('')

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
  }, [])

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
    startRender({}, effectiveOutputDir, 'hyperframes')
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

      <div className="divider" />
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="w-[72px] shrink-0 text-xs text-[var(--color-text-2)]">Captions</span>
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
      <span className="text-2xs text-[var(--color-text-3)] uppercase tracking-wider">Effects</span>
      <EffectsControls effects={effects} onChange={onEffectsChange} />
    </StudioCard>
  )
}
