/**
 * Static-markup tests (node env, react-dom/server) for the quick-render footer
 * (issue #79). Effects don't run under renderToStaticMarkup, so the remembered
 * quality is never read and `window.subforge` needs no mock: the footer shows
 * the default.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ExportFooter } from './ExportFooter'
import type { RenderController } from '../../hooks/useRender'
import type { VideoInfo } from '../../lib/api'

const idle: RenderController = {
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

const video: VideoInfo = { width: 1080, height: 1920, fps: 30 }

function renderFooter(render: RenderController, info: VideoInfo | null = video) {
  return renderToStaticMarkup(
    <ExportFooter audioPath="/clips/talk.mp4" sourceVideoInfo={info} render={render} outputDir="" />
  )
}

describe('ExportFooter quality', () => {
  test('offers the MP4 bitrates, 40 Mbps selected until the user picks another', () => {
    const html = renderFooter(idle)
    expect(html).toContain('MP4 quality')
    expect(html).toContain('<option value="8M">8 Mbps (Good)</option>')
    expect(html).toContain('<option value="40M" selected="">40 Mbps (Maximum)</option>')
  })

  test('audio-only sources have no MP4 render, so no quality choice', () => {
    expect(renderFooter(idle, null)).not.toContain('MP4 quality')
  })
})

describe('ExportFooter saved location', () => {
  test('a finished render names its folder and offers the full path to copy', () => {
    const done = {
      ...idle,
      status: 'done' as const,
      lastOutputFile: 'C:\\Users\\zoe\\Videos\\talk_captioned.mp4',
    }
    const html = renderFooter(done)
    expect(html).toContain('Saved in C:\\Users\\zoe\\Videos')
    expect(html).toContain('Reveal talk_captioned.mp4')
    expect(html).toContain('aria-label="Copy the file path"')
  })

  test('nothing is claimed before a render has finished', () => {
    expect(renderFooter(idle)).not.toContain('Saved in')
  })
})
