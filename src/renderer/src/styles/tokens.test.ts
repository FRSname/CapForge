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
      .map(([name, paths]) => `--${name} → ${paths.map((p) => relative(RENDERER_DIR, p)).join(', ')}`)
      .sort()

    expect(
      undeclared,
      `these tokens are read but never declared in styles/globals.css:\n${undeclared.join('\n')}`
    ).toEqual([])
  })
})
