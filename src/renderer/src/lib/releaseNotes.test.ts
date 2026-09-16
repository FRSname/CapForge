/**
 * The release-notes list is hand-written, which only works if a release cannot
 * ship without it: these tests pin `RELEASE_NOTES` to `package.json`'s version
 * and to CHANGELOG.md's headings, so bumping one without the other fails the
 * frontend CI job.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { compareVersions } from './version'
import { notesSince, RELEASE_NOTES, RELEASES_URL } from './releaseNotes'

const ROOT = resolve(__dirname, '../../../..')
const PACKAGE_VERSION = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).version
const CHANGELOG = readFileSync(resolve(ROOT, 'CHANGELOG.md'), 'utf8')

const MAX_HIGHLIGHTS = 6
const MAX_BODY_CHARS = 220

describe('RELEASE_NOTES', () => {
  test('the newest entry is the version being shipped', () => {
    expect(RELEASE_NOTES[0].version).toBe(PACKAGE_VERSION)
  })

  test('every entry has a CHANGELOG heading', () => {
    for (const notes of RELEASE_NOTES) {
      expect(CHANGELOG).toContain(`## CapForge v${notes.version}`)
    }
  })

  test('versions are strictly descending', () => {
    for (let i = 1; i < RELEASE_NOTES.length; i++) {
      expect(compareVersions(RELEASE_NOTES[i - 1].version, RELEASE_NOTES[i].version)).toBe(1)
    }
  })

  test('every entry has a headline and 1-6 readable highlights', () => {
    for (const notes of RELEASE_NOTES) {
      expect(notes.headline.trim().length).toBeGreaterThan(0)
      expect(notes.highlights.length).toBeGreaterThan(0)
      expect(notes.highlights.length).toBeLessThanOrEqual(MAX_HIGHLIGHTS)
      for (const highlight of notes.highlights) {
        expect(highlight.title.trim().length).toBeGreaterThan(0)
        expect(highlight.body.trim().length).toBeGreaterThan(0)
        expect(highlight.body.length).toBeLessThanOrEqual(MAX_BODY_CHARS)
      }
    }
  })

  test('the changelog link points at the releases page', () => {
    expect(RELEASES_URL).toBe('https://github.com/FRSname/CapForge/releases')
  })
})

describe('notesSince', () => {
  test('an unknown last seen version shows the current release only', () => {
    const notes = notesSince(null, PACKAGE_VERSION)
    expect(notes.map((n) => n.version)).toEqual([PACKAGE_VERSION])
  })

  test('nothing to say when the user already saw the current version', () => {
    expect(notesSince(PACKAGE_VERSION, PACKAGE_VERSION)).toEqual([])
  })

  test('a version CapForge has no notes for shows nothing', () => {
    expect(notesSince(null, '99.0.0')).toEqual([])
    expect(notesSince('1.0.0', '99.0.0')).toEqual([])
  })

  test('an update lists every version in between, newest first', () => {
    const notes = notesSince('0.0.1', PACKAGE_VERSION)
    expect(notes.length).toBe(RELEASE_NOTES.length)
    expect(notes[0].version).toBe(PACKAGE_VERSION)
    for (let i = 1; i < notes.length; i++) {
      expect(compareVersions(notes[i - 1].version, notes[i].version)).toBe(1)
    }
  })

  test('a downgrade says nothing', () => {
    expect(notesSince('99.0.0', PACKAGE_VERSION)).toEqual([])
  })

  test('the returned list is a copy, not the constant', () => {
    expect(notesSince(null, PACKAGE_VERSION)).not.toBe(RELEASE_NOTES)
  })
})
