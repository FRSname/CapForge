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
  const effectiveOutputDir = outputDir || dirname(audioPath)
  const [styles, setStyles] = useState<Array<{ name: string; title: string }>>([])

  useEffect(() => {
    api
      .listCaptionStyles()
      .then(setStyles)
      .catch(() => {
        /* picker is best-effort; the chosen value still renders */
      })
  }, [])

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
