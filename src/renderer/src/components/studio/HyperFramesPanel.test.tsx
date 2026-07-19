/**
 * Static-markup tests (node env, react-dom/server) for the "preview shows
 * Classic" hint — see docs/plans/caption-style-visibility-feedback.md Phase 3.
 * Effects (the styles/status/coauthor fetches) don't run under
 * renderToStaticMarkup, so no api/window.subforge mocking is needed.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { HyperFramesPanel } from './HyperFramesPanel'
import type { RenderController } from '../../hooks/useRender'

const noopRender: RenderController = {
  status: 'idle',
  progress: 0,
  message: '',
  elapsed: '',
  busy: false,
  lastOutputFile: null,
  startRender: async () => {},
  openStudio: async () => {},
  cancelRender: () => {},
  reset: () => {},
}

function renderPanel(captionStyle: string) {
  return renderToStaticMarkup(
    <HyperFramesPanel
      captionStyle={captionStyle}
      onCaptionStyleChange={() => {}}
      audioPath="/tmp/source.mp4"
      outputDir=""
      onOutputDir={() => {}}
      render={noopRender}
    />
  )
}

describe('HyperFramesPanel caption-style hint', () => {
  test('shows the Classic-preview hint when a registry style is selected', () => {
    const html = renderPanel('caption-kinetic-slam')
    expect(html).toContain('Preview shows the Classic style')
    expect(html).toContain('caption-kinetic-slam')
  })

  test('hides the hint when the classic style is selected', () => {
    const html = renderPanel('classic')
    expect(html).not.toContain('Preview shows the Classic style')
  })
})
