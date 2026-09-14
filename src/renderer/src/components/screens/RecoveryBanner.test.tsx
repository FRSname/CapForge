/**
 * Render test via react-dom/server static markup (the vitest environment is
 * plain node). The banner is a safety net: it must be absent when there is
 * nothing to recover, and must name *when* the snapshot was taken when there is.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { RecoverySnapshot } from '../../hooks/useCrashRecovery'
import { RecoveryBanner } from './RecoveryBanner'

const noop = () => {}

function snapshotAt(savedAt?: number): RecoverySnapshot {
  return { savedAt } as unknown as RecoverySnapshot
}

describe('RecoveryBanner', () => {
  test('renders nothing without a snapshot', () => {
    expect(
      renderToStaticMarkup(<RecoveryBanner snapshot={null} onRestore={noop} onDiscard={noop} />)
    ).toBe('')
  })

  test('offers Restore and Discard for a snapshot', () => {
    // Arrange / Act
    const html = renderToStaticMarkup(
      <RecoveryBanner snapshot={snapshotAt()} onRestore={noop} onDiscard={noop} />
    )

    // Assert
    expect(html).toContain('Unsaved session recovered')
    expect(html).toContain('>Restore</button>')
    expect(html).toContain('>Discard</button>')
  })

  test('names when the snapshot was taken', () => {
    // Arrange
    const savedAt = Date.UTC(2026, 8, 12, 9, 30)

    // Act
    const html = renderToStaticMarkup(
      <RecoveryBanner snapshot={snapshotAt(savedAt)} onRestore={noop} onDiscard={noop} />
    )

    // Assert
    expect(html).toContain(` from ${new Date(savedAt).toLocaleString()}`)
  })
})
