import { describe, expect, test } from 'vitest'
import {
  WAVEFORM_SAMPLE_RATE,
  decodeOffline,
  describeWaveformError,
  waveformFailureMessage,
  type DecodedAudio,
  type OfflineContextCtor,
} from './waveformFallback'

function fakeAudio(channels: number, duration: number): DecodedAudio {
  return {
    numberOfChannels: channels,
    duration,
    getChannelData: (i: number) => new Float32Array([i, 0.5, -0.5]),
  }
}

/** A stand-in for OfflineAudioContext that records how it was built. */
function fakeCtor(result: DecodedAudio | Error): {
  Ctor: OfflineContextCtor
  built: number[][]
} {
  const built: number[][] = []
  class Ctx {
    constructor(channels: number, length: number, sampleRate: number) {
      built.push([channels, length, sampleRate])
    }
    decodeAudioData(): Promise<DecodedAudio> {
      return result instanceof Error ? Promise.reject(result) : Promise.resolve(result)
    }
  }
  return { Ctor: Ctx, built }
}

describe('decodeOffline', () => {
  test('decodes at the waveform sample rate without an audio device', async () => {
    const { Ctor, built } = fakeCtor(fakeAudio(2, 17.45))
    const data = await decodeOffline(new ArrayBuffer(8), Ctor)
    expect(built).toEqual([[1, 1, WAVEFORM_SAMPLE_RATE]])
    expect(data.duration).toBe(17.45)
    // One channel is all the waveform draws.
    expect(data.channelData).toHaveLength(1)
    expect(Array.from(data.channelData[0])).toEqual([0, 0.5, -0.5])
  })

  test('a file with no audio channel is refused with a readable reason', async () => {
    const { Ctor } = fakeCtor(fakeAudio(0, 17.45))
    await expect(decodeOffline(new ArrayBuffer(8), Ctor)).rejects.toThrow(/no audio/i)
  })

  test('a zero-length decode is refused', async () => {
    const { Ctor } = fakeCtor(fakeAudio(1, 0))
    await expect(decodeOffline(new ArrayBuffer(8), Ctor)).rejects.toThrow(/no audio/i)
  })

  test('a decoder error is passed on, not swallowed', async () => {
    const { Ctor } = fakeCtor(new Error('Unable to decode audio data'))
    await expect(decodeOffline(new ArrayBuffer(8), Ctor)).rejects.toThrow(
      'Unable to decode audio data'
    )
  })
})

describe('describeWaveformError', () => {
  test('an Error gives its message', () => {
    expect(describeWaveformError(new Error('boom'))).toBe('boom')
  })

  test('an Error with no message gives its name', () => {
    const err = new Error('')
    err.name = 'EncodingError'
    expect(describeWaveformError(err)).toBe('EncodingError')
  })

  test('a MediaError-like object gives its message or its code', () => {
    expect(describeWaveformError({ code: 4, message: 'DEMUXER_ERROR' })).toBe('DEMUXER_ERROR')
    expect(describeWaveformError({ code: 3, message: '' })).toBe('media error 3')
  })

  test('anything else is stringified, and nothing useful says so', () => {
    expect(describeWaveformError('plain')).toBe('plain')
    expect(describeWaveformError(undefined)).toBe('unknown error')
    expect(describeWaveformError(null)).toBe('unknown error')
  })
})

describe('waveformFailureMessage', () => {
  test('names the reason and says what still works', () => {
    const message = waveformFailureMessage(new Error('Unable to decode audio data'))
    expect(message).toContain('Unable to decode audio data')
    expect(message).toMatch(/playback and the caption timeline still work/i)
  })
})
