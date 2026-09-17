/**
 * Static-markup tests (node env, react-dom/server) for the in-app replacement
 * of `window.confirm`. No DOM events here: the buttons' handlers are wired in
 * the component and exercised by `useConfirm`.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ConfirmDialog } from './ConfirmDialog'
import type { ConfirmDialogProps } from './ConfirmDialog'

function dialog(props: Partial<ConfirmDialogProps> = {}): string {
  return renderToStaticMarkup(
    <ConfirmDialog
      open
      title="Delete this preset?"
      body={'"Bold Yellow" is removed.\n\nThis cannot be undone.'}
      onConfirm={() => {}}
      onCancel={() => {}}
      {...props}
    />
  )
}

describe('ConfirmDialog', () => {
  test('closed renders nothing at all', () => {
    expect(dialog({ open: false })).toBe('')
  })

  test('open renders a dialog with the title, the body and both labels', () => {
    const html = dialog()

    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('Delete this preset?')
    expect(html).toContain('This cannot be undone.')
    expect(html).toContain('>Confirm<')
    expect(html).toContain('>Cancel<')
  })

  test('the labels can be named', () => {
    const html = dialog({ confirmLabel: 'Delete', cancelLabel: 'Keep' })

    expect(html).toContain('>Delete<')
    expect(html).toContain('>Keep<')
    expect(html).not.toContain('>Confirm<')
  })

  test('a multi-line body keeps its line breaks', () => {
    expect(dialog()).toContain('whitespace-pre-line')
  })

  test('no body means no body paragraph', () => {
    const html = dialog({ body: undefined })

    expect(html).not.toContain('whitespace-pre-line')
    expect(html).toContain('Delete this preset?')
  })

  test('danger confirms in red, otherwise in the accent', () => {
    expect(dialog({ danger: true })).toContain('btn-danger')
    expect(dialog({ danger: true })).not.toContain('btn-primary')
    expect(dialog()).toContain('btn-primary')
    expect(dialog()).not.toContain('btn-danger')
  })

  test('cancel is the quiet button', () => {
    expect(dialog()).toContain('btn-ghost')
  })

  test('the card is the narrow one, and takes its colours from the theme', () => {
    const html = dialog()

    expect(html).toContain('w-[400px]')
    expect(html).toContain('bg-[var(--color-surface)]')
    expect(html).not.toContain('text-white')
  })
})
