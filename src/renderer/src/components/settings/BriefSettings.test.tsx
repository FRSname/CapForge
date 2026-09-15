/**
 * Settings → Channel, rendered to static markup (node env — the load effect
 * never runs, so what is asserted is the pane's empty state, which is exactly
 * what a user with no `brief.json` sees).
 */

import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { BriefSettings } from './BriefSettings'
import { APP_SETTINGS_CATEGORIES, filterAppSettings } from '../../lib/appSettingsIndex'

function render(): string {
  return renderToStaticMarkup(<BriefSettings />)
}

describe('BriefSettings', () => {
  test('asks for every field the brief contract carries', () => {
    const html = render()

    for (const label of [
      'Channel',
      'Audience',
      'Voice',
      'Language',
      'Recorded-at line',
      'Speaker block',
      'Footer',
      'Default hashtags',
      'Link rows',
      'House rules',
      'Description template',
      'Template slots',
    ]) {
      expect(html).toContain(label)
    }
  })

  test('offers both house-rule toggles and both windows', () => {
    const html = render()

    expect(html).toContain('No em or en dashes')
    expect(html).toContain('The first 150 characters must be a hook')
    expect(html).toContain('aria-label="Minimum description length"')
    expect(html).toContain('aria-label="Maximum keyword terms"')
    // hook_first_150 defaults on; no_em_dashes defaults off.
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1)
  })

  test('offers the slot palette over the template and an empty slot list', () => {
    const html = render()

    expect(html).toContain('aria-label="Insert a slot"')
    expect(html).toContain('{{footer}}')
    expect(html).toContain('{{collection}}')
    expect(html).toContain('Add slot')
    expect(html).not.toContain('aria-label="Slot 1 name"')
  })

  test('starts with no link rows and a way to add one', () => {
    const html = render()

    expect(html).toContain('Add link row')
    expect(html).not.toContain('aria-label="Link 1 label"')
  })
})

describe('the Channel category', () => {
  test('is in the rail', () => {
    expect(APP_SETTINGS_CATEGORIES.map((c) => c.id)).toContain('channel')
  })

  test('is what the words a user would type lead to', () => {
    for (const query of ['channel', 'brief', 'hashtag', 'footer', 'speaker', 'house rules', 'slots']) {
      expect(filterAppSettings(query).categories).toContain('channel')
    }
  })
})
