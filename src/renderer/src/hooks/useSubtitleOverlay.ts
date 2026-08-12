/**
 * Canvas subtitle overlay — full port of drawSubtitleOverlay() from app.js.
 *
 * Draws the active subtitle group in output-resolution coordinates onto a canvas,
 * then uses a CSS transform to fit that canvas inside the displayed video area
 * (same letterbox logic as object-fit:contain).
 *
 * Settings come from StudioSettings (props) instead of DOM references.
 */

import { useCallback, useEffect, useRef } from 'react'
import type { Segment, WordOverrides } from '../types/app'
import type { StudioSettings } from '../components/studio/StudioPanel'
import {
  DEFAULT_PAD_V,
  CROSSFADE_DUR,
  DEFAULT_LINE_HEIGHT,
  RSVP_DEFAULT_CONTEXT_OPACITY,
  RSVP_DEFAULT_EDGE_FADE,
  RSVP_DEFAULT_FOCUS_COLOR,
  RSVP_DEFAULT_PIVOT_X,
  RSVP_DEFAULT_SLIDE_DURATION,
} from '../lib/renderConstants'
import {
  quadEaseOut,
  lerp,
  computeAnimationPhase,
  measureTrackedWidth,
  computeRowLineGap,
  splitIntoRows,
  computeRowWidths,
  computeBgBox,
  computeAlignShift,
  computeWordPositions,
  computeWordProgress,
  computeCrossfadeFactors,
  computeBounceAmount,
  computeRsvpPositions,
  computeRsvpReticleRects,
  rsvpCaptionBand,
  rsvpFadeGradientStops,
  rsvpPivotColumn,
  rsvpTrackingGap,
  rsvpWordAlpha,
  hexToRgb,
  lerpColor,
  type CaptionBand,
} from '../lib/overlayGeometry'
import { focusSlices, orpIndex } from '../lib/rsvp'

export interface OverlayOptions {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  anchorRef: React.RefObject<HTMLElement | null> // video or audio-preview element for sizing
  segments: Segment[]
  settings: StudioSettings
  resolution: [number, number] // output resolution [w, h]
}

