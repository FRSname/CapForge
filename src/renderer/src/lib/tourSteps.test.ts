/**
 * The two coach-mark tours are copy plus a handful of ids, so the tests are
 * about that pairing holding: every step that points at something points at a
 * `data-tour` attribute that really exists in a component, every step that
 * opens Settings names a real category, and the prose stays short and plain.
 *
 * The attribute check is the load-bearing one. A `data-tour` is invisible to
 * every other test and to the type system, so without reading the component
 * tree from disk a refactor could drop one and nothing would notice until a
 * user ran the tour.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { APP_SETTINGS_CATEGORIES } from './appSettingsIndex'
import type { Tour, TourStep } from './tourSteps'
import { TOUR_SEEN_KEY, TOURS } from './tourSteps'

const MAX_PARAGRAPH_CHARS = 320
const CATEGORY_IDS = APP_SETTINGS_CATEGORIES.map((category) => category.id)
const COMPONENTS_DIR = resolve(__dirname, '../components')

/** Every `data-tour` id written in a `.tsx` under `components/`. */
function taggedIds(): Set<string> {
  const ids = new Set<string>()
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (!entry.name.endsWith('.tsx')) continue
      else {
        for (const match of readFileSync(path, 'utf8').matchAll(/data-tour="([^"]+)"/g)) {
          ids.add(match[1])
        }
      }
    }
  }
  walk(COMPONENTS_DIR)
  return ids
}

const TAGGED_IDS = taggedIds()

const ALL_TOURS: Tour[] = Object.values(TOURS)
const ALL_STEPS: TourStep[] = ALL_TOURS.flatMap((tour) => [...tour.steps])

describe('TOURS', () => {
  test('the key of each tour is its own id', () => {
    for (const [id, tour] of Object.entries(TOURS)) expect(tour.id).toBe(id)
  })

  test('the two tours belong to the two screens that can host them', () => {
    expect(TOURS['getting-around'].screen).toBe('library')
    expect(TOURS['first-video'].screen).toBe('results')
  })

  test('step ids are unique inside a tour', () => {
    for (const tour of ALL_TOURS) {
      const ids = tour.steps.map((step) => step.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  test('every tour has a title and at least three steps', () => {
    for (const tour of ALL_TOURS) {
      expect(tour.title.trim().length).toBeGreaterThan(0)
      expect(tour.steps.length).toBeGreaterThanOrEqual(3)
    }
  })

  test('every step has a title and two short paragraphs', () => {
    for (const step of ALL_STEPS) {
      expect(step.title.trim().length).toBeGreaterThan(0)
      expect(step.paragraphs.length).toBeGreaterThanOrEqual(1)
      for (const paragraph of step.paragraphs) {
        expect(paragraph.trim().length).toBeGreaterThan(0)
        expect(paragraph.length).toBeLessThanOrEqual(MAX_PARAGRAPH_CHARS)
      }
    }
  })

  test('UI copy uses commas and full stops, never dashes for asides', () => {
    for (const step of ALL_STEPS) {
      expect(step.title).not.toMatch(/[—–]/)
      for (const paragraph of step.paragraphs) expect(paragraph).not.toMatch(/[—–]/)
    }
  })

  test('every target is a data-tour attribute that exists in a component', () => {
    const targets = ALL_STEPS.map((step) => step.target).filter((id): id is string => Boolean(id))
    expect(targets.length).toBeGreaterThan(0)
    const missing = targets.filter((target) => !TAGGED_IDS.has(target))
    expect(missing, 'these data-tour ids are in no component').toEqual([])
  })

  test('every open-settings action names a real Settings category', () => {
    const opens = ALL_STEPS.flatMap((step) => step.before ?? []).filter(
      (action) => action.kind === 'open-settings'
    )
    expect(opens.length).toBeGreaterThan(0)
    for (const action of opens) {
      if (action.kind !== 'open-settings') throw new Error('filtered above')
      expect(CATEGORY_IDS).toContain(action.category)
    }
  })

  test('the getting-around tour closes Settings again before it ends', () => {
    const last = TOURS['getting-around'].steps.at(-1)
    expect(last?.before).toContainEqual({ kind: 'close-settings' })
  })

  test('the first-video tour leaves the workspace on captions', () => {
    const first = TOURS['first-video'].steps[0]
    const last = TOURS['first-video'].steps.at(-1)
    expect(first.before).toContainEqual({ kind: 'set-workspace', workspace: 'captions' })
    expect(last?.before).toContainEqual({ kind: 'set-workspace', workspace: 'captions' })
  })

  test('exactly one step carries the tutorial video, and it is a centred card', () => {
    const tutorials = ALL_STEPS.filter((step) => step.tutorial)
    expect(tutorials).toHaveLength(1)
    expect(tutorials[0].target).toBeUndefined()
  })

  test('a step without a target has no placement to honour', () => {
    for (const step of ALL_STEPS) {
      if (step.target) continue
      expect(step.placement).toBeUndefined()
      expect(step.optional).toBeFalsy()
    }
  })

  test('the app-state key is the documented one', () => {
    expect(TOUR_SEEN_KEY).toBe('toursSeen')
  })
})
