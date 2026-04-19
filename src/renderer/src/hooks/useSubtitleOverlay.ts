/**
 * Canvas subtitle overlay — full port of drawSubtitleOverlay() from app.js.
 *
 * Draws the active subtitle group in output-resolution coordinates onto a canvas,
 * then uses a CSS transform to fit that canvas inside the displayed video area
 * (same letterbox logic as object-fit:contain).
 *
 * Settings come from StudioSettings (props) instead of DOM references.
 */

import { useCallback } from 'react'
import type { Segment } from '../types/app'
import type { StudioSettings } from '../components/studio/StudioPanel'

export interface OverlayOptions {
  canvasRef:  React.RefObject<HTMLCanvasElement | null>
  anchorRef:  React.RefObject<HTMLElement | null>   // video or audio-preview element for sizing
  segments:   Segment[]
  settings:   StudioSettings
  resolution: [number, number]   // output resolution [w, h]
}

export function useSubtitleOverlay({
  canvasRef, anchorRef, segments, settings, resolution,
}: OverlayOptions) {

  const draw = useCallback((currentTime: number) => {
    const canvas = canvasRef.current
    if (!canvas) return

    const [resW, resH] = resolution

    // Size the backing buffer to the output resolution
    if (canvas.width !== resW || canvas.height !== resH) {
      canvas.width  = resW
      canvas.height = resH
    }

    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, resW, resH)

    if (!segments.length) return

    // Scale the canvas CSS size to letterbox-fit inside the anchor element
    const anchor = anchorRef.current
    if (anchor) {
      const layoutW = anchor.offsetWidth  || anchor.getBoundingClientRect().width
      const layoutH = anchor.offsetHeight || anchor.getBoundingClientRect().height
      if (layoutW > 0 && layoutH > 0) {
        const cssScale = Math.min(layoutW / resW, layoutH / resH)
        const cssOX    = (layoutW - resW * cssScale) / 2
        const cssOY    = (layoutH - resH * cssScale) / 2
        canvas.style.width           = `${resW}px`
        canvas.style.height          = `${resH}px`
        canvas.style.transformOrigin = '0 0'
        canvas.style.transform       = `translate(${cssOX}px,${cssOY}px) scale(${cssScale})`
        canvas.style.display         = 'block'
      }
    }

    // Find the active group
    let activeGroup: Segment | null = null
    for (const seg of segments) {
      if (seg.start <= currentTime && currentTime < seg.end) { activeGroup = seg; break }
    }
    if (!activeGroup) return

    // ── Read settings ───────────────────────────────────────────
    const {
      fontSize: sf, fontName, fontWeight: fwNum,
      textColor, activeColor, bgColor, bgOpacity: bgOpacityPct,
      outlineColor, outlineWidth: sStroke,
      posX, posY,
      wordsPerGroup: _wpg, lines: numLines,
      bgRadius: sr, bgWidthExtra, bgHeightExtra,
      animationType: animation, animDuration: animDurFrames,
      wordStyle: wordTransition,
    } = settings

    const bgOpacity  = bgOpacityPct / 100
    const fontWeight = fwNum >= 700 ? 'bold' : 'normal'
    const animDur    = animDurFrames / 100
    // Use marginH as-is so the preview matches the backend (which doesn't apply
    // a 12px floor when the user sets 0).
    const padH = settings.marginH
    const padV = 8

    // ── Animation phase ─────────────────────────────────────────
    const age       = currentTime - activeGroup.start
    const remaining = activeGroup.end - currentTime
    const easeOut   = (v: number) => { v = Math.max(0, Math.min(1, v)); return 1 - (1 - v) ** 2 }
    const entryT = animDur > 0 ? easeOut(age       / animDur) : 1
    const exitT  = animDur > 0 ? easeOut(remaining / animDur) : 1
    const phaseT = Math.min(entryT, exitT)

    let animAlpha  = 1
    let slideOffset = 0
    let popScale   = 1

    if (animation === 'fade')  { animAlpha = phaseT }
    if (animation === 'slide') {
      animAlpha = phaseT
      const slidePx = resH * 0.04
      slideOffset = entryT < 1 ? slidePx * (1 - entryT) : slidePx * (1 - exitT) * -1
    }
    if (animation === 'pop') {
      animAlpha = phaseT
      if (entryT < 1) popScale = 0.85 + 0.15 * entryT
    }

    // ── Font + measure ──────────────────────────────────────────
    // Use real font metrics (ascent + descent of "Ayg") instead of the EM
    // square — matches the backend's PIL textbbox so pill / underline / bounce
    // sit on the visual glyph centre, not the EM centre. This is critical for
    // fonts where the EM box is asymmetric (e.g. BarberChop).
    ctx.font         = `${fontWeight} ${sf}px "${fontName || '-apple-system'}", sans-serif`
    ctx.textBaseline = 'alphabetic'
    ctx.textAlign    = 'left'

    const aygMetrics = ctx.measureText('Ayg')
    const ascent     = aygMetrics.actualBoundingBoxAscent  || sf * 0.8
    const descent    = aygMetrics.actualBoundingBoxDescent || sf * 0.2
    const textH      = ascent + descent
    const baselineShift = (ascent - descent) / 2  // y-add to put baseline so visual centre = wordY
    const rowLineGap = textH * 0.2

    const measureWord = (text: string) => {
      return ctx.measureText(text).width
    }

    const baseSpaceW        = ctx.measureText(' ').width
    const effectiveSpaceW   = baseSpaceW + 0   // word spacing control can be added here

    const wm = activeGroup.words.map(w => ({
      word:      w.word,
      width:     measureWord(w.word),
      start:     w.start,
      end:       w.end,
      overrides: w.overrides,
    }))

    // Split into rows
    const rows: typeof wm[] = []
    if (numLines <= 1) {
      rows.push(wm)
    } else {
      const perRow = Math.ceil(wm.length / numLines)
      for (let r = 0; r < numLines; r++) {
        const slice = wm.slice(r * perRow, (r + 1) * perRow)
        if (slice.length) rows.push(slice)
      }
    }

    const rowWidths = rows.map(row => {
      let w = 0
      row.forEach((m, i) => { w += m.width; if (i < row.length - 1) w += effectiveSpaceW })
      return w
    })
    const maxRowW = Math.max(...rowWidths)

    // Match backend: bg includes stroke padding so the box matches when stroke > 0.
    const strokePad    = sStroke
    const bgW          = maxRowW + padH * 2 + strokePad * 2 + bgWidthExtra
    const totalTextH   = rows.length * textH + (rows.length - 1) * rowLineGap
    const bgH          = totalTextH + padV * 2 + strokePad * 2 + bgHeightExtra
    const cx           = resW * (posX / 100)
    const cy           = resH * (posY / 100) + slideOffset

    // Slack between bg and text grows when bgWidthExtra/bgHeightExtra > 0;
    // alignment shifts text within that slack. Center/middle = no shift.
    const alignH = settings.textAlignH ?? 'center'
    const alignV = settings.textAlignV ?? 'middle'
    const txOff  = settings.textOffsetX ?? 0
    const tyOff  = settings.textOffsetY ?? 0
    const alignShiftX = alignH === 'left'   ? -bgWidthExtra  / 2
                      : alignH === 'right'  ?  bgWidthExtra  / 2 : 0
    const alignShiftY = alignV === 'top'    ? -bgHeightExtra / 2
                      : alignV === 'bottom' ?  bgHeightExtra / 2 : 0

    // Pre-compute word positions. wordYPos is the *visual centre* of each row
    // (matches backend's center_y for that row). When we draw text we shift to
    // alphabetic baseline; pill / underline / bounce can use it directly.
    const wordXPos: number[] = []
    const wordYPos: number[] = []
    rows.forEach((row, ri) => {
      const rowY = cy + alignShiftY + tyOff - totalTextH / 2 + textH / 2 + ri * (textH + rowLineGap)
      let wx = cx + alignShiftX + txOff - rowWidths[ri] / 2
      row.forEach(m => { wordXPos.push(wx); wordYPos.push(rowY); wx += m.width + effectiveSpaceW })
    })

    // ── Pop scale transform ─────────────────────────────────────
    if (popScale !== 1) { ctx.save(); ctx.translate(cx, cy); ctx.scale(popScale, popScale); ctx.translate(-cx, -cy) }

    // ── Background ──────────────────────────────────────────────
    if (bgOpacity > 0) {
      ctx.save()
      ctx.globalAlpha = bgOpacity * animAlpha
      ctx.fillStyle   = bgColor
      roundRect(ctx, cx - bgW / 2, cy - bgH / 2, bgW, bgH, sr)
      ctx.fill()
      ctx.restore()
    }

    // ── Per-effect settings (with safe defaults for older projects) ──
    const hlPadX    = settings.highlightPadX    ?? 6
    const hlPadY    = settings.highlightPadY    ?? 6
    const hlRadius  = settings.highlightRadius  ?? 16
    const hlOpacity = settings.highlightOpacity ?? 0.85
    const ulThick   = settings.underlineThickness ?? 4
    const ulColor   = settings.underlineColor   ?? ''
    const bStrength = settings.bounceStrength    ?? 0.18
    const sFactor   = settings.scaleFactor       ?? 1.25

    // ── Highlight pill (drawn BEFORE words) ─────────────────────
    // The highlight is per-active-word, so per-word overrides for the active
    // word's effective transition + sub-settings apply here.
    {
      const ai = wm.findIndex(m => m.start <= currentTime && currentTime < m.end)
      if (ai >= 0) {
        const m  = wm[ai]
        const ov = m.overrides
        const wTransActive = ov?.word_transition ?? wordTransition
        if (wTransActive === 'highlight') {
          const hlX = wordXPos[ai] + (ov?.pos_offset_x ?? 0)
          const hlY = wordYPos[ai] + (ov?.pos_offset_y ?? 0)
          // Backend enforces min pad = stroke + 2 so the pill always clears the
          // stroke; mirror that here so the preview matches.
          const wHlPadX   = Math.max(ov?.highlight_padding_x ?? hlPadX, sStroke + 2)
          const wHlPadY   = Math.max(ov?.highlight_padding_y ?? hlPadY, sStroke + 2)
          const wHlRadius = ov?.highlight_radius    ?? hlRadius
          const wHlOpac   = ov?.highlight_opacity   ?? hlOpacity
          ctx.save()
          ctx.globalAlpha = animAlpha * wHlOpac
          ctx.fillStyle   = activeColor
          roundRect(ctx, hlX - wHlPadX, hlY - textH / 2 - wHlPadY, m.width + wHlPadX * 2, textH + wHlPadY * 2, wHlRadius)
          ctx.fill()
          ctx.restore()
        }
      }
    }

    // ── Words ────────────────────────────────────────────────────
    wm.forEach((m, i) => {
      const wOffX    = m.overrides?.pos_offset_x ?? 0
      const wOffY    = m.overrides?.pos_offset_y ?? 0
      const x        = wordXPos[i] + wOffX
      const wy       = wordYPos[i] + wOffY
      const isActive = m.start <= currentTime && currentTime < m.end
      const wordDur  = Math.max(m.end - m.start, 0.001)
      const wordProg = isActive ? Math.min(Math.max((currentTime - m.start) / wordDur, 0), 1) : 0

      const wTextColor   = m.overrides?.text_color        ?? textColor
      const wActiveColor = m.overrides?.active_word_color  ?? activeColor
      const wBold        = m.overrides?.bold               ?? (fwNum >= 700)
      const wFontFamily  = m.overrides?.font_family        ?? fontName
      const wSizeScale   = m.overrides?.font_size_scale    ?? 1
      const wTransition  = m.overrides?.word_transition    ?? wordTransition
      // Per-word transition sub-settings — fall back to global if not overridden.
      const wUlThick     = m.overrides?.underline_thickness ?? ulThick
      const wUlColor     = m.overrides?.underline_color     ?? ulColor
      const wBStrength   = m.overrides?.bounce_strength     ?? bStrength
      const wSFactor     = m.overrides?.scale_factor        ?? sFactor

      ctx.save()
      ctx.globalAlpha = animAlpha

      // Apply per-word font overrides
      const wSize   = Math.round(sf * wSizeScale)
      const wWeight = wBold ? 'bold' : 'normal'
      ctx.font = `${wWeight} ${wSize}px "${wFontFamily || '-apple-system'}", sans-serif`

      // Drop shadow — text only (set per-word so it doesn't affect bg/highlight)
      if (settings.shadowEnabled) {
        const sOpacity = settings.shadowOpacity ?? 0.8
        ctx.shadowColor   = (settings.shadowColor ?? '#000000') + Math.round(sOpacity * 255).toString(16).padStart(2, '0')
        ctx.shadowBlur    = settings.shadowBlur    ?? 8
        ctx.shadowOffsetX = settings.shadowOffsetX ?? 3
        ctx.shadowOffsetY = settings.shadowOffsetY ?? 3
      }

      // Stroke
      if (sStroke > 0) {
        ctx.strokeStyle = outlineColor
        ctx.lineWidth   = sStroke * 2
        ctx.lineJoin    = 'round'
      }

      // wy2 is the visual centre (matches backend's center_y for the row).
      // Convert to alphabetic baseline so text glyphs sit centred on wy2.
      const drawW = (word: string, wx: number, wy2: number) => {
        const by = wy2 + baselineShift
        if (sStroke > 0) ctx.strokeText(word, wx, by)
        ctx.fillText(word, wx, by)
      }

      switch (wTransition) {
        case 'crossfade': {
          const CDUR = 0.06
          const fi   = Math.min(Math.max((currentTime - m.start) / CDUR, 0), 1)
          const fo   = Math.min(Math.max((m.end - currentTime)   / CDUR, 0), 1)
          ctx.fillStyle = lerpColor(hexToRgb(wTextColor), hexToRgb(wActiveColor), fi * fo)
          drawW(m.word, x, wy)
          break
        }
        case 'highlight':
          ctx.fillStyle = isActive ? bgColor : wTextColor
          drawW(m.word, x, wy)
          break
        case 'underline':
          ctx.fillStyle = isActive ? wActiveColor : wTextColor
          drawW(m.word, x, wy)
          if (isActive) {
            ctx.fillStyle = wUlColor || wActiveColor
            ctx.fillRect(x, wy + textH / 2 + 2, m.width, wUlThick)
          }
          break
        case 'bounce': {
          const BOUNCE = textH * wBStrength
          const bounceY = isActive ? wy - BOUNCE * Math.sin(wordProg * Math.PI) : wy
          ctx.fillStyle = isActive ? wActiveColor : wTextColor
          drawW(m.word, x, bounceY)
          break
        }
        case 'scale':
          if (isActive) {
            const wordCx = x + m.width / 2
            ctx.translate(wordCx, wy); ctx.scale(wSFactor, wSFactor); ctx.translate(-wordCx, -wy)
            ctx.fillStyle = wActiveColor
          } else {
            ctx.fillStyle = wTextColor
          }
          drawW(m.word, x, wy)
          break
        case 'karaoke':
          ctx.fillStyle = wTextColor
          drawW(m.word, x, wy)
          if (isActive && wordProg > 0) {
            ctx.save()
            ctx.beginPath(); ctx.rect(x, wy - textH, m.width * wordProg, textH * 2); ctx.clip()
            ctx.fillStyle = wActiveColor
            drawW(m.word, x, wy)
            ctx.restore()
          }
          break
        case 'reveal':
          if (currentTime >= m.start) {
            ctx.fillStyle = isActive ? wActiveColor : wTextColor
            drawW(m.word, x, wy)
          }
          break
        default:  // instant
          ctx.fillStyle = isActive ? wActiveColor : wTextColor
          drawW(m.word, x, wy)
      }

      ctx.restore()
    })

    if (popScale !== 1) ctx.restore()
  }, [canvasRef, anchorRef, segments, settings, resolution]) // eslint-disable-line react-hooks/exhaustive-deps

  return { draw }
}

// ── Helpers ────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt((hex.startsWith('#') ? hex.slice(1) : hex), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function lerpColor(c1: [number, number, number], c2: [number, number, number], t: number): string {
  return `rgb(${c1.map((v, i) => Math.round(v + (c2[i] - v) * t)).join(',')})`
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const minR = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + minR, y)
  ctx.lineTo(x + w - minR, y)
  ctx.quadraticCurveTo(x + w, y,     x + w, y + minR)
  ctx.lineTo(x + w, y + h - minR)
  ctx.quadraticCurveTo(x + w, y + h, x + w - minR, y + h)
  ctx.lineTo(x + minR, y + h)
  ctx.quadraticCurveTo(x, y + h,     x, y + h - minR)
  ctx.lineTo(x, y + minR)
  ctx.quadraticCurveTo(x, y,         x + minR, y)
  ctx.closePath()
}
