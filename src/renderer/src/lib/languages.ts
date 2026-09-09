/**
 * The caption-track language table.
 *
 * Pure data: a caption track is stamped with an ISO 639-1 code at creation, and
 * this module is the only place that turns that code into something a human
 * reads (the tab label, the language picker) or that a heuristic reads (the
 * script, used for the "your bundled font is a Latin display face" hint — see
 * the plan's §G-2). There is deliberately **no language → font mapping**: every
 * face in `Fonts/` is Latin, so the hint points at system fonts instead of
 * silently repointing the user's style.
 *
 * Codes are compared case-insensitively; an unknown code is never guessed to be
 * Latin, because guessing wrong is exactly what suppresses the hint that would
 * have told the user their glyphs will be missing.
 */

export type LanguageScript = 'latin' | 'cyrillic' | 'greek' | 'other'

export interface LanguageInfo {
  /** ISO 639-1, lowercase. */
  code: string
  /** English name, shown in the picker and used as the default tab label. */
  label: string
  /** Endonym, shown as the picker's secondary line and matched by its filter. */
  nativeLabel: string
  script: LanguageScript
}

export const LANGUAGES: ReadonlyArray<LanguageInfo> = [
  { code: 'en', label: 'English', nativeLabel: 'English', script: 'latin' },
  { code: 'es', label: 'Spanish', nativeLabel: 'Español', script: 'latin' },
  { code: 'fr', label: 'French', nativeLabel: 'Français', script: 'latin' },
  { code: 'de', label: 'German', nativeLabel: 'Deutsch', script: 'latin' },
  { code: 'it', label: 'Italian', nativeLabel: 'Italiano', script: 'latin' },
  { code: 'pt', label: 'Portuguese', nativeLabel: 'Português', script: 'latin' },
  { code: 'nl', label: 'Dutch', nativeLabel: 'Nederlands', script: 'latin' },
  { code: 'pl', label: 'Polish', nativeLabel: 'Polski', script: 'latin' },
  { code: 'cs', label: 'Czech', nativeLabel: 'Čeština', script: 'latin' },
  { code: 'sk', label: 'Slovak', nativeLabel: 'Slovenčina', script: 'latin' },
  { code: 'sl', label: 'Slovenian', nativeLabel: 'Slovenščina', script: 'latin' },
  { code: 'hr', label: 'Croatian', nativeLabel: 'Hrvatski', script: 'latin' },
  { code: 'sr', label: 'Serbian', nativeLabel: 'Српски', script: 'cyrillic' },
  { code: 'sv', label: 'Swedish', nativeLabel: 'Svenska', script: 'latin' },
  { code: 'no', label: 'Norwegian', nativeLabel: 'Norsk', script: 'latin' },
  { code: 'da', label: 'Danish', nativeLabel: 'Dansk', script: 'latin' },
  { code: 'fi', label: 'Finnish', nativeLabel: 'Suomi', script: 'latin' },
  { code: 'is', label: 'Icelandic', nativeLabel: 'Íslenska', script: 'latin' },
  { code: 'et', label: 'Estonian', nativeLabel: 'Eesti', script: 'latin' },
  { code: 'lv', label: 'Latvian', nativeLabel: 'Latviešu', script: 'latin' },
  { code: 'lt', label: 'Lithuanian', nativeLabel: 'Lietuvių', script: 'latin' },
  { code: 'hu', label: 'Hungarian', nativeLabel: 'Magyar', script: 'latin' },
  { code: 'ro', label: 'Romanian', nativeLabel: 'Română', script: 'latin' },
  { code: 'tr', label: 'Turkish', nativeLabel: 'Türkçe', script: 'latin' },
  { code: 'el', label: 'Greek', nativeLabel: 'Ελληνικά', script: 'greek' },
  { code: 'ru', label: 'Russian', nativeLabel: 'Русский', script: 'cyrillic' },
  { code: 'uk', label: 'Ukrainian', nativeLabel: 'Українська', script: 'cyrillic' },
  { code: 'bg', label: 'Bulgarian', nativeLabel: 'Български', script: 'cyrillic' },
  { code: 'he', label: 'Hebrew', nativeLabel: 'עברית', script: 'other' },
  { code: 'ar', label: 'Arabic', nativeLabel: 'العربية', script: 'other' },
  { code: 'fa', label: 'Persian', nativeLabel: 'فارسی', script: 'other' },
  { code: 'hi', label: 'Hindi', nativeLabel: 'हिन्दी', script: 'other' },
  { code: 'bn', label: 'Bengali', nativeLabel: 'বাংলা', script: 'other' },
  { code: 'ta', label: 'Tamil', nativeLabel: 'தமிழ்', script: 'other' },
  { code: 'th', label: 'Thai', nativeLabel: 'ไทย', script: 'other' },
  { code: 'vi', label: 'Vietnamese', nativeLabel: 'Tiếng Việt', script: 'latin' },
  { code: 'id', label: 'Indonesian', nativeLabel: 'Bahasa Indonesia', script: 'latin' },
  { code: 'ms', label: 'Malay', nativeLabel: 'Bahasa Melayu', script: 'latin' },
  { code: 'zh', label: 'Chinese', nativeLabel: '中文', script: 'other' },
  { code: 'ja', label: 'Japanese', nativeLabel: '日本語', script: 'other' },
  { code: 'ko', label: 'Korean', nativeLabel: '한국어', script: 'other' },
]

const BY_CODE: ReadonlyMap<string, LanguageInfo> = new Map(LANGUAGES.map((l) => [l.code, l]))

/** Look a code up case-insensitively; `undefined` when it is not in the table. */
function find(code: string): LanguageInfo | undefined {
  return BY_CODE.get(code.trim().toLowerCase())
}

/**
 * The English name for a language code, or the code itself (uppercased) when it
 * is unknown — a tab must always have something to show.
 */
export function languageLabel(code: string): string {
  return find(code)?.label ?? code.trim().toUpperCase()
}

/** The writing system, `'other'` for anything not in the table. */
export function languageScript(code: string): LanguageScript {
  return find(code)?.script ?? 'other'
}

/** True when the code is one this table describes. */
export function isKnownLanguage(code: string): boolean {
  return find(code) !== undefined
}
