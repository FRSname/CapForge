/**
 * The provider is exercised through static markup (node env, no DOM), so what
 * is asserted here is the contract the call sites depend on: a component may
 * *read* `useConfirm` without a provider, and only pays for it if it calls it.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ConfirmProvider, useConfirm } from './useConfirm'
import type { ConfirmFn } from './useConfirm'

function Probe({ capture }: { capture: (fn: ConfirmFn) => void }) {
  capture(useConfirm())
  return <span>probe</span>
}

describe('useConfirm', () => {
  test('without a provider, reading it is fine and calling it throws', () => {
    // Arrange
    let confirm: ConfirmFn | null = null

    // Act — rendering must not throw; components are free to read the hook.
    const html = renderToStaticMarkup(<Probe capture={(fn) => (confirm = fn)} />)

    // Assert
    expect(html).toContain('probe')
    expect(() => confirm!({ title: 'Delete?' })).toThrow(/ConfirmProvider/)
  })

  test('the provider hands down a real function and renders its children', () => {
    // Arrange
    let confirm: ConfirmFn | null = null

    // Act
    const html = renderToStaticMarkup(
      <ConfirmProvider>
        <Probe capture={(fn) => (confirm = fn)} />
      </ConfirmProvider>
    )

    // Assert
    expect(html).toContain('probe')
    expect(typeof confirm).toBe('function')
  })

  test('nothing is asked until something asks — no dialog in the initial markup', () => {
    // Arrange / Act
    const html = renderToStaticMarkup(
      <ConfirmProvider>
        <span>app</span>
      </ConfirmProvider>
    )

    // Assert
    expect(html).toContain('app')
    expect(html).not.toContain('role="dialog"')
  })
})
