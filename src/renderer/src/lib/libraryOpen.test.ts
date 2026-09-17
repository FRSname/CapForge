/**
 * `open_video` — the pure half of the agent opening a library record.
 *
 * What matters here is the same thing that matters for the track writes: every
 * refusal must come back as a message a human (and the agent) can act on, and
 * nothing may be installed unless the stored project actually restored. The
 * dispatcher is pinned too, because it is the one place that decides whether a
 * polled command is a track write or a library open.
 */

import { describe, expect, test, vi } from 'vitest'
import type { AgentCommand } from './api'
import {
  OPEN_VIDEO_BUSY_MESSAGE,
  OPEN_VIDEO_NO_ID_MESSAGE,
  applyEchoedCommandWith,
  openVideoFromLibrary,
  openedVideoMessage,
  rejectedProjectMessage,
} from './libraryOpen'

const STORED = { version: 2, transcriptionResult: { segments: [] } }

function deps(overrides: Partial<Parameters<typeof openVideoFromLibrary>[0]> = {}) {
  return {
    videoId: 'vid_1',
    screen: 'results',
    getProject: vi.fn(async () => STORED as unknown),
    restore: vi.fn(async () => true),
    ...overrides,
  }
}

describe('openVideoFromLibrary', () => {
  test('refuses while a transcription is running, without any I/O', async () => {
    const d = deps({ screen: 'progress' })
    await expect(openVideoFromLibrary(d)).rejects.toThrow(OPEN_VIDEO_BUSY_MESSAGE)
    expect(d.getProject).not.toHaveBeenCalled()
    expect(d.restore).not.toHaveBeenCalled()
  })

  test('refuses a missing/blank record id', async () => {
    for (const videoId of ['', '   ']) {
      const d = deps({ videoId })
      await expect(openVideoFromLibrary(d)).rejects.toThrow(OPEN_VIDEO_NO_ID_MESSAGE)
      expect(d.getProject).not.toHaveBeenCalled()
    }
  })

  test('fetches the named record and restores exactly what it answered', async () => {
    const d = deps()
    await openVideoFromLibrary(d)
    expect(d.getProject).toHaveBeenCalledWith('vid_1')
    expect(d.restore).toHaveBeenCalledWith(STORED)
  })

  test('the record id is trimmed before it is fetched', async () => {
    const d = deps({ videoId: '  vid_2  ' })
    expect(await openVideoFromLibrary(d)).toBe(openedVideoMessage('vid_2'))
    expect(d.getProject).toHaveBeenCalledWith('vid_2')
  })

  test('a rejected project throws — the agent never sees a bare success', async () => {
    const d = deps({ restore: vi.fn(async () => false) })
    await expect(openVideoFromLibrary(d)).rejects.toThrow(rejectedProjectMessage('vid_1'))
  })

  test('the fetch error propagates verbatim (the backend 404/409 copy)', async () => {
    const d = deps({
      getProject: vi.fn(async () => {
        throw new Error('Record vid_1 has no session snapshot yet')
      }),
    })
    await expect(openVideoFromLibrary(d)).rejects.toThrow(
      'Record vid_1 has no session snapshot yet'
    )
    expect(d.restore).not.toHaveBeenCalled()
  })

  test('success returns the toast copy naming the record', async () => {
    expect(await openVideoFromLibrary(deps())).toBe('Agent opened a library video (vid_1).')
  })
})

describe('openVideoFromLibrary → onOpening', () => {
  test('names the record the moment the fetch starts, and clears it once installed', async () => {
    const onOpening = vi.fn()
    await openVideoFromLibrary(deps({ onOpening }))
    expect(onOpening.mock.calls).toEqual([['vid_1'], [null]])
  })

  test('clears it when the fetch fails or the restore is rejected', async () => {
    const failures = [
      {
        getProject: vi.fn(async () => {
          throw new Error('gone')
        }),
      },
      { restore: vi.fn(async () => false) },
    ]
    for (const overrides of failures) {
      const onOpening = vi.fn()
      await expect(openVideoFromLibrary(deps({ ...overrides, onOpening }))).rejects.toThrow()
      expect(onOpening.mock.calls).toEqual([['vid_1'], [null]])
    }
  })

  test('is never called for a refusal that does no I/O', async () => {
    const onOpening = vi.fn()
    await expect(openVideoFromLibrary(deps({ screen: 'progress', onOpening }))).rejects.toThrow()
    await expect(openVideoFromLibrary(deps({ videoId: ' ', onOpening }))).rejects.toThrow()
    expect(onOpening).not.toHaveBeenCalled()
  })
})

describe('applyEchoedCommandWith', () => {
  const cmd = (op: string, payload: Record<string, unknown> = {}): AgentCommand => ({ op, payload })

  function dispatch(command: AgentCommand) {
    const applyTrackCommand = vi.fn(() => 'Agent added a Polish caption track.')
    const openVideo = vi.fn(async (id: string) => openedVideoMessage(id))
    return {
      applyTrackCommand,
      openVideo,
      result: applyEchoedCommandWith({ cmd: command, applyTrackCommand, openVideo }),
    }
  }

  test('a track op is applied synchronously, before the promise settles', async () => {
    const d = dispatch(cmd('create_track', { lang: 'pl' }))
    // The track transition is sync: it has already run by the time we get here.
    expect(d.applyTrackCommand).toHaveBeenCalledTimes(1)
    expect(d.openVideo).not.toHaveBeenCalled()
    expect(await d.result).toBe('Agent added a Polish caption track.')
  })

  test('all three track ops route to the track applier', async () => {
    for (const op of ['create_track', 'set_track_text', 'reflow_track']) {
      const d = dispatch(cmd(op, { track_id: 't1' }))
      await d.result
      expect(d.applyTrackCommand).toHaveBeenCalledTimes(1)
    }
  })

  test('open_video routes to the async opener with the payload record id', async () => {
    const d = dispatch(cmd('open_video', { record_id: 'vid_9' }))
    expect(await d.result).toBe(openedVideoMessage('vid_9'))
    expect(d.openVideo).toHaveBeenCalledWith('vid_9')
    expect(d.applyTrackCommand).not.toHaveBeenCalled()
  })

  test('a missing record_id reaches the opener as an empty string, not "undefined"', async () => {
    const d = dispatch(cmd('open_video'))
    await d.result
    expect(d.openVideo).toHaveBeenCalledWith('')
  })

  test('anything else throws rather than being silently dropped', async () => {
    await expect(dispatch(cmd('set_settings')).result).rejects.toThrow(
      'Unknown echoed command "set_settings".'
    )
  })
})
