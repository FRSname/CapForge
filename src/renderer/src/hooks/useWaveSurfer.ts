/**
 * Manages a WaveSurfer v7 instance tied to a container DOM element.
 *
 * For video files: pass a videoEl ref — WaveSurfer attaches as a media controller.
 * For audio-only: pass audioUrl — WaveSurfer handles the HTMLAudioElement itself.
 *
 * Returns imperative controls (play/pause/seek) and reactive state (playing, currentTime).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'

export interface WaveSurferControls {
  playing: boolean
  currentTime: number
  duration: number
  ready: boolean
  playPause: () => void
  seekTo: (time: number) => void
  destroy: () => void
  wsRef: React.RefObject<WaveSurfer | null>
}

interface UseWaveSurferOptions {
  containerRef: React.RefObject<HTMLElement | null>
  /** For video files — pass the <video> element. */
  videoEl?: HTMLVideoElement | null
  /** For audio-only — pass the stream URL. */
  audioUrl?: string
  onTimeUpdate?: (time: number) => void
  onSeek?: (time: number) => void
  /** Called when the waveform is scrolled; receives the visible start time in seconds. */
  onScroll?: (visibleStartTime: number) => void
}

export function useWaveSurfer({
  containerRef,
  videoEl,
  audioUrl,
  onTimeUpdate,
  onSeek,
  onScroll,
}: UseWaveSurferOptions): WaveSurferControls {
  const wsRef = useRef<WaveSurfer | null>(null)
  const [playing, setPlaying]         = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration]       = useState(0)
  const [ready, setReady]             = useState(false)

  // Stable callback refs — prevents WaveSurfer event listeners from becoming stale
  const onTimeUpdateRef = useRef(onTimeUpdate)
  const onSeekRef       = useRef(onSeek)
  const onScrollRef     = useRef(onScroll)
  useEffect(() => { onTimeUpdateRef.current = onTimeUpdate }, [onTimeUpdate])
  useEffect(() => { onSeekRef.current = onSeek },             [onSeek])
  useEffect(() => { onScrollRef.current = onScroll },         [onScroll])

  useEffect(() => {
    if (!containerRef.current) return
    if (!videoEl && !audioUrl) return

    // Destroy any previous instance
    wsRef.current?.destroy()
    wsRef.current = null
    setPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    setReady(false)

    const ws = WaveSurfer.create({
      container:     containerRef.current,
      waveColor:     '#30363d',
      progressColor: '#4f8ef7',
      cursorColor:   '#4f8ef7',
      barWidth:      2,
      barGap:        1,
      barRadius:     2,
      height:        60,
      ...(videoEl ? { media: videoEl } : { url: audioUrl }),
    })

    wsRef.current = ws

    ws.on('play',  () => setPlaying(true))
    ws.on('pause', () => setPlaying(false))
    ws.on('finish', () => setPlaying(false))

    ws.on('ready', () => {
      setDuration(ws.getDuration())
      setReady(true)
    })

    ws.on('timeupdate', (t: number) => {
      setCurrentTime(t)
      onTimeUpdateRef.current?.(t)
    })

    ws.on('seeking', (t: number) => {
      setCurrentTime(t)
      onSeekRef.current?.(t)
    })

    ws.on('scroll', (visibleStartTime: number) => {
      onScrollRef.current?.(visibleStartTime)
    })

    return () => {
      ws.destroy()
      wsRef.current = null
    }
  // Re-create when the audio source changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, videoEl, audioUrl])

  const playPause = useCallback(() => { wsRef.current?.playPause() }, [])

  const seekTo = useCallback((time: number) => {
    const ws = wsRef.current
    if (!ws) return
    const d = ws.getDuration()
    if (d > 0) ws.seekTo(Math.max(0, Math.min(1, time / d)))
  }, [])

  const destroy = useCallback(() => {
    wsRef.current?.destroy()
    wsRef.current = null
  }, [])

  return { playing, currentTime, duration, ready, playPause, seekTo, destroy, wsRef }
}
