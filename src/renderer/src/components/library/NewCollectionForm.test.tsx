/**
 * The folder name form and its popover, as static markup (node environment):
 * the slug hint, the inline error, Create disabled until there is a name, and
 * the popover closed by default.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { NewCollectionFormView, NewCollectionPopover } from './NewCollectionForm'

const noop = () => {}
const neverCreates = () => Promise.resolve({ kind: 'failed' as const })

function view(overrides: Partial<React.ComponentProps<typeof NewCollectionFormView>> = {}) {
  return renderToStaticMarkup(
    <NewCollectionFormView
      name=""
      error={null}
      busy={false}
      onNameChange={noop}
      onSubmit={noop}
      onCancel={noop}
      {...overrides}
    />
  )
}

describe('NewCollectionFormView', () => {
  test('a name input with Create and Cancel', () => {
    const html = view()
    expect(html).toContain('aria-label="Folder name"')
    expect(html).toContain('maxLength="120"')
    expect(html).toContain('>Create<')
    expect(html).toContain('>Cancel<')
  })

  test('Create is disabled until the name has text', () => {
    expect(view()).toMatch(/<button[^>]*type="submit"[^>]*disabled/)
    expect(view({ name: 'UCK 26' })).not.toMatch(/<button[^>]*type="submit"[^>]*disabled/)
  })

  test('previews the slug', () => {
    expect(view({ name: 'UCK 26' })).toContain('uck-26')
  })

  test('an inline error sits under the input and marks it invalid', () => {
    const html = view({ name: 'x', error: 'A folder with that id already exists' })
    expect(html).toContain('role="alert"')
    expect(html).toContain('A folder with that id already exists')
    expect(html).toContain('aria-invalid="true"')
    expect(html.indexOf('Folder name')).toBeLessThan(html.indexOf('role="alert"'))
  })

  test('busy disables Create', () => {
    expect(view({ name: 'UCK', busy: true })).toContain('aria-busy="true"')
  })

  test('uses theme tokens for the error colour', () => {
    expect(view({ error: 'nope' })).toContain('var(--color-danger)')
  })
})

describe('NewCollectionPopover', () => {
  test('closed: only the button, which never wraps', () => {
    const html = renderToStaticMarkup(
      <NewCollectionPopover onCreate={neverCreates} onCreated={noop} />
    )
    expect(html).toContain('New folder…')
    expect(html).toContain('whitespace-nowrap')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('Folder name')
  })

  test('open: the form in a dialog', () => {
    const html = renderToStaticMarkup(
      <NewCollectionPopover onCreate={neverCreates} onCreated={noop} defaultOpen />
    )
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-label="New folder"')
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('Folder name')
    expect(html).toMatch(/role="dialog"[^>]*class="[^"]*top-full/)
  })

  test('at the foot of the sidebar it opens upwards, with its own label and tooltip', () => {
    const html = renderToStaticMarkup(
      <NewCollectionPopover
        onCreate={neverCreates}
        onCreated={noop}
        side="above"
        label="+ New folder"
        title="Inside Events"
        defaultOpen
      />
    )
    expect(html).toContain('>+ New folder<')
    expect(html).toContain('title="Inside Events"')
    expect(html).toMatch(/role="dialog"[^>]*class="[^"]*bottom-full/)
  })
})
