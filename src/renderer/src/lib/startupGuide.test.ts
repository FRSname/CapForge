/**
 * The startup guide is copy, so the tests are about the copy holding its shape:
 * seven steps, unique ids, readable paragraphs, and every "open Settings"
 * action naming a category that actually exists in the Settings rail.
 */

import { describe, expect, test } from 'vitest'
import { APP_SETTINGS_CATEGORIES } from './appSettingsIndex'
import { GUIDE_STEPS, TUTORIAL_URL } from './startupGuide'

const EXPECTED_STEPS = 7
const MAX_PARAGRAPH_CHARS = 320
const CATEGORY_IDS = APP_SETTINGS_CATEGORIES.map((category) => category.id)

describe('GUIDE_STEPS', () => {
  test('seven steps with unique ids', () => {
    expect(GUIDE_STEPS).toHaveLength(EXPECTED_STEPS)
    expect(new Set(GUIDE_STEPS.map((step) => step.id)).size).toBe(EXPECTED_STEPS)
  })

  test('the first step welcomes and the last one is about Claude', () => {
    expect(GUIDE_STEPS[0].id).toBe('welcome')
    expect(GUIDE_STEPS[GUIDE_STEPS.length - 1].id).toBe('claude')
  })

  test('every step has a title and two or three short paragraphs', () => {
    for (const step of GUIDE_STEPS) {
      expect(step.title.trim().length).toBeGreaterThan(0)
      expect(step.paragraphs.length).toBeGreaterThanOrEqual(2)
      expect(step.paragraphs.length).toBeLessThanOrEqual(3)
      for (const paragraph of step.paragraphs) {
        expect(paragraph.trim().length).toBeGreaterThan(0)
        expect(paragraph.length).toBeLessThanOrEqual(MAX_PARAGRAPH_CHARS)
      }
    }
  })

  test('UI copy uses commas and full stops, never dashes for asides', () => {
    for (const step of GUIDE_STEPS) {
      for (const paragraph of step.paragraphs) {
        expect(paragraph).not.toMatch(/[—–]/)
      }
    }
  })

  test('every settings action names a real Settings category', () => {
    const settingsSteps = GUIDE_STEPS.filter((step) => step.action?.kind === 'settings')
    expect(settingsSteps.length).toBeGreaterThan(0)
    for (const step of settingsSteps) {
      const action = step.action
      if (action?.kind !== 'settings') throw new Error('filtered above')
      expect(CATEGORY_IDS).toContain(action.category)
      expect(action.label.trim().length).toBeGreaterThan(0)
    }
  })

  test('link actions are https', () => {
    for (const step of GUIDE_STEPS) {
      if (step.action?.kind !== 'link') continue
      expect(step.action.url.startsWith('https://')).toBe(true)
    }
  })

  test('the tutorial link is the one the changelog points at', () => {
    expect(TUTORIAL_URL).toBe('https://www.youtube.com/watch?v=7xxLt5FEq1E')
  })
})
