/**
 * The workspace switch, the soft-lock banner and the footer actions — the
 * three pieces of the Publish workspace that sit outside a card.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CaptionTrack } from '../../lib/tracks'
import type { Segment } from '../../types/app'
import { PUBLISH_DISABLED_HINT, WorkspaceToggle } from './WorkspaceToggle'
import { AgentUpdateBanner } from './AgentUpdateBanner'
import { PublishFooter } from './PublishFooter'

const noop = () => {}

const segments: Segment[] = [{ id: 's1', start: 0, end: 1, text: 'Hello.', words: [] }]

function track(over: Partial<CaptionTrack> = {}): CaptionTrack {
  return {
    id: 'src',
    label: 'English',
    lang: 'en',
    isSource: true,
    segments,
    groups: [],
    ...over,
  } as unknown as CaptionTrack
}

describe('WorkspaceToggle', () => {
  test('marks the active workspace and offers the other', () => {
    const html = renderToStaticMarkup(
      <WorkspaceToggle workspace="captions" onChange={noop} publishEnabled />
    )

    expect(html).toContain('aria-label="Workspace"')
    expect(html).toContain('Captions')
    expect(html).toContain('Publish')
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1)
  })

  test('disables Publish, with the reason, when the session has no record', () => {
    const html = renderToStaticMarkup(
      <WorkspaceToggle workspace="captions" onChange={noop} publishEnabled={false} />
    )

    expect(html).toContain('disabled=""')
    expect(html).toContain(PUBLISH_DISABLED_HINT)
  })

  test('offers no disabled hint once there is a record', () => {
    const html = renderToStaticMarkup(
      <WorkspaceToggle workspace="publish" onChange={noop} publishEnabled />
    )

    expect(html).not.toContain('disabled=""')
    expect(html).not.toContain(PUBLISH_DISABLED_HINT)
  })
})

describe('AgentUpdateBanner', () => {
  test('renders nothing while no agent write is held', () => {
    expect(
      renderToStaticMarkup(
        <AgentUpdateBanner notice={null} onApply={noop} onKeepMine={noop} />
      )
    ).toBe('')
  })

  test('names the field and offers both answers', () => {
    const html = renderToStaticMarkup(
      <AgentUpdateBanner
        notice={{ field: 'description', by: 'agent', remoteValue: 'Claude wrote this' }}
        onApply={noop}
        onKeepMine={noop}
      />
    )

    expect(html).toContain('Claude updated Description while you were typing.')
    expect(html).toContain('Apply')
    expect(html).toContain('Keep mine')
    expect(html).toContain('role="status"')
  })
})

describe('PublishFooter', () => {
  test('offers the package actions and a subtitle pair per track', () => {
    const html = renderToStaticMarkup(
      <PublishFooter
        videoId="vid_1"
        segments={segments}
        tracks={[track(), track({ id: 'tpl', label: 'Polish', lang: 'pl', isSource: false })]}
        outputDir=""
      />
    )

    expect(html).toContain('Copy upload package')
    expect(html).toContain('Copy plain transcript')
    expect(html).toContain('English')
    expect(html).toContain('Polish')
    expect(html.match(/\.SRT/g)).toHaveLength(2)
    expect(html.match(/\.VTT/g)).toHaveLength(2)
  })

  test('cannot copy a package for a session with no record', () => {
    const html = renderToStaticMarkup(
      <PublishFooter videoId={null} segments={segments} tracks={[track()]} outputDir="" />
    )

    expect(html).toContain('disabled=""')
    // The transcript is in the session, not the record, so it stays available.
    expect(html.match(/disabled=""/g)).toHaveLength(1)
  })
})
