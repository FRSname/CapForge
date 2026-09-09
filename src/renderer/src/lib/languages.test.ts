import { describe, expect, test } from 'vitest'
import {
  LANGUAGES,
  isKnownLanguage,
  languageLabel,
  languageScript,
  type LanguageScript,
} from './languages'

describe('LANGUAGES', () => {
  test('every entry carries a code, both labels and a script', () => {
    const scripts: LanguageScript[] = ['latin', 'cyrillic', 'greek', 'other']
    for (const lang of LANGUAGES) {
      expect(lang.code, JSON.stringify(lang)).toMatch(/^[a-z]{2}$/)
      expect(lang.label.length).toBeGreaterThan(0)
      expect(lang.nativeLabel.length).toBeGreaterThan(0)
      expect(scripts).toContain(lang.script)
    }
  })

  test('codes are unique', () => {
    const codes = LANGUAGES.map((l) => l.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  test('covers the European + major world set the picker promises', () => {
    const codes = new Set(LANGUAGES.map((l) => l.code))
    for (const code of ['en', 'es', 'fr', 'de', 'pl', 'ru', 'el', 'ar', 'zh', 'ja', 'hi']) {
      expect(codes.has(code), `missing ${code}`).toBe(true)
    }
    expect(LANGUAGES.length).toBeGreaterThanOrEqual(30)
  })
})

describe('languageLabel', () => {
  test('returns the English label for a known code', () => {
    expect(languageLabel('pl')).toBe('Polish')
    expect(languageLabel('en')).toBe('English')
  })

  test('is case-insensitive', () => {
    expect(languageLabel('PL')).toBe('Polish')
  })

  test('falls back to the uppercased code for an unknown language', () => {
    expect(languageLabel('xx')).toBe('XX')
    expect(languageLabel('')).toBe('')
  })
})

describe('languageScript', () => {
  test('classifies the scripts the font hint depends on', () => {
    expect(languageScript('pl')).toBe('latin')
    expect(languageScript('ru')).toBe('cyrillic')
    expect(languageScript('el')).toBe('greek')
    expect(languageScript('ja')).toBe('other')
  })

  test('unknown codes are "other" — never assumed Latin', () => {
    expect(languageScript('xx')).toBe('other')
  })
})

describe('isKnownLanguage', () => {
  test('true only for codes in the table', () => {
    expect(isKnownLanguage('de')).toBe(true)
    expect(isKnownLanguage('DE')).toBe(true)
    expect(isKnownLanguage('xx')).toBe(false)
  })
})
