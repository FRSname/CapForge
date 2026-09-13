/**
 * Static-markup tests (node env, react-dom/server) for the skill editor.
 *
 * CapForge's vitest setup has no DOM and no events, so these assert only what
 * the markup *is*: which chip a status renders, that the bundle notice is
 * conditional, that Save is inert until the draft diverges, and that the editor
 * is a real `<textarea>` carrying the draft. The container (`SkillsPanel`)
 * holds every piece of state, which is exactly why this component can be
 * rendered from a fixture.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import type { SkillDetail } from '../../../../preload/index'
import { SkillEditor, type SkillEditorProps } from './SkillEditor'

const USER_DIR = '/Users/me/Library/Application Support/CapForge/skills/capforge-publish'

function makeSkill(over: Partial<SkillDetail> = {}): SkillDetail {
  return {
    name: 'capforge-publish',
    description: 'Package a finished video into notes/youtube.txt.',
    installStatus: 'not-installed',
    bundleChanged: false,
    userDir: USER_DIR,
    installDir: '/Users/me/.claude/skills/capforge-publish',
    text: 'user copy',
    bundledText: 'bundled copy',
    files: ['SKILL.md'],
    ...over,
  }
}

const noop = () => {}

function render(over: Partial<SkillEditorProps> = {}): string {
  const skill = over.skill === undefined ? makeSkill() : over.skill
  return renderToStaticMarkup(
    <SkillEditor
      skill={skill}
      draft={skill ? skill.text : ''}
      dirty={false}
      busy={false}
      onChange={noop}
      onSave={noop}
      onReset={noop}
      onInstall={noop}
      onReveal={noop}
      onKeepMine={noop}
      onTakeNew={noop}
      onOpenBoth={noop}
      {...over}
    />
  )
}

/** The `<button>` element whose text content is exactly `label`. */
function buttonFor(html: string, label: string): string {
  const match = html.match(new RegExp(`<button[^>]*>${label}</button>`))
  expect(match, `no <button> labelled "${label}"`).not.toBeNull()
  return match![0]
}

describe('SkillEditor', () => {
  test('renders nothing when no skill is selected', () => {
    // Arrange / Act — the container mounts the editor unconditionally and
    // passes null until a row is clicked.
    const html = render({ skill: null })

    // Assert
    expect(html).toBe('')
  })

  test.each([
    ['not-installed', 'Not installed', 'Install'],
    ['up-to-date', 'Installed', 'Installed'],
    ['outdated', 'Update available', 'Update'],
  ] as const)('status %s shows the "%s" chip', (status, chip, installLabel) => {
    // Arrange / Act
    const html = render({ skill: makeSkill({ installStatus: status }) })

    // Assert — the chip states the install status, the button states the action.
    expect(html).toContain(chip)
    expect(buttonFor(html, installLabel)).toBeTruthy()
  })

  test('an up-to-date skill cannot be installed again', () => {
    // Arrange / Act
    const html = render({ skill: makeSkill({ installStatus: 'up-to-date' }) })

    // Assert
    expect(buttonFor(html, 'Installed')).toContain('disabled')
  })

  test('the bundle-changed notice and its three choices appear only when bundleChanged', () => {
    // Arrange / Act
    const unchanged = render({ skill: makeSkill({ bundleChanged: false }) })
    const changed = render({ skill: makeSkill({ bundleChanged: true }) })

    // Assert
    expect(unchanged).not.toContain('bundled version changed since your copy')
    expect(unchanged).not.toContain('Keep mine')
    expect(changed).toContain('This skill&#x27;s bundled version changed since your copy.')
    expect(changed).toContain('Keep mine')
    expect(changed).toContain('Take new')
    expect(changed).toContain('Open both')
  })

  test('Save is disabled until the draft diverges from the saved text', () => {
    // Arrange / Act
    const clean = render({ dirty: false })
    const edited = render({ draft: 'edited copy', dirty: true })

    // Assert
    expect(buttonFor(clean, 'Save')).toContain('disabled')
    expect(buttonFor(edited, 'Save')).not.toContain('disabled')
  })

  test('a dirty draft blocks Install and says why', () => {
    // Arrange / Act — installing the *saved* file while the editor holds
    // unsaved text would install something the user is not looking at.
    const html = render({ draft: 'edited copy', dirty: true })

    // Assert
    const install = buttonFor(html, 'Install')
    expect(install).toContain('disabled')
    expect(install).toContain('title="Save first"')
  })

  test('the editor is a textarea holding the draft, not the saved text', () => {
    // Arrange / Act
    const html = render({ draft: 'edited copy', dirty: true })

    // Assert
    expect(html).toMatch(/<textarea[^>]*>edited copy<\/textarea>/)
    expect(html).not.toContain('>user copy<')
  })

  test('spell-check is off in the editor', () => {
    // Arrange / Act — SKILL.md is prose plus paths and flags; red squiggles
    // everywhere are noise.
    const html = render()

    // Assert
    // React 19's static markup keeps the React casing on these attributes.
    expect(html).toMatch(/<textarea[^>]*spellCheck="false"/)
  })

  test('the user copy path is shown in the mono font', () => {
    // Arrange / Act
    const html = render()

    // Assert
    const line = html.match(new RegExp(`<p[^>]*>${USER_DIR}</p>`))?.[0]
    expect(line, 'the user path is not rendered').toBeDefined()
    expect(line).toContain('var(--cf-font-mono)')
  })

  test('"Open both" reveals a read-only pane with the bundled text', () => {
    // Arrange / Act
    const closed = render({ skill: makeSkill({ bundleChanged: true }) })
    const opened = render({ skill: makeSkill({ bundleChanged: true }), showBundled: true })

    // Assert
    expect(closed).not.toContain('bundled copy')
    expect(opened).toContain('bundled copy')
    expect(opened).toMatch(/<textarea[^>]*readOnly[^>]*>bundled copy<\/textarea>/)
  })

  test('every control is inert while an action is in flight', () => {
    // Arrange / Act
    const html = render({ draft: 'edited copy', dirty: true, busy: true })

    // Assert
    expect(buttonFor(html, 'Save')).toContain('disabled')
    expect(buttonFor(html, 'Reset to bundled')).toContain('disabled')
    expect(buttonFor(html, 'Reveal')).toContain('disabled')
    expect(html).toMatch(/<textarea[^>]*disabled/)
  })
})
