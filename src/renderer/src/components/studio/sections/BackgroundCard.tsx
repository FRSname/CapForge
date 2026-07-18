import { StudioCard } from '../StudioCard'
import { StudioRow } from '../../ui/StudioRow'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Row, type StudioSectionProps } from './StudioSectionShared'
import type { StudioSettings } from '../StudioPanel'

// Labels are pre-capitalized — the original markup rendered lowercase values
// through CSS `capitalize`, which produces identical glyphs.
const ALIGN_H_OPTIONS: Array<{ value: StudioSettings['textAlignH']; label: string }> = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' },
]

const ALIGN_V_OPTIONS: Array<{ value: StudioSettings['textAlignV']; label: string }> = [
  { value: 'top', label: 'Top' },
  { value: 'middle', label: 'Middle' },
  { value: 'bottom', label: 'Bottom' },
]

/** "Background" settings card — bg box sizing/margins + text-in-box fine-tune. */
export function BackgroundCard({ s, defaults, filter, set, cardProps }: StudioSectionProps) {
  return (
    <StudioCard title="Background" defaultOpen={false} {...cardProps('background')}>
      <Row label="BG opacity" filter={filter}>
        <StudioRow
          label="BG opacity"
          value={s.bgOpacity}
          min={0}
          max={100}
          unit="%"
          def={defaults.bgOpacity}
          onChange={(v) => set('bgOpacity', v)}
        />
      </Row>
      <Row label="BG radius" filter={filter}>
        <StudioRow
          label="BG radius"
          value={s.bgRadius}
          min={0}
          max={80}
          unit="px"
          def={defaults.bgRadius}
          onChange={(v) => set('bgRadius', v)}
        />
      </Row>
      <Row label="BG width +" filter={filter}>
        <StudioRow
          label="BG width +"
          value={s.bgWidthExtra}
          min={-50}
          max={200}
          unit="px"
          def={defaults.bgWidthExtra}
          onChange={(v) => set('bgWidthExtra', v)}
        />
      </Row>
      <Row label="BG height +" filter={filter}>
        <StudioRow
          label="BG height +"
          value={s.bgHeightExtra}
          min={-50}
          max={200}
          unit="px"
          def={defaults.bgHeightExtra}
          onChange={(v) => set('bgHeightExtra', v)}
        />
      </Row>
      <Row label="Margin H" filter={filter}>
        <StudioRow
          label="Margin H"
          value={s.marginH}
          min={0}
          max={25}
          unit="%"
          def={defaults.marginH}
          onChange={(v) => set('marginH', v)}
        />
      </Row>
      <Row label="Margin V" filter={filter}>
        <StudioRow
          label="Margin V"
          value={s.marginV}
          min={0}
          max={50}
          unit="px"
          def={defaults.marginV}
          onChange={(v) => set('marginV', v)}
        />
      </Row>

      {!filter && (
        <>
          <div className="divider" />
          <span
            className="text-2xs uppercase tracking-wider"
            style={{ color: 'var(--color-text-3)' }}
          >
            Text in BG box
          </span>
        </>
      )}

      <Row label="Align H" filter={filter}>
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="w-[72px] shrink-0 text-xs" style={{ color: 'var(--color-text-2)' }}>
            Align H
          </span>
          <SegmentedControl
            ariaLabel="Align horizontal"
            className="flex-1 min-w-0"
            options={ALIGN_H_OPTIONS}
            value={s.textAlignH}
            onChange={(v) => set('textAlignH', v)}
          />
        </div>
      </Row>

      <Row label="Align V" filter={filter}>
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="w-[72px] shrink-0 text-xs" style={{ color: 'var(--color-text-2)' }}>
            Align V
          </span>
          <SegmentedControl
            ariaLabel="Align vertical"
            className="flex-1 min-w-0"
            options={ALIGN_V_OPTIONS}
            value={s.textAlignV}
            onChange={(v) => set('textAlignV', v)}
          />
        </div>
      </Row>

      <Row label="Offset X" filter={filter}>
        <StudioRow
          label="Offset X"
          value={s.textOffsetX}
          min={-100}
          max={100}
          unit="px"
          def={defaults.textOffsetX}
          onChange={(v) => set('textOffsetX', v)}
        />
      </Row>
      <Row label="Offset Y" filter={filter}>
        <StudioRow
          label="Offset Y"
          value={s.textOffsetY}
          min={-50}
          max={50}
          unit="px"
          def={defaults.textOffsetY}
          onChange={(v) => set('textOffsetY', v)}
        />
      </Row>
    </StudioCard>
  )
}
