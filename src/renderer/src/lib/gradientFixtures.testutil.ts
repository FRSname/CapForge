/**
 * Loader for the shared gradient fixture, used by BOTH TypeScript gradient
 * suites — `gradient.test.ts` (the `lib/gradient.ts` core) and
 * `gradient.embedded.test.ts` (the JS embedded in the HTML/GSAP layer).
 *
 * The fixture lives on the backend side (`backend/tests/fixtures/gradient_cases.json`)
 * because the Pillow copy is the source of truth; all three languages read that
 * one file, mirroring `rsvpFixtures.testutil.ts`.
 *
 * Not a test file itself — `.testutil.ts` so vitest's `*.test.ts` glob skips it.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const FIXTURE_DIR = join(process.cwd(), 'backend', 'tests', 'fixtures')

/** A parsed spec as the fixture spells it: stops are `[offset, color]` pairs. */
export interface ExpectedSpec {
  angle: number
  stops: Array<[number, string]>
}

export interface ParseCase {
  input: string
  expected: ExpectedSpec | null
  note: string
}

export interface LineCase {
  angle: number
  box: [number, number, number, number]
  expected: [number, number, number, number]
  note: string
}

export interface StringCase {
  input: string
  expected: string | null
  note: string
}

export interface GradientFixtures {
  parse: ParseCase[]
  parseLongInput: { note: string; maxLength: number }
  line: LineCase[]
  toCss: StringCase[]
  flatHex: StringCase[]
  flatColor: StringCase[]
  closeDigits: number
}

export function loadGradientFixtures(): GradientFixtures {
  return JSON.parse(
    readFileSync(join(FIXTURE_DIR, 'gradient_cases.json'), 'utf8')
  ) as GradientFixtures
}

/**
 * Sentinel for "`flatHex` should reject this". The fixture spells rejection as
 * `null` because it is shared with Python; the fallback proves the branch ran.
 */
export const REJECTED = '<<fallback>>'

/** The over-long input, built rather than inlined — see the fixture's note. */
export function overLongGradient(): string {
  return `linear-gradient(90deg, ${'#FF0000 0%, '.repeat(60)}#00FF00 100%)`
}

/** Values a `.cfproj` or an MCP patch can put in a colour field besides a string. */
export const NON_STRING_VALUES: unknown[] = [
  null,
  undefined,
  42,
  1.5,
  true,
  ['#FFFFFF'],
  { color: '#FFFFFF' },
]
