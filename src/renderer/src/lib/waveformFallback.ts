/**
 * What happens when WaveSurfer cannot draw the waveform (issue #80).
 *
 * WaveSurfer decodes the media a second time, on its own, through a *live*
 * `AudioContext` at 8 kHz — a path that depends on the machine's audio output
 * device and is separate from the `<video>` element's playback. When it fails
 * WaveSurfer emits `error`, never `ready`, and draws nothing; the player used
 * to wait on `ready` for its duration, so the caption timeline stayed blank
 * too and nothing told the user why.
 *
 * The recovery, driven from `hooks/useWaveSurfer.ts`:
 *   1. decode again through an `OfflineAudioContext`, which needs no audio
 *      device, and hand WaveSurfer the samples;
 *   2. if that fails as well, give up on the waveform only — the player takes
 *      its duration from the media element and says what went wrong.
 *
 * Kept DOM-free (the context constructor is injected) so vitest can run it in
 * the node environment.
 */

/** WaveSurfer's own decode rate; the waveform needs no more. */
export const WAVEFORM_SAMPLE_RATE = 8000

/** The part of `AudioBuffer` the waveform reads. */
export interface DecodedAudio {
  numberOfChannels: number
  duration: number
  getChannelData: (channel: number) => Float32Array
}

/** The part of `OfflineAudioContext` the fallback uses. */
export type OfflineContextCtor = new (
  channels: number,
  length: number,
  sampleRate: number
) => { decodeAudioData: (data: ArrayBuffer) => Promise<DecodedAudio> }

/** What `WaveSurfer.load(url, channelData, duration)` takes. */
export interface WaveformData {
  channelData: Float32Array[]
  duration: number
}

/**
 * Decode media bytes without an audio device. Rejects with the decoder's own
 * error, or with a readable one when the file holds no audio to draw.
 */
export async function decodeOffline(
  data: ArrayBuffer,
  Ctor: OfflineContextCtor
): Promise<WaveformData> {
  // The context's own length is irrelevant: decodeAudioData only borrows its
  // sample rate, so the smallest legal context will do.
  const decoded = await new Ctor(1, 1, WAVEFORM_SAMPLE_RATE).decodeAudioData(data)
  if (decoded.numberOfChannels < 1 || !(decoded.duration > 0)) {
    throw new Error('the file has no audio track to draw')
  }
  return { channelData: [decoded.getChannelData(0)], duration: decoded.duration }
}

/** A short reason for a toast, from whatever WaveSurfer or the browser threw. */
export function describeWaveformError(err: unknown): string {
  if (err instanceof Error) return err.message || err.name
  if (typeof err === 'string' && err) return err
  if (typeof err === 'object' && err !== null) {
    const { message, code } = err as { message?: unknown; code?: unknown }
    if (typeof message === 'string' && message) return message
    if (typeof code === 'number') return `media error ${code}`
  }
  return 'unknown error'
}

/** The one toast shown when the waveform is given up on. */
export function waveformFailureMessage(err: unknown): string {
  return (
    `Could not draw the waveform (${describeWaveformError(err)}). ` +
    'Playback and the caption timeline still work.'
  )
}
