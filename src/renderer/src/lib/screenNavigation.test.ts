/**
 * The TitleBar's "Library" button: where it shows, what a click plans, and the
 * orchestration rule that a failed flush is reported but never strands the user
 * in the editor.
 */

import { describe, expect, test, vi } from 'vitest'
import type { Screen } from '../types/app'
import {
  NEW_SESSION_SCREEN,
  goToLibrary,
  libraryButtonVisible,
  libraryFlushFailedMessage,
  planGoToLibrary,
} from './screenNavigation'

const ALL_SCREENS: Screen[] = ['library', 'file', 'progress', 'results']

describe('NEW_SESSION_SCREEN', () => {
  test('New lands on the transcribe screen, not the library', () => {
    expect(NEW_SESSION_SCREEN).toBe('file')
  })
})

describe('libraryButtonVisible', () => {
  test('shows on the file and results screens', () => {
    expect(libraryButtonVisible('file')).toBe(true)
    expect(libraryButtonVisible('results')).toBe(true)
  })

  test('hides on the library itself and while a transcription runs', () => {
    expect(libraryButtonVisible('library')).toBe(false)
    expect(libraryButtonVisible('progress')).toBe(false)
  })
})

describe('planGoToLibrary', () => {
  test('flushes the record autosave before leaving the editor', () => {
    expect(planGoToLibrary('results')).toBe('flush-then-library')
  })

  test('a chosen-but-unstarted file has nothing to save', () => {
    expect(planGoToLibrary('file')).toBe('library')
  })

  test('stays put where the button is not offered', () => {
    expect(planGoToLibrary('library')).toBe('stay')
    expect(planGoToLibrary('progress')).toBe('stay')
  })

  test('agrees with the button visibility on every screen', () => {
    for (const screen of ALL_SCREENS) {
      expect(planGoToLibrary(screen) !== 'stay').toBe(libraryButtonVisible(screen))
    }
  })
})

function deps(screen: Screen, flush: () => Promise<void> = () => Promise.resolve()) {
  const order: string[] = []
  return {
    order,
    input: {
      screen,
      flush: vi.fn(async () => {
        order.push('flush')
        await flush()
        order.push('flushed')
      }),
      showLibrary: vi.fn(() => order.push('library')),
      notify: vi.fn((message: string) => order.push(`notify:${message}`)),
    },
  }
}

describe('goToLibrary', () => {
  test('on results: flushes first, then shows the library', async () => {
    const { order, input } = deps('results')

    await goToLibrary(input)

    expect(order).toEqual(['flush', 'flushed', 'library'])
    expect(input.notify).not.toHaveBeenCalled()
  })

  test('on file: shows the library without flushing', async () => {
    const { order, input } = deps('file')

    await goToLibrary(input)

    expect(order).toEqual(['library'])
    expect(input.flush).not.toHaveBeenCalled()
  })

  test('a failed flush is reported and the navigation still happens', async () => {
    const { order, input } = deps('results', () => Promise.reject(new Error('disk full')))

    await goToLibrary(input)

    expect(order).toEqual(['flush', `notify:${libraryFlushFailedMessage('disk full')}`, 'library'])
  })

  test('a non-Error rejection still produces a readable reason', async () => {
    const { input } = deps('results', () => Promise.reject('nope'))

    await goToLibrary(input)

    expect(input.notify).toHaveBeenCalledWith(libraryFlushFailedMessage('nope'))
    expect(input.showLibrary).toHaveBeenCalledTimes(1)
  })

  test('does nothing on the library or progress screens', async () => {
    for (const screen of ['library', 'progress'] as const) {
      const { order, input } = deps(screen)
      await goToLibrary(input)
      expect(order).toEqual([])
    }
  })
})

describe('libraryFlushFailedMessage', () => {
  test('names the reason and says the session is still open', () => {
    const message = libraryFlushFailedMessage('disk full')
    expect(message).toContain('disk full')
    expect(message.toLowerCase()).toContain('library')
  })
})
