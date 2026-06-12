/**
 * SafeZoneOverlay — preview-only guide layer showing where TikTok / Reels /
 * Shorts UI chrome overlaps the frame.
 *
 * Rendered as a separate absolutely-positioned layer sized identically to the
 * subtitle overlay canvas (inset-0 of the video wrapper) — deliberately NOT
 * drawn inside useSubtitleOverlay.ts so the preview↔render parity harness is
 * unaffected and the guides can never leak into rendered output.
 *
 * Zones are dimmed margins (scrim) plus a 1px dashed boundary marking the
 * caption-safe region. All colors come from theme CSS vars (CLAUDE.md theming
 * rules) so both dark and light themes stay intentional.
 */

import type { CSSProperties } from 'react'
import { SAFE_ZONES, type SafeZonePlatform } from '../../lib/safeZones'

const SCRIM_OPACITY = 0.18

const scrim: CSSProperties = {
  position:   'absolute',
  background: 'var(--color-bg)',
  opacity:    SCRIM_OPACITY,
}

const BOUNDARY = '1px dashed var(--color-amber-2)'

interface SafeZoneOverlayProps {
  platform: SafeZonePlatform
}

export function SafeZoneOverlay({ platform }: SafeZoneOverlayProps) {
  if (platform === 'off') return null
  const zone = SAFE_ZONES[platform]
  const topPct    = `${zone.top * 100}%`
  const bottomPct = `${zone.bottom * 100}%`
  const rightPct  = `${zone.right * 100}%`

  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
      {/* Dimmed chrome margins (top / bottom / right rail between them) */}
      <div style={{ ...scrim, top: 0, left: 0, right: 0, height: topPct }} />
      <div style={{ ...scrim, bottom: 0, left: 0, right: 0, height: bottomPct }} />
      <div style={{ ...scrim, top: topPct, bottom: bottomPct, right: 0, width: rightPct }} />

      {/* Dashed boundary of the caption-safe region */}
      <div
        style={{
          position: 'absolute',
          top:      topPct,
          bottom:   bottomPct,
          left:     0,
          right:    rightPct,
          border:   BOUNDARY,
        }}
      />

      {/* Platform tag inside the safe region */}
      <span
        className="absolute text-2xs px-1.5 py-0.5 rounded"
        style={{
          top:        `calc(${topPct} + 4px)`,
          left:       4,
          background: 'var(--color-bg)',
          color:      'var(--color-amber-2)',
          opacity:    0.85,
        }}
      >
        {zone.label} safe zone
      </span>
    </div>
  )
}
