import { StudioCard } from '../StudioCard'
import { StudioRow } from '../../ui/StudioRow'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Row, type StudioSectionProps } from './StudioSectionShared'
import type { StudioSettings } from '../StudioPanel'

const SAFE_ZONE_OPTIONS: Array<{ value: StudioSettings['safeZone']; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'reels', label: 'Reels' },
  { value: 'shorts', label: 'Shorts' },
]

/** "Layout" settings card — words/group, lines, position, max width, safe zones. */
export function LayoutCard({ s, defaults, filter, set, cardProps }: StudioSectionProps) {
  return (
    <StudioCard title="Layout" {...cardProps('layout')}>
      <Row label="Words/Grp" filter={filter}>
        <StudioRow
          label="Words/Grp"
          value={s.wordsPerGroup}
          min={1}
          max={8}
          unit=""
          def={defaults.wordsPerGroup}
          onChange={(v) => set('wordsPerGroup', v)}
        />
      </Row>
      <Row label="Lines" filter={filter}>
        <StudioRow
          label="Lines"
          value={s.lines}
          min={1}
          max={4}
          unit=""
          def={defaults.lines}
          onChange={(v) => set('lines', v)}
        />
      </Row>
      <div className="divider" />
      <Row label="X Pos" filter={filter}>
        <StudioRow
          label="X Pos"
          value={s.posX}
          min={0}
          max={100}
          unit="%"
          def={defaults.posX}
          onChange={(v) => set('posX', v)}
        />
      </Row>
      <Row label="Y Pos" filter={filter}>
        <StudioRow
          label="Y Pos"
          value={s.posY}
          min={10}
          max={95}
          unit="%"
          def={defaults.posY}
          onChange={(v) => set('posY', v)}
        />
      </Row>
      <Row label="Max width" filter={filter}>
        <StudioRow
          label="Max width"
          value={s.maxWidth}
          min={20}
          max={100}
          unit="%"
          def={defaults.maxWidth}
          onChange={(v) => set('maxWidth', v)}
        />
      </Row>
      <div className="divider" />
      {/* Preview-only platform guides — never rendered to video (see safeZone field doc). */}
      <Row label="Safe zones" filter={filter}>
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="w-[72px] shrink-0 text-xs" style={{ color: 'var(--color-text-2)' }}>
            Safe zones
          </span>
          <SegmentedControl
            ariaLabel="Safe zones"
            className="flex-1 min-w-0"
            options={SAFE_ZONE_OPTIONS}
            value={s.safeZone}
            onChange={(v) => set('safeZone', v)}
          />
        </div>
      </Row>
    </StudioCard>
  )
}
