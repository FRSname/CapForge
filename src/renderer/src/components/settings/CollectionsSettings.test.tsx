/**
 * Settings → Folders (collections), rendered to static markup (node env: no
 * effects, no events). The containers load over REST, so what is asserted is
 * the presentational half each container hands its state to — the indented
 * tree with its orphans, the editor's Location, inherit toggles and delete
 * guard, the slot rows and the package preview.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CollectionDetail, CollectionSummary } from '../../lib/collectionTypes'
import { EMPTY_OVERRIDES } from '../../lib/collectionTypes'
import type { LibraryVideo } from '../../lib/libraryTypes'
import type { UploadPackage } from '../../lib/publishTypes'
import { parseBrief } from '../../lib/publishTypes'
import { CollectionsSettings, CollectionsSettingsView } from './CollectionsSettings'
import type { EditorRefusal } from './CollectionEditor'
import { CollectionEditorView, deleteBlocker } from './CollectionEditor'
import { CollectionLocation } from './CollectionLocation'
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
    parent_id: null,
    total_members: 3,
    path: ['UCK 26'],
    ...over,
  }
}

/** events › uck26 › day-1, and a top-level solo. */
const TREE: CollectionSummary[] = [
  summary({ id: 'solo', name: 'Solo', members: 1, total_members: 1, path: ['Solo'] }),
  summary({ id: 'day-1', name: 'Day 1', parent_id: 'uck26', members: 2, total_members: 2 }),
  summary({ id: 'events', name: 'Events', members: 0, total_members: 5, path: ['Events'] }),
  summary({ parent_id: 'events', members: 3, total_members: 5 }),
]

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
        collections={[
          summary(),
          summary({ id: 'solo', name: 'Solo', members: 1, total_members: 1 }),
        ]}
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

  test('lists every folder with its video count', () => {
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
    expect(html).toContain('aria-label="Create folder old-event"')
    expect(html).toContain('no folder has that id')
  })

  test('creates by name', () => {
    const html = render()

    expect(html).toContain('aria-label="New folder name"')
    expect(html).toContain('>Create<')
  })

  test('marks the selected folder', () => {
    const html = render({ selectedId: 'solo' })
    expect(html.match(/aria-current="true"/g)).toHaveLength(1)
  })

  test('says so when there are none yet', () => {
    const html = render({ collections: [], orphans: [] })
    expect(html).toContain('No folders yet')
  })

  test('speaks of folders, never collections', () => {
    const html = render({ collections: [], orphans: [{ id: 'old', members: 1 }] })
    expect(html).toContain('aria-label="Folders"')
    expect(html).not.toMatch(/[Cc]ollection/)
  })

  test('lists the tree in order, indented by depth, counting subfolders', () => {
    const html = render({ collections: TREE, orphans: [] })

    const names = [...html.matchAll(/<span class="truncate">([^<]+)<\/span>/g)].map((m) => m[1])
    expect(names).toEqual(['Solo', 'Events', 'UCK 26', 'Day 1'])
    expect(html.match(/aria-level="(\d)"/g)).toEqual([
      'aria-level="1"',
      'aria-level="1"',
      'aria-level="2"',
      'aria-level="3"',
    ])
    expect(html).toContain('padding-left:2.5rem')
    // Events holds no video itself but counts its subfolders'.
    expect(html).toContain('5 videos')
  })
})

describe('CollectionsSettings', () => {
  test('renders its empty state before the list loads', () => {
    expect(renderToStaticMarkup(<CollectionsSettings />)).toContain('New folder name')
    expect(renderToStaticMarkup(<CollectionsSettings />)).not.toContain('Opening the folder')
  })

  test('opened on a folder (the library’s Folder settings…), its editor is already open', () => {
    const html = renderToStaticMarkup(<CollectionsSettings initialSelectedId="uck26" />)
    expect(html).toContain('Opening the folder…')
  })
})

