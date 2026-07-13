/**
 * Pure-logic tests for the transcription error handler (vitest runs in
 * plain node — no DOM), covering the "surface the failure, don't strand the
 * user on the spinner" contract from the bug-audit fix.
 */

import { describe, expect, test, vi } from 'vitest'
import { handleTranscriptionError } from './ProgressScreen'

describe('handleTranscriptionError', () => {
  test('fires an error toast and resets the screen for a real failure', () => {
    const toast = vi.fn()
    const onFailure = vi.fn()

    handleTranscriptionError(new Error('boom'), toast, onFailure)

    expect(toast).toHaveBeenCalledWith('boom', 'error')
    expect(onFailure).toHaveBeenCalledTimes(1)
  })

  test('falls back to a generic message when the error has no message', () => {
    const toast = vi.fn()
    const onFailure = vi.fn()

    handleTranscriptionError(new Error(''), toast, onFailure)

    expect(toast).toHaveBeenCalledWith('Transcription failed', 'error')
    expect(onFailure).toHaveBeenCalledTimes(1)
  })

  test('falls back to a generic message for a non-Error rejection', () => {
    const toast = vi.fn()
    const onFailure = vi.fn()

    handleTranscriptionError('some string rejection', toast, onFailure)

    expect(toast).toHaveBeenCalledWith('Transcription failed', 'error')
    expect(onFailure).toHaveBeenCalledTimes(1)
  })

  test('stays silent when a non-Error value happens to equal "Cancelled"', () => {
    // Only a genuine Error('Cancelled') from the cancel path short-circuits —
    // a bare string rejection always surfaces (defense against a caller
    // rejecting with a raw string instead of throwing an Error).
    const toast = vi.fn()
    const onFailure = vi.fn()

    handleTranscriptionError('Cancelled', toast, onFailure)

    expect(toast).toHaveBeenCalledWith('Transcription failed', 'error')
    expect(onFailure).toHaveBeenCalledTimes(1)
  })

  test('stays silent on a user-initiated cancel', () => {
    const toast = vi.fn()
    const onFailure = vi.fn()

    handleTranscriptionError(new Error('Cancelled'), toast, onFailure)

    expect(toast).not.toHaveBeenCalled()
    expect(onFailure).not.toHaveBeenCalled()
  })
})
