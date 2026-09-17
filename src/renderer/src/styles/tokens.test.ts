/**
 * Every design token a component reads has to exist in `globals.css`.
 *
 * A `var(--color-foo)` that was never declared is invisible to the type system,
 * to eslint and to every other test: CSS resolves it to nothing and the element
 * silently falls back to an inherited colour, so a renamed token leaves dead
 * references behind that only a person looking at the pixels would catch. This
 * test reads the stylesheet and the whole renderer tree from disk and pairs the
 * two, the same way `lib/tourSteps.test.ts` keeps `data-tour` attributes alive.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const RENDERER_DIR = resolve(__dirname, '..')
const GLOBALS_CSS = resolve(__dirname, 'globals.css')

/** Only tokens from the design system are the stylesheet's to declare. */
const CHECKED_PREFIXES = [
  'color-',
  'shadow-',
  'radius-',
  'duration-',
  'ease-',
  'z-',
  'text-',
  'cf-font-',
  'focus-ring',
  'titlebar-h',
] as const

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.css'] as const

/** `--name:` — a declaration, wherever it is written. */
const DECLARATION_RE = /--([a-z0-9-]+)["'`]?\s*:/g
/** `var(--name` — a reference, including Tailwind's `[var(--name)]` form. */
const REFERENCE_RE = /var\(--([a-z0-9-]+)/g

function sourceFiles(): string[] {
  const files: string[] = []
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.includes('.test.')) continue
      else if (SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) files.push(path)
    }
  }
  walk(RENDERER_DIR)
  return files
}

function matches(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(new RegExp(pattern.source, 'g'))].map((match) => match[1])
}

function isChecked(name: string): boolean {
  return CHECKED_PREFIXES.some((prefix) => name.startsWith(prefix))
}

const FILES = sourceFiles()
const READ = new Map(FILES.map((path) => [path, readFileSync(path, 'utf8')]))

/** Declared by the stylesheet: `@theme`, `:root` and `:root.light`. */
const declared = new Set(matches(readFileSync(GLOBALS_CSS, 'utf8'), DECLARATION_RE))

/** Set by a component at runtime (`--library-tile`), so not the stylesheet's job. */
const runtime = new Set<string>()
for (const [path, text] of READ) {
  if (path.endsWith('.css')) continue
  for (const name of matches(text, DECLARATION_RE)) runtime.add(name)
}

/** token → the files that read it. */
const referencedIn = new Map<string, string[]>()
for (const [path, text] of READ) {
  for (const name of matches(text, REFERENCE_RE)) {
    const seen = referencedIn.get(name) ?? []
    if (!seen.includes(path)) seen.push(path)
    referencedIn.set(name, seen)
  }
}

describe('design tokens', () => {
  test('the stylesheet declares tokens and the renderer reads them', () => {
    expect(FILES.length).toBeGreaterThan(100)
    expect(declared.size).toBeGreaterThan(20)
    expect(referencedIn.size).toBeGreaterThan(20)
  })

  test('every referenced design token is declared in globals.css', () => {
    const undeclared = [...referencedIn]
      .filter(([name]) => isChecked(name) && !declared.has(name) && !runtime.has(name))
      .map(
        ([name, paths]) => `--${name} → ${paths.map((p) => relative(RENDERER_DIR, p)).join(', ')}`
      )
      .sort()

    expect(
      undeclared,
      `these tokens are read but never declared in styles/globals.css:\n${undeclared.join('\n')}`
    ).toEqual([])
  })
})

/* ── Contrast ──────────────────────────────────────────────────────────
   The three text tiers carry every label in the app, and `--color-on-accent`
   is the ink on every primary button. WCAG AA (4.5:1 for text, 3:1 for a
   control against its surface) is checked here from the declared values, so a
   palette edit that quietly drops a tier below legible fails CI instead of
   shipping. */

/** The `{ … }` body of the first block whose selector matches. */
function cssBlock(css: string, selector: string): string {
  const start = css.indexOf(selector)
  if (start < 0) throw new Error(`no ${selector} block in globals.css`)
  const open = css.indexOf('{', start)
  let depth = 0
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i)
  }
  throw new Error(`unterminated ${selector} block`)
}

/** `--name: #rrggbb` declarations of a block (other value shapes are skipped). */
function hexTokens(block: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const m of block.matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\b/g)) out.set(m[1], m[2])
  return out
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const AA_TEXT = 4.5
const AA_CONTROL = 3

const TEXT_TIERS = ['color-text', 'color-text-2', 'color-text-3'] as const
const SURFACES = [
  'color-bg',
  'color-base',
  'color-surface',
  'color-surface-2',
  'color-surface-3',
] as const

const CSS = readFileSync(GLOBALS_CSS, 'utf8')
const THEMES = {
  dark: hexTokens(cssBlock(CSS, '@theme')),
  light: hexTokens(cssBlock(CSS, ':root.light')),
}

describe.each(Object.entries(THEMES))('%s theme contrast', (_theme, tokens) => {
  const get = (name: string): string => {
    const v = tokens.get(name)
    if (!v) throw new Error(`--${name} is not a #rrggbb token in this theme`)
    return v
  }

  test.each(TEXT_TIERS.flatMap((t) => SURFACES.map((s) => [t, s] as const)))(
    '--%s on --%s reads at AA',
    (text, surface) => {
      expect(contrastRatio(get(text), get(surface))).toBeGreaterThanOrEqual(AA_TEXT)
    }
  )

  test('--color-on-accent is legible on --color-accent', () => {
    expect(contrastRatio(get('color-on-accent'), get('color-accent'))).toBeGreaterThanOrEqual(
      AA_TEXT
    )
  })

  test('--color-accent stands out from --color-surface as a control', () => {
    expect(contrastRatio(get('color-accent'), get('color-surface'))).toBeGreaterThanOrEqual(
      AA_CONTROL
    )
  })
})

/* ── Washes ────────────────────────────────────────────────────────────
   A hard-coded `rgba(255 255 255 / …)` hover is a colour that no theme can
   reach: it needed a `:root.light` twin for every rule, and the twins drifted.
   Outside the two token blocks (where the literals *are* the palette), every
   wash in the stylesheet has to come from a token — `--color-hover`,
   `--color-hover-strong`, `--color-scrim` or the scrollbar pair. docs/plans/ux-ui-refresh.md §6. */

/** `globals.css` with the two token blocks taken out. */
function ruleBodies(css: string): string {
  let rest = css
  for (const selector of ['@theme', ':root.light'])
    rest = rest.replace(cssBlock(rest, selector), '')
  return rest
}

describe('washes', () => {
  test('no rule hard-codes a black or white wash', () => {
    const offenders = ruleBodies(CSS)
      .split('\n')
      .filter((line) => /rgba\((?:255 255 255|0 0 0)/.test(line))
      .map((line) => line.trim())

    expect(
      offenders,
      `these rules hard-code a wash instead of reading a token:\n${offenders.join('\n')}`
    ).toEqual([])
  })
})
