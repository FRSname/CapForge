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
import { DEFAULT_PAD_V, CROSSFADE_DUR, DEFAULT_LINE_HEIGHT } from '../lib/renderConstants'
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
  hexToRgb,
  lerpColor,
} from '../lib/overlayGeometry'

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
        const isBase = wSizeScale === 1 && wBold === (fwNum >= 700) && wFontFamily === fontName
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

      // Split into rows
      const maxW = ((settings.maxWidth ?? 90) / 100) * resW
      const rows = splitIntoRows(wm, numLines, maxW, effectiveSpaceW)

      const rowWidths = computeRowWidths(rows, effectiveSpaceW)
      const maxRowW = Math.max(...rowWidths)

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

      // Pre-compute word positions. wordYPos is the *visual centre* of each row
      // (matches backend's center_y for that row). When we draw text we shift to
      // alphabetic baseline; pill / underline / bounce can use it directly.
      const { wordXPos, wordYPos } = computeWordPositions(
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
      if (bgOpacity > 0) {
        ctx.save()
        ctx.globalAlpha = bgOpacity * animAlpha
        ctx.fillStyle = bgColor
        roundRect(ctx, cx - bgW / 2, cy - bgH / 2, bgW, bgH, sr)
        ctx.fill()
        ctx.restore()
      }

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

      // ── Highlight pill (drawn BEFORE words) ─────────────────────
      // The highlight is per-active-word, so per-word overrides for the active
      // word's effective transition + sub-settings apply here.
      {
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
