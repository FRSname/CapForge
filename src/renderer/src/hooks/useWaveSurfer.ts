/**
 * Manages a WaveSurfer v7 instance tied to a container DOM element.
 *
 * For video files: pass a videoEl ref — WaveSurfer attaches as a media controller.
 * For audio-only: pass audioUrl — WaveSurfer handles the HTMLAudioElement itself.
 *
 * Returns imperative controls (play/pause/seek) and reactive state (playing, currentTime).
 *
 * A waveform that cannot be drawn must not take the player down with it (issue
 * #80): on WaveSurfer's `error` the audio is decoded once more without an audio
 * device (`lib/waveformFallback.ts`); if that fails too the hook still reports
 * `ready` with the media element's duration, so the caption timeline and the
 * transport work, and `onError` says why the waveform is missing.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import { WAVEFORM_OPTIONS } from '../lib/waveformOptions'
import { decodeOffline, waveformFailureMessage } from '../lib/waveformFallback'

export interface WaveSurferControls {
  playing: boolean
  currentTime: number
  duration: number
  volume: number
  ready: boolean
  playPause: () => void
  seekTo: (time: number) => void
  setVolume: (volume: number) => void
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
  /** Called with a ready-to-show message when the waveform cannot be drawn. */
  onError?: (message: string) => void
}

export function useWaveSurfer({
  containerRef,
  videoEl,
  audioUrl,
  onTimeUpdate,
  onSeek,
  onScroll,
  onError,
}: UseWaveSurferOptions): WaveSurferControls {
  const wsRef = useRef<WaveSurfer | null>(null)
  const [playing, setPlaying]         = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration]       = useState(0)
  const [volume, setVolumeState]      = useState(1)
  const [ready, setReady]             = useState(false)
  const volumeRef = useRef(1)

  // Stable callback refs — prevents WaveSurfer event listeners from becoming stale
  const onTimeUpdateRef = useRef(onTimeUpdate)
  const onSeekRef       = useRef(onSeek)
  const onScrollRef     = useRef(onScroll)
  const onErrorRef      = useRef(onError)
  useEffect(() => { onTimeUpdateRef.current = onTimeUpdate }, [onTimeUpdate])
  useEffect(() => { onSeekRef.current = onSeek },             [onSeek])
  useEffect(() => { onScrollRef.current = onScroll },         [onScroll])
  useEffect(() => { onErrorRef.current = onError },           [onError])

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
      container: containerRef.current,
      ...WAVEFORM_OPTIONS,
      ...(videoEl ? { media: videoEl } : { url: audioUrl }),
    })

    wsRef.current = ws
    ws.setVolume(volumeRef.current)

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

    // ── Waveform failure ────────────────────────────────────────
    let disposed = false
    let recovery: 'idle' | 'running' | 'done' = 'idle'

    /** Give up on the waveform only: the timeline needs a duration, not peaks. */
    const playWithoutWaveform = (err: unknown) => {
      const becomeReady = () => {
        if (disposed) return
        setDuration(ws.getDuration())
        setReady(true)
      }
      if (ws.getDuration() > 0) becomeReady()
      else ws.getMediaElement().addEventListener('loadedmetadata', becomeReady, { once: true })
      onErrorRef.current?.(waveformFailureMessage(err))
    }

    /** One more decode, this time without an audio device. */
    const recoverWaveform = async (firstError: unknown) => {
      recovery = 'running'
      const media = ws.getMediaElement()
      const url = media.currentSrc || media.src
      try {
        const response = await fetch(url)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = await decodeOffline(await response.arrayBuffer(), OfflineAudioContext)
        if (disposed) return
        // Same URL, so the media element is left alone; 'ready' fires as usual.
        await ws.load(url, data.channelData, data.duration)
      } catch {
        // The first error is the cause; the retry failing only confirms it.
        if (!disposed) playWithoutWaveform(firstError)
      } finally {
        recovery = 'done'
      }
    }

    ws.on('error', (err: unknown) => {
      if (disposed || recovery === 'running') return // the retry reports its own failure
      if (recovery === 'idle') void recoverWaveform(err)
      else onErrorRef.current?.(waveformFailureMessage(err))
    })

    return () => {
      disposed = true
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

  const setVolume = useCallback((nextVolume: number) => {
    const clampedVolume = Math.max(0, Math.min(1, nextVolume))
    volumeRef.current = clampedVolume
    setVolumeState(clampedVolume)
    wsRef.current?.setVolume(clampedVolume)
  }, [])

  const destroy = useCallback(() => {
    wsRef.current?.destroy()
    wsRef.current = null
  }, [])

  return {
    playing,
    currentTime,
    duration,
    volume,
    ready,
    playPause,
    seekTo,
    setVolume,
    destroy,
    wsRef,
  }
}
