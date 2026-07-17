import { StudioCard } from '../StudioCard'
import { StudioRow } from '../../ui/StudioRow'
import { FontPicker } from '../../ui/FontPicker'
import { Row, type StudioSectionProps } from './StudioSectionShared'

/** "Typography" settings card — font pick, size, tracking. */
export function TypographyCard({
  s,
  defaults,
  filter,
  set,
  setMany,
  cardProps,
}: StudioSectionProps) {
  return (
    <StudioCard title="Typography" {...cardProps('typography')}>
      <Row label="Font" filter={filter}>
        <FontPicker value={s.fontName} onChange={(n, p) => setMany({ fontName: n, fontPath: p })} />
        <div className="divider" />
      </Row>
      <Row label="Size" filter={filter}>
        <StudioRow
          label="Size"
          value={s.fontSize}
          min={50}
          max={220}
          step={1}
          unit="px"
          def={defaults.fontSize}
          onChange={(v) => set('fontSize', v)}
        />
      </Row>
      <Row label="Tracking" filter={filter}>
        <StudioRow
          label="Tracking"
          value={s.tracking}
          min={-5}
          max={20}
          step={0.5}
          unit="px"
          def={defaults.tracking}
          onChange={(v) => set('tracking', v)}
        />
      </Row>
    </StudioCard>
  )
}
