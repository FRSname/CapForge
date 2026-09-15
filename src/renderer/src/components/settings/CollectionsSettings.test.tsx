/**
 * Settings → Collections, rendered to static markup (node env: no effects, no
 * events). The containers load over REST, so what is asserted is the
 * presentational half each container hands its state to — the list with its
 * orphans, the editor's inherit toggles and delete guard, the slot rows and
 * the package preview.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CollectionDetail, CollectionSummary } from '../../lib/collectionTypes'
import { EMPTY_OVERRIDES } from '../../lib/collectionTypes'
import type { LibraryVideo } from '../../lib/libraryTypes'
import type { UploadPackage } from '../../lib/publishTypes'
import { parseBrief } from '../../lib/publishTypes'
import { CollectionsSettings, CollectionsSettingsView } from './CollectionsSettings'
import { CollectionEditorView } from './CollectionEditor'
import { CollectionPreviewView } from './CollectionPreview'
import { SlotRowsEditor } from './SlotFields'

const noop = () => {}

function summary(over: Partial<CollectionSummary> = {}): CollectionSummary {
  return {
    id: 'uck26',
    name: 'UCK 26',
    slots: {},
    overrides: { ...EMPTY_OVERRIDES },
    createdAt: '',
    updatedAt: '',
    members: 3,
    ...over,
  }
}

function detail(over: Partial<CollectionDetail> = {}): CollectionDetail {
  return {
    ...summary(),
    effective_brief: parseBrief({ channel: 'CapForge', footer: 'Channel footer' }),
    ...over,
  }
}

describe('CollectionsSettingsView', () => {
  function render(props: Partial<React.ComponentProps<typeof CollectionsSettingsView>> = {}) {
    return renderToStaticMarkup(
      <CollectionsSettingsView
        collections={[summary(), summary({ id: 'solo', name: 'Solo', members: 1 })]}
        orphans={[{ id: 'old-event', members: 2 }]}
        loading={false}
        selectedId={null}
        onSelect={noop}
        onCreate={noop}
        onAdopt={noop}
        {...props}
      />
    )
  }

  test('lists every collection with its member count', () => {
    const html = render()

    expect(html).toContain('UCK 26')
    expect(html).toContain('3 videos')
    expect(html).toContain('Solo')
    expect(html).toContain('1 video<')
  })

  test('offers to adopt an orphan id by creating it', () => {
    const html = render()

    expect(html).toContain('2 videos use')
    expect(html).toContain('old-event')
    expect(html).toContain('aria-label="Create collection old-event"')
  })

  test('creates by name', () => {
    const html = render()

    expect(html).toContain('aria-label="New collection name"')
    expect(html).toContain('>Create<')
  })

  test('marks the selected collection', () => {
    const html = render({ selectedId: 'solo' })
    expect(html.match(/aria-current="true"/g)).toHaveLength(1)
  })

  test('says so when there are none yet', () => {
    const html = render({ collections: [], orphans: [] })
    expect(html).toContain('No collections yet')
  })
})

describe('CollectionsSettings', () => {
  test('renders its empty state before the list loads', () => {
    expect(renderToStaticMarkup(<CollectionsSettings />)).toContain('New collection name')
  })
})

describe('CollectionEditorView', () => {
  function render(value: CollectionDetail = detail()) {
    return renderToStaticMarkup(
      <CollectionEditorView
        detail={value}
        previewKey={0}
        onDraftName={noop}
        onCommitName={noop}
        onCommitSlots={noop}
        onDraftOverride={noop}
        onCommitOverride={noop}
        onDelete={noop}
      />
    )
  }

  test('an inheriting field shows its toggle on and the channel value it inherits', () => {
    const html = render()

    // The shared Toggle takes no aria-label, so each field is its own named group.
    expect(html).toContain('aria-label="Footer override"')
    expect(html).toContain('Inherit from channel')
    expect(html).toContain('Channel: Channel footer')
    // Every field inherits: every toggle is on.
    const on = html.match(/aria-checked="true"/g) ?? []
    expect(on.length).toBeGreaterThanOrEqual(11)
  })

  test('an overridden field shows its editor instead of the inherited value', () => {
    const html = render(
      detail({ overrides: { ...EMPTY_OVERRIDES, footer: 'Thanks to {{sponsor}}' } })
    )

    expect(html).toContain('Thanks to {{sponsor}}')
    expect(html).not.toContain('Channel: Channel footer')
    expect(html).toContain('Uses 1 override')
  })

  test('the template editor offers built-in and custom slots', () => {
    const html = render(
      detail({
        slots: { sponsor: 'Acme' },
        overrides: { ...EMPTY_OVERRIDES, description_template: '{{description}}' },
      })
    )

    expect(html).toContain('{{hashtags}}')
    expect(html).toContain('{{sponsor}}')
  })

  test('delete is disabled while videos belong to it, and says how many', () => {
    const html = render()

    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Delete collection<\/button>/)
    expect(html).toContain('3 videos belong to this collection')
  })

  test('delete is enabled for an empty collection', () => {
    const html = render(detail({ members: 0 }))
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Delete collection<\/button>/)
  })
})

describe('SlotRowsEditor', () => {
  test('renders a row per slot and hints at a name the backend will refuse', () => {
    const html = renderToStaticMarkup(
      <SlotRowsEditor idPrefix="c" slots={{ event: 'UCK 26', footer: 'x' }} onCommit={noop} />
    )

    expect(html).toContain('value="event"')
    expect(html).toContain('value="UCK 26"')
    expect(html).toContain('aria-label="Slot 2 name"')
    expect(html).toContain('is a built-in slot')
    expect(html).toContain('Add slot')
  })
})

function video(over: Partial<LibraryVideo> = {}): LibraryVideo {
  return {
    id: 'v1',
    title: 'Keynote',
    sourcePath: '/m/keynote.mp4',
    duration: 60,
    language: 'en',
    status: 'drafted',
    collection_id: 'uck26',
    scratch: false,
    createdAt: '',
    updatedAt: '',
    missing_media: false,
    hasProject: true,
    poster: false,
    cover: null,
    ...over,
  }
}

function pkg(description: string | null): UploadPackage {
  return {
    platform: 'youtube',
    text: 'TITLE OPTIONS\n1. Keynote',
    description,
    violations: [
      {
        field: 'package.description',
        rule: 'unknown_slot',
        message: 'Unknown slot {{typo}}',
        severity: 'hard',
      },
      { field: 'title', rule: 'r', message: 'A title finding', severity: 'hard' },
    ],
  }
}

function renderPreview(props: Partial<React.ComponentProps<typeof CollectionPreviewView>> = {}) {
  return renderToStaticMarkup(
    <CollectionPreviewView
      members={[video(), video({ id: 'v2', title: 'Panel' })]}
      selectedId="v1"
      pkg={pkg('Hook.\n\nRecorded at UCK 26')}
      loading={false}
      onSelect={noop}
      onRefresh={noop}
      {...props}
    />
  )
}

describe('CollectionPreviewView', () => {
  test('shows the picked member’s rendered description and only its findings', () => {
    const html = renderPreview()

    expect(html).toContain('aria-label="Preview video"')
    expect(html).toContain('Panel')
    expect(html).toContain('Recorded at UCK 26')
    expect(html).toContain('Unknown slot {{typo}}')
    expect(html).not.toContain('A title finding')
    // The package text itself is never shown in place of the description.
    expect(html).not.toContain('TITLE OPTIONS')
  })

  test('an older backend with no description says to update, and does not guess', () => {
    const html = renderPreview({ pkg: pkg(null) })

    expect(html).toContain('Update CapForge’s backend to preview the description')
    expect(html).not.toContain('TITLE OPTIONS')
    expect(html).not.toContain('aria-label="Package description"')
  })

  test('an empty description is said to be empty', () => {
    expect(renderPreview({ pkg: pkg('') })).toContain('This package has no DESCRIPTION yet.')
  })

  test('says it is rendering before the package arrives', () => {
    expect(renderPreview({ pkg: null, loading: true })).toContain('Rendering the package…')
  })

  test('explains an empty collection', () => {
    const html = renderPreview({ members: [], selectedId: null, pkg: null })
    expect(html).toContain('No video belongs to this collection yet')
  })
})
