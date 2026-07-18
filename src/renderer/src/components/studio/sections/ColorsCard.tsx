import { StudioCard } from '../StudioCard'
import { StudioRow } from '../../ui/StudioRow'
import { ColorSwatch } from '../../ui/ColorSwatch'
import { Row, type StudioSectionProps } from './StudioSectionShared'

/** "Colors" settings card — text/outline/bg/active colors + outline width + drop shadow. */
export function ColorsCard({ s, defaults, filter, set, cardProps }: StudioSectionProps) {
  return (
    <StudioCard title="Colors" {...cardProps('colors')}>
      <Row label="Text" filter={filter}>
        <ColorSwatch label="Text" value={s.textColor} onChange={(v) => set('textColor', v)} />
      </Row>
      <Row label="Outline" filter={filter}>
        <ColorSwatch
          label="Outline"
          value={s.outlineColor}
          onChange={(v) => set('outlineColor', v)}
        />
      </Row>
      <Row label="BG" filter={filter}>
        <ColorSwatch label="BG" value={s.bgColor} onChange={(v) => set('bgColor', v)} />
      </Row>
      <Row label="Active" filter={filter}>
        <ColorSwatch label="Active" value={s.activeColor} onChange={(v) => set('activeColor', v)} />
      </Row>
      <div className="divider" />
      <Row label="Outline W" filter={filter}>
        <StudioRow
          label="Outline W"
          value={s.outlineWidth}
          min={0}
          max={20}
          unit="px"
          def={defaults.outlineWidth}
          onChange={(v) => set('outlineWidth', v)}
        />
      </Row>
      <div className="divider" />
      <Row label="Shadow" filter={filter}>
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="w-[72px] shrink-0 text-xs" style={{ color: 'var(--color-text-2)' }}>
            Shadow
          </span>
          <label
            className="flex items-center gap-1.5 text-xs cursor-pointer"
            style={{ color: 'var(--color-text-2)' }}
          >
            <input
              type="checkbox"
              checked={s.shadowEnabled}
              onChange={(e) => set('shadowEnabled', e.target.checked)}
              className="accent-[var(--color-accent)]"
            />
            {s.shadowEnabled ? 'On' : 'Off'}
          </label>
        </div>
      </Row>
      {s.shadowEnabled && (
        <>
          <Row label="Shadow" filter={filter}>
            <ColorSwatch
              label="Shadow"
              value={s.shadowColor}
              onChange={(v) => set('shadowColor', v)}
            />
          </Row>
          <Row label="Opacity" filter={filter}>
            <StudioRow
              label="Opacity"
              value={Math.round(s.shadowOpacity * 100)}
              min={0}
              max={100}
              unit="%"
              def={80}
              onChange={(v) => set('shadowOpacity', v / 100)}
            />
          </Row>
          <Row label="Blur" filter={filter}>
            <StudioRow
              label="Blur"
              value={s.shadowBlur}
              min={0}
              max={60}
              unit="px"
              def={defaults.shadowBlur}
              onChange={(v) => set('shadowBlur', v)}
            />
          </Row>
          <Row label="Offset X" filter={filter}>
            <StudioRow
              label="Offset X"
              value={s.shadowOffsetX}
              min={-50}
              max={50}
              unit="px"
              def={defaults.shadowOffsetX}
              onChange={(v) => set('shadowOffsetX', v)}
            />
          </Row>
          <Row label="Offset Y" filter={filter}>
            <StudioRow
              label="Offset Y"
              value={s.shadowOffsetY}
              min={-50}
              max={50}
              unit="px"
              def={defaults.shadowOffsetY}
              onChange={(v) => set('shadowOffsetY', v)}
            />
          </Row>
        </>
      )}
    </StudioCard>
  )
}
