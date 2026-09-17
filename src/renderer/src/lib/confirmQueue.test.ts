/**
 * The one decision behind `ConfirmProvider`: what happens to a request that is
 * still waiting when a second one arrives. Pure, so it can be tested without a
 * renderer.
 */

import { describe, expect, test, vi } from 'vitest'
import { queueRequest } from './confirmQueue'
import type { Pending } from './confirmQueue'

interface Options {
  title: string
}

function request(title: string): Pending<Options> {
  return { options: { title }, resolve: vi.fn() }
}

describe('queueRequest', () => {
  test('with nothing pending, the new request becomes the pending one', () => {
    // Arrange
    const next = request('first')

    // Act
    const result = queueRequest(null, next)

    // Assert
    expect(result.pending).toBe(next)
    expect(result.superseded).toBeNull()
  })

  test('a second request supersedes the one still waiting', () => {
    // Arrange
    const first = request('first')
    const second = request('second')

    // Act
    const result = queueRequest(first, second)

    // Assert — the caller settles `superseded` as a cancel; the queue only says
    // which one it is, so the decision stays pure.
    expect(result.pending).toBe(second)
    expect(result.superseded).toBe(first)
  })

  test('resolves nothing by itself', () => {
    // Arrange
    const first = request('first')
    const second = request('second')

    // Act
    queueRequest(first, second)

    // Assert
    expect(first.resolve).not.toHaveBeenCalled()
    expect(second.resolve).not.toHaveBeenCalled()
  })
})