describe('CollectionEditorView', () => {
  function render(
    value: CollectionDetail = detail(),
    collections: CollectionSummary[] = [summary()],
    refusal: EditorRefusal | null = null
  ) {
    return renderToStaticMarkup(
      <CollectionEditorView
        detail={value}
        collections={collections}
        previewKey={0}
        refusal={refusal}
        onDraftName={noop}
        onCommitName={noop}
        onMove={noop}
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

    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Delete folder<\/button>/)
    expect(html).toContain('3 videos belong to this folder')
  })

  test('delete is enabled for an empty folder', () => {
    const html = render(detail({ members: 0 }))
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Delete folder<\/button>/)
  })

  test('delete is disabled while subfolders are inside, and says how many', () => {
    const tree = [...TREE, summary({ id: 'day-2', name: 'Day 2', parent_id: 'uck26' })]
    const html = render(detail({ members: 0, parent_id: 'events' }), tree)

    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Delete folder<\/button>/)
    expect(html).toContain('2 subfolders are inside this folder')
  })

  test('a refused delete is shown under the delete button', () => {
    const html = render(detail({ members: 0 }), [summary()], {
      place: 'delete',
      message: '1 subfolder is still inside this folder — move or delete it first.',
    })

    expect(html).toMatch(/role="alert"[^>]*>1 subfolder is still inside this folder/)
  })

  test('a nested folder names where each inherited value comes from', () => {
    const tree = [
      summary({ id: 'events', name: 'Events', overrides: { ...EMPTY_OVERRIDES, footer: 'E' } }),
      summary({ parent_id: 'events' }),
    ]
    const html = render(
      detail({
        parent_id: 'events',
        effective_brief: parseBrief({ channel: 'CapForge', footer: 'Events footer' }),
      }),
      tree
    )

    expect(html).toContain('From Events: Events footer')
    expect(html).toContain('Channel: CapForge')
    expect(html).toContain('>Inherit<')
    expect(html).not.toContain('Inherit from channel')
  })

  test('renders the Location picker at the folder’s parent', () => {
    const html = render(detail({ parent_id: 'events' }), TREE)

    expect(html).toContain('>Location<')
    expect(html).toMatch(/<option value="events" selected="">Events<\/option>/)
  })
})

describe('CollectionLocation', () => {
  function render(over: Partial<React.ComponentProps<typeof CollectionLocation>> = {}) {
    return renderToStaticMarkup(
      <CollectionLocation
        collectionId="uck26"
        parentId="events"
        collections={TREE}
        error={null}
        onMove={noop}
        {...over}
      />
    )
  }

  test('offers the top level and every other folder by its path, never itself or a subfolder', () => {
    const html = render()
    const options = [...html.matchAll(/<option value="([^"]*)"[^>]*>([^<]+)<\/option>/g)].map(
      (m) => [m[1], m[2]]
    )

    expect(options).toEqual([
      ['', 'Top level'],
      ['solo', 'Solo'],
      ['events', 'Events'],
    ])
  })

  test('labels a nested target by its full path', () => {
    const html = render({ collectionId: 'solo', parentId: null })

    expect(html).toContain('>Events › UCK 26 › Day 1</option>')
    expect(html).toMatch(/<option value="" selected="">Top level<\/option>/)
  })

  test('a refusal is shown under the select', () => {
    const html = render({ error: 'A folder can’t move inside itself or one of its subfolders.' })
    expect(html).toMatch(/role="alert"[^>]*>A folder can’t move inside itself/)
  })
})

describe('deleteBlocker', () => {
  test('videos are named before subfolders, and nothing blocks an empty folder', () => {
    expect(deleteBlocker(2, 1)).toContain('2 videos belong to this folder')
    expect(deleteBlocker(0, 1)).toContain('1 subfolder is inside this folder — move or delete it')
    expect(deleteBlocker(0, 0)).toBeNull()
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
    expect(html).toContain('No video is in this folder yet')
  })
})
