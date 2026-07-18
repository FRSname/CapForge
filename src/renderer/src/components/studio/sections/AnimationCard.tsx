import { StudioCard } from '../StudioCard'
import { StudioRow } from '../../ui/StudioRow'
import { ColorSwatch } from '../../ui/ColorSwatch'
import { Select } from '../../ui/Select'
import { Row, type StudioSectionProps } from './StudioSectionShared'

/** "Animation" settings card — entry/exit + word style + per-effect options. */
export function AnimationCard({ s, defaults, filter, set, cardProps }: StudioSectionProps) {
  return (
    <StudioCard title="Animation" defaultOpen={false} {...cardProps('animation')}>
      <Row label="Entry/Exit" filter={filter}>
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="w-[72px] shrink-0 text-xs" style={{ color: 'var(--color-text-2)' }}>
            Entry/Exit
          </span>
          <Select
            className="flex-1 min-w-0 text-xs"
            value={s.animationType}
            onChange={(e) => set('animationType', e.target.value)}
          >
            <option value="none">None</option>
            <option value="fade">Fade</option>
            <option value="slide">Slide Up</option>
            <option value="pop">Pop</option>
          </Select>
        </div>
      </Row>
      {s.animationType !== 'none' && (
        <Row label="Duration" filter={filter}>
          <StudioRow
            label="Duration"
            value={s.animDuration}
            min={0}
            max={50}
            unit="f"
            def={defaults.animDuration}
            onChange={(v) => set('animDuration', v)}
          />
        </Row>
      )}
      <div className="divider" />
      <Row label="Word style" filter={filter}>
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="w-[72px] shrink-0 text-xs" style={{ color: 'var(--color-text-2)' }}>
            Word style
          </span>
          <Select
            className="flex-1 min-w-0 text-xs"
            value={s.wordStyle}
            onChange={(e) => set('wordStyle', e.target.value)}
          >
            <option value="none">None (static)</option>
            <option value="instant">Instant</option>
            <option value="crossfade">Crossfade</option>
            <option value="highlight">Highlight</option>
            <option value="underline">Underline</option>
            <option value="bounce">Bounce</option>
            <option value="scale">Scale Up</option>
            <option value="karaoke">Karaoke Fill</option>
            <option value="reveal">Reveal</option>
          </Select>
        </div>
      </Row>

      {/* ── Per-effect options ─────────────────────────────── */}
      {s.wordStyle === 'highlight' && (
        <>
          {!filter && (
            <>
              <div className="divider" />
              <span
                className="text-2xs uppercase tracking-wider"
                style={{ color: 'var(--color-text-3)' }}
              >
                Highlight Options
              </span>
            </>
          )}
          <Row label="Text" filter={filter}>
            <ColorSwatch
              label="Text"
              value={s.highlightTextColor || s.bgColor}
              onChange={(v) => set('highlightTextColor', v)}
            />
          </Row>
          <Row label="Radius" filter={filter}>
            <StudioRow
              label="Radius"
              value={s.highlightRadius}
              min={0}
              max={80}
              unit="px"
              def={defaults.highlightRadius}
              onChange={(v) => set('highlightRadius', v)}
            />
          </Row>
          <Row label="Width" filter={filter}>
            <StudioRow
              label="Width"
              value={s.highlightPadX}
              min={0}
              max={40}
              unit="px"
              def={defaults.highlightPadX}
              onChange={(v) => set('highlightPadX', v)}
            />
          </Row>
          <Row label="Height" filter={filter}>
            <StudioRow
              label="Height"
              value={s.highlightPadY}
              min={0}
              max={40}
              unit="px"
              def={defaults.highlightPadY}
              onChange={(v) => set('highlightPadY', v)}
            />
          </Row>
          <Row label="Opacity" filter={filter}>
            <StudioRow
              label="Opacity"
              value={Math.round(s.highlightOpacity * 100)}
              min={0}
              max={100}
              unit="%"
              def={Math.round(defaults.highlightOpacity * 100)}
              onChange={(v) => set('highlightOpacity', v / 100)}
            />
          </Row>
          <Row label="Movement" filter={filter}>
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="w-[72px] shrink-0 text-xs" style={{ color: 'var(--color-text-2)' }}>
                Movement
              </span>
              <Select
                className="flex-1 min-w-0 text-xs"
                value={s.highlightAnim}
                onChange={(e) => set('highlightAnim', e.target.value)}
              >
                <option value="jump">Jump</option>
                <option value="slide">Slide</option>
              </Select>
            </div>
          </Row>
          <Row label="Pill offset X" filter={filter}>
            <StudioRow
              label="Pill offset X"
              value={s.highlightOffsetX}
              min={-100}
              max={100}
              unit="px"
              def={defaults.highlightOffsetX}
              onChange={(v) => set('highlightOffsetX', v)}
            />
          </Row>
          <Row label="Pill offset Y" filter={filter}>
            <StudioRow
              label="Pill offset Y"
              value={s.highlightOffsetY}
              min={-50}
              max={50}
              unit="px"
              def={defaults.highlightOffsetY}
              onChange={(v) => set('highlightOffsetY', v)}
            />
          </Row>
        </>
      )}

      {s.wordStyle === 'underline' && (
        <>
          {!filter && (
            <>
              <div className="divider" />
              <span
                className="text-2xs uppercase tracking-wider"
                style={{ color: 'var(--color-text-3)' }}
              >
                Underline Options
              </span>
            </>
          )}
          <Row label="Thickness" filter={filter}>
            <StudioRow
              label="Thickness"
              value={s.underlineThickness}
              min={1}
              max={30}
              unit="px"
              def={defaults.underlineThickness}
              onChange={(v) => set('underlineThickness', v)}
            />
          </Row>
          <Row label="Offset Y" filter={filter}>
            <StudioRow
              label="Offset Y"
              value={s.underlineOffsetY}
              min={-20}
              max={30}
              unit="px"
              def={defaults.underlineOffsetY}
              onChange={(v) => set('underlineOffsetY', v)}
            />
          </Row>
          <Row label="Width" filter={filter}>
            <StudioRow
              label="Width"
              value={s.underlineWidth}
              min={0}
              max={100}
              unit="px"
              def={defaults.underlineWidth}
              onChange={(v) => set('underlineWidth', v)}
            />
          </Row>
          <Row label="Color" filter={filter}>
            <ColorSwatch
              label="Color"
              value={s.underlineColor || s.activeColor}
              onChange={(v) => set('underlineColor', v)}
            />
          </Row>
        </>
      )}

      {s.wordStyle === 'bounce' && (
        <>
          {!filter && (
            <>
              <div className="divider" />
              <span
                className="text-2xs uppercase tracking-wider"
                style={{ color: 'var(--color-text-3)' }}
              >
                Bounce Options
              </span>
            </>
          )}
          <Row label="Strength" filter={filter}>
            <StudioRow
              label="Strength"
              value={Math.round(s.bounceStrength * 100)}
              min={0}
              max={100}
              unit="%"
              def={Math.round(defaults.bounceStrength * 100)}
              onChange={(v) => set('bounceStrength', v / 100)}
            />
          </Row>
        </>
      )}

      {s.wordStyle === 'scale' && (
        <>
          {!filter && (
            <>
              <div className="divider" />
              <span
                className="text-2xs uppercase tracking-wider"
                style={{ color: 'var(--color-text-3)' }}
              >
                Scale Options
              </span>
            </>
          )}
          <Row label="Factor" filter={filter}>
            <StudioRow
              label="Factor"
              value={Math.round(s.scaleFactor * 100)}
              min={100}
              max={250}
              unit="%"
              def={Math.round(defaults.scaleFactor * 100)}
              onChange={(v) => set('scaleFactor', v / 100)}
            />
          </Row>
        </>
      )}
    </StudioCard>
  )
}
