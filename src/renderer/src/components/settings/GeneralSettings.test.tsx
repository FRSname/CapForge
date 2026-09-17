/**
 * Static-markup tests (node env, react-dom/server) for Settings → General's
 * watch folder row. The row is rendered with a status in hand — the fetch lives
 * in `useLibraryWatch`, whose effects never run under `renderToStaticMarkup`.
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { WatchStatus } from '../../lib/libraryTypes'
import { WATCH_FOLDER_HELP } from '../../lib/libraryImport'
import { AboutBlock, GeneralSettings, WatchFolderRow } from './GeneralSettings'

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
    const html = renderToStaticMarkup(<GeneralSettings mode="dark" onModeChange={() => {}} />)
    expect(html).toContain('Library folder')
    expect(html).toContain('Watch folder')
    expect(html).toContain('Checking…')
  })

  test('Appearance is a Light / Dark / System choice, not a toggle', () => {
    const html = renderToStaticMarkup(<GeneralSettings mode="dark" onModeChange={() => {}} />)
    expect(html).toContain('aria-label="Appearance"')
    expect(html).toContain('>Light<')
    expect(html).toContain('>Dark<')
    expect(html).toContain('>System<')
    // The picked mode is the checked radio, and System says what it follows.
    expect(html).toContain('System follows your OS setting.')
    expect(html).not.toContain('Dark Mode')
  })

  test('the pane ends with the About block and all three prompts', () => {
    const html = renderToStaticMarkup(<GeneralSettings mode="dark" onModeChange={() => {}} />)
    expect(html).toContain('About')
    expect(html).toContain('Startup guide')
    expect(html).toContain('Editor guide')
    // Apostrophes arrive HTML-escaped.
    expect(html).toContain('What&#x27;s new')
  })
})

describe('AboutBlock', () => {
  function about(version: string | null): string {
    return renderToStaticMarkup(<AboutBlock version={version} onShow={() => {}} />)
  }

  test('names the running version once it is known', () => {
    expect(about('2.6.0')).toContain('CapForge 2.6.0')
  })

  test('shows a placeholder while the version is still unknown', () => {
    const html = about(null)
    expect(html).toContain('CapForge')
    expect(html).not.toContain('CapForge 2')
  })

  test('offers all three prompts', () => {
    const html = about('2.6.0')
    expect(html).toContain('Startup guide')
    expect(html).toContain('Editor guide')
    expect(html).toContain('What&#x27;s new')
  })

  test('says where each tour runs, so a disabled button is never a mystery', () => {
    expect(about('2.6.0')).toContain('The startup guide runs on the library')
  })
})
