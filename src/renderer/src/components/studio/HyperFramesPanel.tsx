/**
 * HyperFrames ✦ — the "level up" card. Groups everything that drives the rich
 * HyperFrames engine in one place, separate from the classic Pillow render:
 *   - Open in HyperFrames Studio  (scaffold the project + open the local
 *     preview webapp to inspect/refine it — the primary action)
 *   - Render with HyperFrames     (GSAP render of captions + effects)
 *   - Effects                     (logo / lower-third / stat / highlight / b-roll)
 *
 * All three need Node.js 22+. Effects state lives in App so agent-placed effects
 * mirror in live (see EffectsControls).
 */

import { StudioCard } from './StudioCard'
import { Button } from '../ui/Button'
import { EffectsControls } from './EffectsPanel'
import { dirname } from '../../lib/render'
import type { EffectClip } from '../../types/app'
import type { RenderController } from '../../hooks/useRender'

interface HyperFramesPanelProps {
  effects: EffectClip[]
  onEffectsChange: (effects: EffectClip[]) => void
  audioPath: string
  outputDir: string
  render: RenderController
}

export function HyperFramesPanel({
  effects,
  onEffectsChange,
  audioPath,
  outputDir,
  render,
}: HyperFramesPanelProps) {
  const { busy, startRender, openStudio } = render
  const effectiveOutputDir = outputDir || dirname(audioPath)

  return (
    <StudioCard title="HyperFrames ✦" defaultOpen={false}>
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
        disabled={busy}
        onClick={() => startRender({}, effectiveOutputDir, 'hyperframes')}
        title="Render captions + effects with the HyperFrames engine (GSAP animation). Requires Node.js 22+."
      >
        Render with HyperFrames ✦
      </Button>

      <div className="divider" />
      <span className="text-2xs text-[var(--color-text-3)] uppercase tracking-wider">Effects</span>
      <EffectsControls effects={effects} onChange={onEffectsChange} />
    </StudioCard>
  )
}
