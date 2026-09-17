/**
 * Static-markup tests (node env, `react-dom/server`) for the right-hand aside.
 *
 * The workspace toggle is the aside's own title (docs/plans/ux-ui-refresh.md
 * §4): it switches this column, so it is drawn at the top of this column and
 * not over the editor's tab strip. Both panels stay mounted, so both carry a
 * copy of the toggle — only the visible one is on screen.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import type { PublishController } from '../../hooks/usePublishRecord'
import type { PublishWorkspaceController } from '../../hooks/usePublishWorkspace'
import type { Workspace } from '../../types/app'
import { PublishAside } from './PublishAside'

const noop = () => {}

/** A session with no library record: the panel's emptiest, cheapest shape. */
function controller(): PublishController {
  return {
    record: null,
    fields: {} as PublishController['fields'],
    loading: false,
    saving: false,
    dirty: false,
    violationsFor: () => [],
    provenance: () => null,
    canRevert: () => false,
    revert: noop,
    setField: noop,
    setCollection: noop,
    flushDrafts: () => Promise.resolve(),
    patchNow: () => Promise.resolve(),
    beginEdit: noop,
    endEdit: noop,
    pendingAgentUpdate: null,
    applyAgentUpdate: noop,
    keepMine: noop,
    markPublished: noop,
    suggestChapters: noop,
    insertChapterAt: noop,
    removeChapterAt: noop,
    renameChapter: noop,
    speakerIds: [],
  }
}

function workspaceController(
  over: Partial<PublishWorkspaceController> = {}
): PublishWorkspaceController {
  return {
    workspace: 'captions' as Workspace,
    setWorkspace: noop,
    publishEnabled: true,
    pendingSeek: null,
    seek: noop,
    handleTimeUpdate: noop,
    getPlayhead: () => 0,
    activeChannelId: null,
    setActiveChannelId: noop,
    ...over,
  }
}

function aside(over: Partial<PublishWorkspaceController> = {}, hidden = false): string {
  return renderToStaticMarkup(
    (
      <PublishAside
        publishWorkspace={workspaceController(over)}
        hidden={hidden}
        studio={{}}
        publish={controller()}
        segments={[]}
        tracks={[]}
        outputDir=""
      />
    ) as ReactElement
  )
}

describe('PublishAside — the toggle is the aside title', () => {
  test('both panels head with the workspace toggle', () => {
    // Arrange / Act
    const html = aside()

    // Assert — one toggle per mounted panel, only one of them visible.
    // Scoped to the radios: "Captions" is also an export-row label in the studio.
    expect(html.match(/aria-label="Workspace"/g)).toHaveLength(2)
    expect(html.match(/role="radio"[^>]*>Captions</g)).toHaveLength(2)
    expect(html.match(/role="radio"[^>]*>Publish</g)).toHaveLength(2)
  })

  test('neither panel still prints its own header label', () => {
    // Arrange / Act
    const html = aside()

    // Assert
    expect(html).not.toContain('<span class="label-xs">Custom Settings</span>')
    expect(html).not.toContain('<span class="label-xs">Publish</span>')
  })

  test('the toggle reads the live workspace on both copies', () => {
    // Arrange / Act
    const html = aside({ workspace: 'publish' })

    // Assert — one checked Publish radio per copy.
    expect(html.match(/aria-checked="true"[^>]*>Publish</g)).toHaveLength(2)
  })

  test('a session with no record offers Publish refused, with the reason', () => {
    // Arrange / Act
    const html = aside({ publishEnabled: false })

    // Assert
    expect(html).toContain('Add this video to the library first')
  })

  test('the captions workspace shows the studio and hides the dossier', () => {
    // Arrange / Act
    const html = aside()

    // Assert
    expect(html).toContain('<div class="contents">')
    expect(html.match(/<div class="hidden">/g)).toHaveLength(1)
  })

  test('the library screen hides both panels without unmounting them', () => {
    // Arrange / Act
    const html = aside({ workspace: 'publish' }, true)

    // Assert
    expect(html.match(/<div class="hidden">/g)).toHaveLength(2)
    expect(html).not.toContain('<div class="contents">')
    expect(html.match(/aria-label="Workspace"/g)).toHaveLength(2)
  })
})