export function useSubtitleOverlay({
  canvasRef,
  anchorRef,
  segments,
  settings,
  resolution,
}: OverlayOptions) {
  // Last drawn time, so a resize can repaint the same frame while paused.
  const lastTimeRef = useRef(0)

  const draw = useCallback(
    (currentTime: number) => {
      lastTimeRef.current = currentTime
      const canvas = canvasRef.current
      if (!canvas) return

      const [resW, resH] = resolution

      // Size the backing buffer to the output resolution
      if (canvas.width !== resW || canvas.height !== resH) {
        canvas.width = resW
        canvas.height = resH
      }

      const ctx = canvas.getContext('2d')!
      ctx.clearRect(0, 0, resW, resH)

      if (!segments.length) return

      // Scale the canvas CSS size to letterbox-fit inside the anchor element
      const anchor = anchorRef.current
      if (anchor) {
        const layoutW = anchor.offsetWidth || anchor.getBoundingClientRect().width
        const layoutH = anchor.offsetHeight || anchor.getBoundingClientRect().height
        if (layoutW > 0 && layoutH > 0) {
          const cssScale = Math.min(layoutW / resW, layoutH / resH)
          const cssOX = (layoutW - resW * cssScale) / 2
          const cssOY = (layoutH - resH * cssScale) / 2
          canvas.style.width = `${resW}px`
          canvas.style.height = `${resH}px`
          canvas.style.transformOrigin = '0 0'
          canvas.style.transform = `translate(${cssOX}px,${cssOY}px) scale(${cssScale})`
          canvas.style.display = 'block'
        }
      }

      // Find the active group
      let activeGroup: Segment | null = null
      for (const seg of segments) {
        if (seg.start <= currentTime && currentTime < seg.end) {
          activeGroup = seg
          break
        }
      }
      if (!activeGroup) return

      // ── Read settings ───────────────────────────────────────────
      const {
        fontSize: sf,
        fontName,
        fontWeight: fwNum,
        textColor,
        activeColor,
        bgColor,
        bgOpacity: bgOpacityPct,
        outlineColor,
        outlineWidth: sStroke,
        posX,
        posY,
        wordsPerGroup: _wpg,
        lines: numLines,
        bgRadius: sr,
        bgWidthExtra,
        bgHeightExtra,
        animationType: animation,
        animDuration: animDurFrames,
        wordStyle: wordTransition,
      } = settings

      const bgOpacity = bgOpacityPct / 100
      // ── Reading mode (RSVP) ─────────────────────────────────────
      // A LAYOUT mode: it replaces row splitting and word positioning instead of
      // branching inside the per-word draw switch. backend/exporters/rsvp_layout.py
      // is the source of truth for every formula below — read its module docstring
      // first. `?? default` because a restored project may predate these fields.
      const isRsvp = (settings.readingMode ?? 'wrap') === 'rsvp'
      // Pivot + edge fade are 0-100 UI percentages (pct()'d in render.ts);
      // context opacity is already a 0-1 fraction and slide duration is seconds.
      const rsvpPivotFrac = (settings.rsvpPivotX ?? RSVP_DEFAULT_PIVOT_X) / 100
      const rsvpFadeFrac = (settings.rsvpEdgeFade ?? RSVP_DEFAULT_EDGE_FADE) / 100
      const rsvpContextOpacity = settings.rsvpContextOpacity ?? RSVP_DEFAULT_CONTEXT_OPACITY
      const rsvpSlideDuration = settings.rsvpSlideDuration ?? RSVP_DEFAULT_SLIDE_DURATION
      const rsvpFocusColor = settings.rsvpFocusColor || RSVP_DEFAULT_FOCUS_COLOR
      const rsvpReticleOn = settings.rsvpReticle ?? true
      // Bold is no longer a toggle — the user picks the font face directly
      // (e.g. "Inter Bold"). Browser would synthesize fake-bold otherwise, which
      // wouldn't match the Pillow render that just loads the file as-is.
      const fontWeight = 'normal'
      const animDur = animDurFrames / 100
      // Use marginH as-is so the preview matches the backend (which doesn't apply
      // a 12px floor when the user sets 0).
      const padH = settings.marginH
      const padV = settings.marginV ?? DEFAULT_PAD_V

      // ── Animation phase ─────────────────────────────────────────
      const age = currentTime - activeGroup.start
      const remaining = activeGroup.end - currentTime
      const { animAlpha, slideOffset, popScale } = computeAnimationPhase(
        age,
        remaining,
        animDur,
        animation,
        resH
      )

      // ── Font + measure ──────────────────────────────────────────
      // Use real font metrics (ascent + descent of "Ayg") instead of the EM
      // square — matches the backend's PIL textbbox so pill / underline / bounce
      // sit on the visual glyph centre, not the EM centre. This is critical for
      // fonts where the EM box is asymmetric (e.g. BarberChop).
      ctx.font = `${fontWeight} ${sf}px "${fontName || '-apple-system'}", sans-serif`
      ctx.textBaseline = 'alphabetic'
      ctx.textAlign = 'left'

      const aygMetrics = ctx.measureText('Ayg')
      const ascent = aygMetrics.actualBoundingBoxAscent || sf * 0.8
      const descent = aygMetrics.actualBoundingBoxDescent || sf * 0.2
      const textH = ascent + descent
      const baselineShift = (ascent - descent) / 2 // y-add to put baseline so visual centre = wordY
      // Ascender→ink gap of 'Ayg'. Pillow anchors words on the font ASCENDER line
      // (y = center_y - text_h/2 - bbox[1]), so a font-size-scaled override word
      // lands at rowCenter + (scaled gap - base gap) — NOT baseline-aligned. The
      // per-word draw below mirrors that (HyperFrames does the same).
      const gapBase = (aygMetrics.fontBoundingBoxAscent ?? ascent) - ascent
      const baseFontStr = ctx.font
      const rowLineGap = computeRowLineGap(textH, settings.lineHeight ?? DEFAULT_LINE_HEIGHT)

      const trk = settings.tracking ?? 0

      const measureWord = (text: string) =>
        measureTrackedWidth(text, trk, (s) => ctx.measureText(s).width)

      const baseSpaceW = ctx.measureText(' ').width
      const effectiveSpaceW = baseSpaceW + 0 // word spacing control can be added here

      // Per-word font resolution — mirrors the word-loop font string construction
      // at the draw step below (wBold / wFontFamily / wSizeScale → font string).
      // Centralised here so width + vertical-metric measurement (used for the
      // highlight pill) both key off the identical font string.
      const wordFontInfo = (overrides?: WordOverrides) => {
        const wBold = overrides?.bold ?? fwNum >= 700
        const wFontFamily = overrides?.font_family ?? fontName
        const wSizeScale = overrides?.font_size_scale ?? 1
        const wSize = Math.round(sf * wSizeScale)
        const wWeight = wBold ? 'bold' : 'normal'
        const fontStr = `${wWeight} ${wSize}px "${wFontFamily || '-apple-system'}", sans-serif`
        // Value-level base check: the ctx.font getter normalizes assigned
        // strings (drops quotes / default weight), so comparing fontStr to
        // baseFontStr string-wise never matches. Compare the inputs instead.
        const isBase = wSizeScale === 1 && wBold === fwNum >= 700 && wFontFamily === fontName
        return { fontStr, wSize, isBase }
      }

      // Measure a word's width with ITS OWN font (not the base font) so a
      // font_size_scale/bold/font_family override affects row splitting,
      // x-positions, and every geometry derived from wm[].width. Always
      // restores ctx.font to the base string afterward — leaking a scaled
      // font into the next measurement is the failure mode this guards against.
      const measureWordWidth = (word: string, overrides?: WordOverrides) => {
        const { fontStr, isBase } = wordFontInfo(overrides)
        if (isBase) return measureWord(word)
        ctx.font = fontStr
        const width = measureWord(word)
        ctx.font = baseFontStr
        return width
      }

      // Scaled vertical text height for a word (used by the highlight pill so
      // its rect hugs a scaled active word instead of the global text height).
      // Mirrors the per-word metric block in the word-draw loop below.
      const wordScaledTextH = (overrides?: WordOverrides) => {
        const { fontStr, wSize, isBase } = wordFontInfo(overrides)
        if (isBase) return textH
        ctx.font = fontStr
        const am = ctx.measureText('Ayg')
        const wAsc = am.actualBoundingBoxAscent || wSize * 0.8
        const wDesc = am.actualBoundingBoxDescent || wSize * 0.2
        ctx.font = baseFontStr
        return wAsc + wDesc
      }

      const wm = activeGroup.words.map((w) => ({
        word: w.word,
        width: measureWordWidth(w.word, w.overrides),
        start: w.start,
        end: w.end,
        overrides: w.overrides,
      }))

      // Split into rows. RSVP is a layout mode: exactly ONE unwrapped row,
      // however wide, so `lines` is ignored (mirrors video_render's `is_rsvp`
      // branch, which sets `rows = [all_metrics]`).
      const maxW = ((settings.maxWidth ?? 90) / 100) * resW
      const rows = isRsvp ? [wm] : splitIntoRows(wm, numLines, maxW, effectiveSpaceW)

      const rowWidths = computeRowWidths(rows, effectiveSpaceW)

      // Per-group position override (fractions) beats the global percent setting.
      const gpo = activeGroup.positionOverride
      const effPosX = gpo?.position_x != null ? gpo.position_x * 100 : posX
      const effPosY = gpo?.position_y != null ? gpo.position_y * 100 : posY
      const cx = resW * (effPosX / 100)
      const cy = resH * (effPosY / 100) + slideOffset

      // Slack between bg and text grows when bgWidthExtra/bgHeightExtra > 0;
      // alignment shifts text within that slack. Center/middle = no shift.
      const alignH = settings.textAlignH ?? 'center'
      const alignV = settings.textAlignV ?? 'middle'
      const txOff = settings.textOffsetX ?? 0
      const tyOff = settings.textOffsetY ?? 0
      const { alignShiftX, alignShiftY } = computeAlignShift(
        alignH,
        alignV,
        bgWidthExtra,
        bgHeightExtra
      )

      // The RSVP caption band: `maxW` (the wrap path's usable caption width, NOT a
      // second width concept) centred on the exact column the row's text is placed
      // around. `textAlignH` no longer aligns text inside the row — the pivot does —
      // but it still feeds `alignShiftX`, so it moves the whole band (box, pivot,
      // reticle, fade) whenever bgWidthExtra opens up slack.
      const rowCenterX = cx + alignShiftX + txOff
      const rsvpBand: CaptionBand | null = isRsvp ? rsvpCaptionBand(maxW, rowCenterX) : null
      const rsvpPivotPx = rsvpBand ? rsvpPivotColumn(rsvpBand, rsvpPivotFrac) : 0

      // In RSVP the group background box frames the BAND — the window the line
      // slides inside — never the row: the row is unwrapped and can be far wider
      // than the frame, and a text-sized box is one the caption slides out of.
      const maxRowW = rsvpBand ? rsvpBand.width : Math.max(...rowWidths)
      const bgCenterX = rsvpBand ? rsvpBand.left + rsvpBand.width / 2 : cx

      // Match backend: bg includes stroke padding so the box matches when stroke > 0.
      const strokePad = sStroke
      const { bgW, bgH, totalTextH } = computeBgBox(
        maxRowW,
        padH,
        strokePad,
        bgWidthExtra,
        rows.length,
        textH,
        rowLineGap,
        padV,
        bgHeightExtra
      )

      // Pre-compute word positions. wordYPos is the *visual centre* of each row
      // (matches backend's center_y for that row). When we draw text we shift to
      // alphabetic baseline; pill / underline / bounce can use it directly.
      const rsvp =
        rsvpBand &&
        computeRsvpPositions({
          words: wm,
          // The prefix is measured in the word's OWN font (family/size/bold/custom
          // font override included), so its focus glyph still lands on the pivot.
          measurePrefix: (index, text) => measureWordWidth(text, wm[index].overrides),
          spaceW: effectiveSpaceW,
          tracking: trk,
          pivotPx: rsvpPivotPx,
          slideDuration: rsvpSlideDuration,
          currentTime,
          cy,
          alignShiftY,
          tyOff,
          totalTextH,
          textH,
        })
      const { wordXPos, wordYPos } = rsvp
        ? rsvp
        : computeWordPositions(
            rows,
            rowWidths,
            cx,
            cy,
            alignShiftX,
            alignShiftY,
            txOff,
            tyOff,
            totalTextH,
            textH,
            rowLineGap,
            effectiveSpaceW
          )

      // ── Pop scale transform ─────────────────────────────────────
      if (popScale !== 1) {
        ctx.save()
        ctx.translate(cx, cy)
        ctx.scale(popScale, popScale)
        ctx.translate(-cx, -cy)
      }

      // ── Background ──────────────────────────────────────────────
      // Both unmasked guides are closures because RSVP's edge fade must not touch
      // them: with the fade on they are composited *under* the masked caption after
      // the mask is applied (see the edge-fade block at the end of draw()). The
      // `bgW/bgH > 0` guard is RSVP-only on purpose — bg_*_extra reaches -50 and can
      // invert the box, which Pillow skips; mirroring that on the wrap path would
      // change long-standing preview behaviour, outside this phase's scope.
      const bgVisible = bgOpacity > 0 && (!isRsvp || (bgW > 0 && bgH > 0))
      const drawGroupBg = () => {
        if (!bgVisible) return
        ctx.save()
        ctx.globalAlpha = bgOpacity * animAlpha
        ctx.fillStyle = bgColor
        roundRect(ctx, bgCenterX - bgW / 2, cy - bgH / 2, bgW, bgH, sr)
        ctx.fill()
        ctx.restore()
      }

      // The RSVP pivot reticle: a fixed guide in the focus colour, exempt from the
      // edge fade (Pillow gives it its own unmasked layer for this reason) —
      // otherwise a pivot inside the ramp gets an invisible reticle.
      const drawRsvpReticle = () => {
        if (!rsvp || !rsvpReticleOn) return
        ctx.save()
        ctx.globalAlpha = animAlpha
        ctx.fillStyle = rsvpFocusColor
        for (const r of computeRsvpReticleRects(rsvpPivotPx, rsvp.rowCenterY, textH)) {
          ctx.fillRect(r.x, r.y, r.w, r.h)
        }
        ctx.restore()
      }

      const rsvpFadeStops = rsvpBand ? rsvpFadeGradientStops(rsvpBand, rsvpFadeFrac) : null
      if (!rsvpFadeStops) drawGroupBg()

      // ── Per-effect settings (with safe defaults for older projects) ──
      const hlPadX = settings.highlightPadX ?? 6
      const hlPadY = settings.highlightPadY ?? 6
      const hlRadius = settings.highlightRadius ?? 16
      const hlOpacity = settings.highlightOpacity ?? 0.85
      const ulThick = settings.underlineThickness ?? 4
      const ulColor = settings.underlineColor ?? ''
      const ulOffsetY = settings.underlineOffsetY ?? 2
      const ulWidth = settings.underlineWidth ?? 0
      const bStrength = settings.bounceStrength ?? 0.18
      const sFactor = settings.scaleFactor ?? 1.25
      const hlOffsetX = settings.highlightOffsetX ?? 0
      const hlOffsetY = settings.highlightOffsetY ?? 0

      // ── Per-word background boxes (drawn BEFORE the highlight pill) ──
      // The Background card's BG function scoped to one word: the same rounded
      // rect as the group background, sized to a single word's extents.
      // Transition-independent; decoration only, never mutates layout state.
      // See docs/plans/per-word-background.md
      wm.forEach((m, i) => {
        const ov = m.overrides
        // Enable gate: presence AND value. Opacity alone does NOT inherit — an
        // absent key must not box every word whenever the global bg is on.
        const wBgOpacity = ov?.word_bg_opacity
        if (wBgOpacity == null || wBgOpacity <= 0) return
        const wBgColor = ov?.word_bg_color || bgColor
        const wBgRadius = ov?.word_bg_radius ?? sr
        // The min-pad clamp (stroke never clipped) and the strokePad*2 below are
        // BOTH intentional — the group box double-counts the stroke the same way.
        const wBgPadH = Math.max(ov?.word_bg_padding_h ?? padH, sStroke + 2)
        const wBgPadV = Math.max(ov?.word_bg_padding_v ?? padV, sStroke + 2)
        const wBgWExtra = ov?.word_bg_width_extra ?? bgWidthExtra
        const wBgHExtra = ov?.word_bg_height_extra ?? bgHeightExtra
        const wBgOffX = ov?.word_bg_offset_x ?? 0
        const wBgOffY = ov?.word_bg_offset_y ?? 0

        const wBgTextH = wordScaledTextH(ov)
        const boxW = m.width + wBgPadH * 2 + strokePad * 2 + wBgWExtra
        const boxH = wBgTextH + wBgPadV * 2 + strokePad * 2 + wBgHExtra
        // Degenerate-rect guard: the extras reach -50 and are inherited, so a
        // short word can compute a <= 0 box (PIL raises on an inverted rect) and
        // an empty word would paint a free-floating blob. Pillow + HTML must too.
        if (m.width <= 0 || boxW <= 0 || boxH <= 0) return
        // Centred on the word's drawn position, then nudged by the box offsets.
        // With strokePad / extras at 0 this reduces exactly to the pill rect:
        //   (x - padH, y - h/2 - padV, w + padH*2, h + padV*2).
        const boxCX = wordXPos[i] + (ov?.pos_offset_x ?? 0) + m.width / 2 + wBgOffX
        const boxCY = wordYPos[i] + (ov?.pos_offset_y ?? 0) + wBgOffY

        ctx.save()
        // In RSVP a CONTEXT word's box is dimmed by rsvpContextOpacity — the same
        // factor as its fill and stroke, so a dimmed word never keeps a
        // full-strength box. The anchor word's box matches its undimmed glyphs.
        ctx.globalAlpha =
          wBgOpacity *
          (rsvp ? rsvpWordAlpha(animAlpha, rsvpContextOpacity, i === rsvp.anchorIndex) : animAlpha)
        ctx.fillStyle = wBgColor
        roundRect(ctx, boxCX - boxW / 2, boxCY - boxH / 2, boxW, boxH, wBgRadius)
        ctx.fill()
        ctx.restore()
      })

      // Above the per-word boxes, below the words: Pillow's bg → boxes → guide → text.
      if (!rsvpFadeStops) drawRsvpReticle()

      // ── Highlight pill (drawn BEFORE words) ─────────────────────
      // The highlight is per-active-word, so per-word overrides for the active
      // word's effective transition + sub-settings apply here. Never in RSVP:
      // that mode owns word colouring, so `wordStyle` and all of its
      // sub-settings (pill, underline, bounce, scale) are ignored by design.
      if (!isRsvp) {
        const ai = wm.findIndex((m) => m.start <= currentTime && currentTime < m.end)
        if (ai >= 0) {
          const m = wm[ai]
          const ov = m.overrides
          const wTransActive = ov?.word_transition ?? wordTransition
          if (wTransActive === 'highlight') {
            const targetX = wordXPos[ai] + (ov?.pos_offset_x ?? 0)
            const hlY = wordYPos[ai] + (ov?.pos_offset_y ?? 0)
            let hlX = targetX
            let hlW = m.width
            // Active word's scaled text height — the pill hugs a font_size_scale
            // override the same way the word glyph itself is scaled (Defect A fix).
            let hlH = wordScaledTextH(ov)
            // Slide: lerp the pill from the previous word's raw rect (its x/width,
            // no prev offsets) to the active word's rect — mirrors the backend's
            // _draw_word_list. The backend computes active_idx per wrapped row, so
            // only slide when the previous word sits on the SAME row.
            if (settings.highlightAnim === 'slide' && ai > 0 && wordYPos[ai - 1] === wordYPos[ai]) {
              const wordDur = Math.max(m.end - m.start, 0.001)
              const rawT = (currentTime - m.start) / wordDur
              // fast ease-out: most of the slide happens in first 40% of the word
              const tEase = quadEaseOut(rawT * 2.5)
              const prevX = wordXPos[ai - 1]
              const prevW = wm[ai - 1].width
              const prevH = wordScaledTextH(wm[ai - 1].overrides)
              hlX = lerp(prevX, targetX, tEase)
              hlW = lerp(prevW, m.width, tEase)
              hlH = lerp(prevH, hlH, tEase)
            }
            // Backend enforces min pad = stroke + 2 so the pill always clears the
            // stroke; mirror that here so the preview matches.
            const wHlPadX = Math.max(ov?.highlight_padding_x ?? hlPadX, sStroke + 2)
            const wHlPadY = Math.max(ov?.highlight_padding_y ?? hlPadY, sStroke + 2)
            const wHlRadius = ov?.highlight_radius ?? hlRadius
            const wHlOpac = ov?.highlight_opacity ?? hlOpacity
            // Pill-only offset, applied post-lerp so slide translates rigidly
            // (never folded into targetX / the slide's from-to endpoints).
            const wHlOffX = ov?.highlight_offset_x ?? hlOffsetX
            const wHlOffY = ov?.highlight_offset_y ?? hlOffsetY
            ctx.save()
            ctx.globalAlpha = animAlpha * wHlOpac
            ctx.fillStyle = activeColor
            roundRect(
              ctx,
              hlX + wHlOffX - wHlPadX,
              hlY + wHlOffY - hlH / 2 - wHlPadY,
              hlW + wHlPadX * 2,
              hlH + wHlPadY * 2,
              wHlRadius
            )
            ctx.fill()
            ctx.restore()
          }
        }
      }

      // ── Words ────────────────────────────────────────────────────
      wm.forEach((m, i) => {
        const wOffX = m.overrides?.pos_offset_x ?? 0
        const wOffY = m.overrides?.pos_offset_y ?? 0
        const x = wordXPos[i] + wOffX
        const wy = wordYPos[i] + wOffY
        const isActive = m.start <= currentTime && currentTime < m.end
        const wordProg = computeWordProgress(currentTime, m.start, m.end, isActive)

        const wTextColor = m.overrides?.text_color ?? textColor
        const wActiveColor = m.overrides?.active_word_color ?? activeColor
        const wBold = m.overrides?.bold ?? fwNum >= 700
        const wFontFamily = m.overrides?.font_family ?? fontName
        const wSizeScale = m.overrides?.font_size_scale ?? 1
        const wTransition = m.overrides?.word_transition ?? wordTransition
        // Per-word transition sub-settings — fall back to global if not overridden.
        const wUlThick = m.overrides?.underline_thickness ?? ulThick
        const wUlColor = m.overrides?.underline_color ?? ulColor
        const wUlOffsetY = m.overrides?.underline_offset_y ?? ulOffsetY
        const wUlWidth = m.overrides?.underline_width ?? ulWidth
        const wBStrength = m.overrides?.bounce_strength ?? bStrength
        const wSFactor = m.overrides?.scale_factor ?? sFactor

        ctx.save()
        ctx.globalAlpha = animAlpha

        // Apply per-word font overrides
        const wSize = Math.round(sf * wSizeScale)
        const wWeight = wBold ? 'bold' : 'normal'
        ctx.font = `${wWeight} ${wSize}px "${wFontFamily || '-apple-system'}", sans-serif`

        // Per-word vertical metrics — Pillow's ascender-anchored draw places
        // override-font words at rowCenter + (word gap - base gap) + (a-d)/2;
        // for the base font this reduces to baselineShift exactly.
        let wBaselineShift = baselineShift
        let wTextH = textH
        if (ctx.font !== baseFontStr) {
          const am = ctx.measureText('Ayg')
          const wAsc = am.actualBoundingBoxAscent || wSize * 0.8
          const wDesc = am.actualBoundingBoxDescent || wSize * 0.2
          const wGap = (am.fontBoundingBoxAscent ?? wAsc) - wAsc
          wBaselineShift = wGap - gapBase + (wAsc - wDesc) / 2
          wTextH = wAsc + wDesc
        }

        // Drop shadow — text only (set per-word so it doesn't affect bg/highlight)
        if (settings.shadowEnabled) {
          const sOpacity = settings.shadowOpacity ?? 0.8
          ctx.shadowColor =
            (settings.shadowColor ?? '#000000') +
            Math.round(sOpacity * 255)
              .toString(16)
              .padStart(2, '0')
          ctx.shadowBlur = settings.shadowBlur ?? 8
          ctx.shadowOffsetX = settings.shadowOffsetX ?? 3
          ctx.shadowOffsetY = settings.shadowOffsetY ?? 3
        }

        // Stroke
        if (sStroke > 0) {
          ctx.strokeStyle = outlineColor
          // PIL stroke_width is the full symmetric width; Canvas lineWidth is also
          // symmetric (half inside, half outside the path). Use the same nominal
          // value for closest parity — sub-pixel difference for typical 0-10px strokes.
          ctx.lineWidth = sStroke
          ctx.lineJoin = 'round'
        }

        // wy2 is the visual centre (matches backend's center_y for the row).
        // Convert to alphabetic baseline so text glyphs sit centred on wy2.
        const drawW = (word: string, wx: number, wy2: number) => {
          const by = wy2 + wBaselineShift
          if (trk === 0) {
            if (sStroke > 0) ctx.strokeText(word, wx, by)
            ctx.fillText(word, wx, by)
          } else {
            let cx = wx
            for (let ci = 0; ci < word.length; ci++) {
              const ch = word[ci]
              if (sStroke > 0) ctx.strokeText(ch, cx, by)
              ctx.fillText(ch, cx, by)
              cx += ctx.measureText(ch).width
              if (ci < word.length - 1) cx += trk
            }
          }
        }

        // ── RSVP: one colouring rule, the line's own anchor ────────
        // The coloured word is the word the line is parked on (`anchorIndex` = last
        // word whose `start` has passed) — NOT the `start <= t < end` test the
        // decoration modes use above: that has no answer in inter-word silence, and
        // where the two merely disagree (overlapping timings, a manually reordered
        // group) it colours a word that is not on the pivot column, leaving the
        // reticle marking an empty one. Pillow's draw_line has no `active_idx`.
        if (rsvp) {
          if (i === rsvp.anchorIndex) {
            // Three pieces so the focus glyph's CENTRE lands on the pivot: the pen
            // walks the same advances the layout used (`measureWord` + the one
            // missing tracking gap). Accepted delta, same class as the karaoke
            // branch: kerning is lost across the seams.
            const { prefix, focus, suffix } = focusSlices(m.word, orpIndex(m.word))
            let pen = x
            for (const [piece, color] of [
              [prefix, wActiveColor],
              [focus, rsvpFocusColor],
              [suffix, wActiveColor],
            ] as const) {
              if (!piece) continue
              ctx.fillStyle = color
              drawW(piece, pen, wy)
              pen += measureWord(piece) + rsvpTrackingGap(piece, trk)
            }
          } else {
            // globalAlpha dims fill, stroke AND shadow together — Pillow needs an
            // explicit `_dim_alpha` on its stroke to get the same result.
            ctx.globalAlpha = rsvpWordAlpha(animAlpha, rsvpContextOpacity, false)
            ctx.fillStyle = wTextColor
            drawW(m.word, x, wy)
          }
          ctx.restore()
          return
        }

        switch (wTransition) {
          case 'crossfade': {
            const { fi, fo } = computeCrossfadeFactors(currentTime, m.start, m.end, CROSSFADE_DUR)
            ctx.fillStyle = lerpColor(hexToRgb(wTextColor), hexToRgb(wActiveColor), fi * fo)
            drawW(m.word, x, wy)
            break
          }
          case 'highlight': {
            const hlTextCol = settings.highlightTextColor || bgColor
            ctx.fillStyle = isActive ? hlTextCol : wTextColor
            drawW(m.word, x, wy)
            break
          }
          case 'underline':
            ctx.fillStyle = isActive ? wActiveColor : wTextColor
            drawW(m.word, x, wy)
            if (isActive) {
              ctx.fillStyle = wUlColor || wActiveColor
              const ulW = wUlWidth > 0 ? wUlWidth : m.width
              const ulX = wUlWidth > 0 ? x + (m.width - ulW) / 2 : x
              ctx.fillRect(ulX, wy + wTextH / 2 + wUlOffsetY, ulW, wUlThick)
            }
            break
          case 'bounce': {
            const bounceY = isActive ? wy - computeBounceAmount(textH, wBStrength, wordProg) : wy
            ctx.fillStyle = isActive ? wActiveColor : wTextColor
            drawW(m.word, x, bounceY)
            break
          }
          case 'scale':
            if (isActive) {
              const wordCx = x + m.width / 2
              ctx.translate(wordCx, wy)
              ctx.scale(wSFactor, wSFactor)
              ctx.translate(-wordCx, -wy)
              ctx.fillStyle = wActiveColor
            } else {
              ctx.fillStyle = wTextColor
            }
            drawW(m.word, x, wy)
            break
          case 'karaoke': {
            // Already-spoken words stay in active color; future words in text color.
            const isPast = currentTime >= m.end
            ctx.fillStyle = isPast ? wActiveColor : wTextColor
            drawW(m.word, x, wy)
            if (isActive && wordProg > 0) {
              ctx.save()
              ctx.beginPath()
              ctx.rect(x, wy - wTextH, m.width * wordProg, wTextH * 2)
              ctx.clip()
              ctx.fillStyle = wActiveColor
              drawW(m.word, x, wy)
              ctx.restore()
            }
            break
          }
          case 'reveal':
            if (currentTime >= m.start) {
              ctx.fillStyle = isActive ? wActiveColor : wTextColor
              drawW(m.word, x, wy)
            }
            break
          case 'none':
            ctx.fillStyle = wTextColor
            drawW(m.word, x, wy)
            break
          default: // instant
            ctx.fillStyle = isActive ? wActiveColor : wTextColor
            drawW(m.word, x, wy)
        }

        ctx.restore()
      })

      // ── RSVP edge fade ──────────────────────────────────────────
      // An alpha ramp over the leftmost/rightmost `rsvpEdgeFade` of the band, applied
      // to the caption (words + per-word boxes) as a MASK, never a clip: a word
      // straddling the band edge dissolves instead of being sliced. The two unmasked
      // guides — the group background box, which frames the band rather than sliding
      // inside it, and the reticle — go down afterwards with `destination-over`,
      // which puts them *behind* the already-drawn caption.
      //
      // Two deliberate deviations from Pillow, confined to this branch because one
      // canvas cannot reproduce its four-layer stack: the reticle lands below the
      // per-word background boxes rather than above them (both are behind the text
      // either way, and they only overlap when a box's padding reaches past the
      // reticle's 0.32em clearance); and under the `pop` entry animation the ramp is
      // applied after the pop scale rather than before it, so the band stays in
      // frame coordinates while the ink has already shrunk toward its centre.
      if (rsvpBand && rsvpFadeStops) {
        ctx.save()
        // The band is in frame coordinates, so the mask must ignore the pop
        // transform that may still be active.
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        const bandRight = rsvpBand.left + rsvpBand.width
        const gradient = ctx.createLinearGradient(rsvpBand.left, 0, bandRight, 0)
        for (const [offset, alpha] of rsvpFadeStops) {
          gradient.addColorStop(offset, `rgba(0,0,0,${alpha})`)
        }
        ctx.globalCompositeOperation = 'destination-in'
        ctx.fillStyle = gradient
        // Whole canvas: a gradient extends its terminal stops, so the alpha-0 ends
        // also clear every pixel outside the band.
        ctx.fillRect(0, 0, resW, resH)
        ctx.restore()

        ctx.save()
        ctx.globalCompositeOperation = 'destination-over'
        drawRsvpReticle()
        drawGroupBg()
        ctx.restore()
      }

      if (popScale !== 1) ctx.restore()
    },
    [canvasRef, anchorRef, segments, settings, resolution]
  ) // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fit the letterbox transform when the anchor resizes (flex layout /
  // window changes) — otherwise a paused video keeps a stale canvas scale.
  useEffect(() => {
    const anchor = anchorRef.current
    if (!anchor) return
    const observer = new ResizeObserver(() => draw(lastTimeRef.current))
    observer.observe(anchor)
    return () => observer.disconnect()
  }, [draw, anchorRef])

  return { draw }
}

// ── Helpers ────────────────────────────────────────────────────

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const minR = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + minR, y)
  ctx.lineTo(x + w - minR, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + minR)
  ctx.lineTo(x + w, y + h - minR)
  ctx.quadraticCurveTo(x + w, y + h, x + w - minR, y + h)
  ctx.lineTo(x + minR, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - minR)
  ctx.lineTo(x, y + minR)
  ctx.quadraticCurveTo(x, y, x + minR, y)
  ctx.closePath()
}
