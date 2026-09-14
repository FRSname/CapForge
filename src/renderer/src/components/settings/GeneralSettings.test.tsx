/**
 * Static-markup tests (node env, react-dom/server) for Settings → General's
 * watch folder row. The row is rendered with a status in hand — the fetch lives
 * in `useLibraryWatch`, whose effects never run under `renderToStaticMarkup`.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { WatchStatus } from '../../lib/libraryTypes'
import { WATCH_FOLDER_HELP } from '../../lib/libraryImport'
import { GeneralSettings, WatchFolderRow } from './GeneralSettings'

const WATCHING: WatchStatus = {
  folder: '/Volumes/Recordings/Exports',
  available: true,
  lastScanAt: '2026-09-14T10:00:00Z',
  importedCount: 0,
}

function row(status: WatchStatus | null): string {
  const noop = () => {}
  return renderToStaticMarkup(
    <WatchFolderRow status={status} busy={false} onChoose={noop} onStop={noop} />
  )
}

describe('WatchFolderRow', () => {
  test('not watching: says so, offers Choose…, no Stop', () => {
    const html = row({ folder: null, available: false, lastScanAt: null, importedCount: 0 })
    expect(html).toContain('Watch folder')
    expect(html).toContain('Not watching')
    expect(html).toContain('Choose…')
    expect(html).not.toContain('>Stop<')
    expect(html).toContain(WATCH_FOLDER_HELP)
  })

  test('watching: shows the path and a Stop', () => {
    const html = row(WATCHING)
    expect(html).toContain('/Volumes/Recordings/Exports')
    expect(html).toContain('>Stop<')
    expect(html).not.toContain('Folder not available')
  })

  test('an unplugged drive shows "Folder not available"', () => {
    const html = row({ ...WATCHING, available: false })
    expect(html).toContain('/Volumes/Recordings/Exports')
    expect(html).toContain('Folder not available')
    expect(html).toContain('>Stop<')
  })

  test('the pane mounts the row while the status loads', () => {
    const html = renderToStaticMarkup(
      <GeneralSettings lightMode={false} onLightModeChange={() => {}} />
    )
    expect(html).toContain('Library folder')
    expect(html).toContain('Watch folder')
    expect(html).toContain('Checking…')
  })
})
