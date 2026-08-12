import { StudioCard } from '../StudioCard'
import { StudioRow } from '../../ui/StudioRow'
import { ColorSwatch } from '../../ui/ColorSwatch'
import { Select } from '../../ui/Select'
import { Row, type StudioSectionProps } from './StudioSectionShared'

/**
 * Is the focus column sitting inside one of the edge-fade ramps?
 *
 * Both dials are percentages of the same caption band, so the left ramp covers
 * `[0, edgeFade)` and the right one `(100 - edgeFade, 100]`. The fade is a
 * property of the band — a window — so a focus column inside a ramp genuinely
 * dims the mode's most important glyph (measured: max alpha 17 at focus column 0
 * with the default 12 % fade). The value is deliberately NOT clamped or rewritten
 * — silently changing what the user typed is worse — so the UI says so instead.
 * See `backend/exporters/rsvp_layout.py` → "The edge fade vs the pivot".
 */
export function isFocusInsideEdgeFade(pivotPct: number, edgeFadePct: number): boolean {
  return edgeFadePct > 0 && (pivotPct < edgeFadePct || pivotPct > 100 - edgeFadePct)
}

/**
 * "Reading" settings card — the caption LAYOUT axis.
 *
 * `readingMode` is orthogonal to the Animation card's word style: 'wrap' draws
 * rows of wrapped words, 'rsvp' draws one unwrapped line that slides so each
 * word's Optimal Recognition Point stays on a fixed pivot column. The six RSVP
 * dials are hidden in wrap mode because nothing reads them there.
 *
 * All four numeric rows pass `commitMax`, because a typed-in value is the one UI
 * path the slider's range doesn't limit — without it, typing `60` into Edge fade
 * stores 0.6 against `le=0.5` and 422s the next render. Each `commitMax` is the
 * `Field(..., le=…)` bound on `VideoRenderConfig` restated in that row's units,
 * the same mirroring contract `lib/settingsSanitize.ts` documents: if a schema
 * bound moves, both move with it.
 *
 * It is deliberately NOT the slider `max`. Slide's slider stops at 0.3s because
 * that is the useful range, while `rsvp_slide_duration` accepts up to 1.0s — so
 * typing 0.5 stays the intended override and only >1 is refused.
 */
export function ReadingCard({ s, defaults, filter, set, cardProps }: StudioSectionProps) {
  const isRsvp = s.readingMode === 'rsvp'
  const focusDimmed = isFocusInsideEdgeFade(s.rsvpPivotX, s.rsvpEdgeFade)

  return (
    <StudioCard title="Reading" defaultOpen={false} {...cardProps('reading')}>
      <Row label="Reading mode" filter={filter}>
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="w-[72px] shrink-0 text-xs" style={{ color: 'var(--color-text-2)' }}>
            Reading mode
          </span>
          <Select
            className="flex-1 min-w-0 text-xs"
            value={s.readingMode}
            onChange={(e) => set('readingMode', e.target.value === 'rsvp' ? 'rsvp' : 'wrap')}
          >
            <option value="wrap">Wrap</option>
            <option value="rsvp">Speed read (RSVP)</option>
          </Select>
        </div>
      </Row>

      {isRsvp && (
        <>
          {/* Honesty about what RSVP takes over — those controls stay editable,
              they just have no effect while this mode is on. */}
          {!filter && (
            <p className="text-2xs leading-snug" style={{ color: 'var(--color-text-3)' }}>
              Speed read ignores Lines (always 1), text alignment (the focus column positions the
              line) and Word style (RSVP colours the words). Entry/Exit animation still applies.
            </p>
          )}
          <Row label="Focus column" filter={filter}>
            <StudioRow
              label="Focus column"
              title="Where the focus letter is pinned, as a % of the caption band width"
              value={s.rsvpPivotX}
              min={0}
              max={100}
              commitMax={100} // rsvp_pivot_x le=1.0, sent through pct()
              unit="%"
              def={defaults.rsvpPivotX}
              onChange={(v) => set('rsvpPivotX', v)}
            />
          </Row>
          <Row label="Slide" filter={filter}>
            <StudioRow
              label="Slide"
              title="How long the line takes to slide to the next word (seconds)"
              value={s.rsvpSlideDuration}
              min={0}
              max={0.3}
              commitMax={1} // rsvp_slide_duration le=1.0, plain seconds — above the slider's 0.3
              step={0.01}
              unit="s"
              def={defaults.rsvpSlideDuration}
              onChange={(v) => set('rsvpSlideDuration', v)}
            />
          </Row>
          <Row label="Context" filter={filter}>
            {/* Stored as a 0–1 fraction; shown as a percentage like the other
                opacity rows (Colors → Opacity, Animation → Opacity). */}
            <StudioRow
              label="Context"
              title="Opacity of the words either side of the focused one"
              value={Math.round(s.rsvpContextOpacity * 100)}
              min={0}
              max={100}
              commitMax={100} // rsvp_context_opacity le=1.0, shown here ×100
              unit="%"
              def={Math.round(defaults.rsvpContextOpacity * 100)}
              onChange={(v) => set('rsvpContextOpacity', v / 100)}
            />
          </Row>
          <Row label="Edge fade" filter={filter}>
            <StudioRow
              label="Edge fade"
              title="Width of the fade at each end of the line, as a % of the band"
              value={s.rsvpEdgeFade}
              min={0}
              max={50}
              commitMax={50} // rsvp_edge_fade le=0.5, sent through pct()
              unit="%"
              def={defaults.rsvpEdgeFade}
              onChange={(v) => set('rsvpEdgeFade', v)}
            />
          </Row>
          {focusDimmed && (
            <p className="text-2xs leading-snug" style={{ color: 'var(--color-brand)' }}>
              Focus column sits inside the edge fade, so the focused letter will be dimmed with the
              rest of the line. Move it further from the edge, or lower Edge fade.
            </p>
          )}
          <Row label="Focus color" filter={filter}>
            <ColorSwatch
              label="Focus color"
              value={s.rsvpFocusColor}
              onChange={(v) => set('rsvpFocusColor', v)}
            />
          </Row>
          <Row label="Reticle" filter={filter}>
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="w-[72px] shrink-0 text-xs" style={{ color: 'var(--color-text-2)' }}>
                Reticle
              </span>
              <label
                className="flex items-center gap-1.5 text-xs cursor-pointer"
                style={{ color: 'var(--color-text-2)' }}
              >
                <input
                  type="checkbox"
                  checked={s.rsvpReticle}
                  onChange={(e) => set('rsvpReticle', e.target.checked)}
                  className="accent-[var(--color-accent)]"
                />
                {s.rsvpReticle ? 'On' : 'Off'}
              </label>
            </div>
          </Row>
        </>
      )}
    </StudioCard>
  )
}
