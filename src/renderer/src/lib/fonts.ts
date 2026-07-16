/**
 * Font registry — loads bundled + user fonts and registers them with
 * `document.fonts` so the overlay canvas can render with them.
 *
 * Ports the (async () => loadSavedFonts)() IIFE from app.js:1904-1930.
 * Uses a module-level cache so fonts are registered exactly once per session,
 * regardless of how many times <FontPicker> mounts.
 */

import { api } from './api'

export type FontSource = 'system' | 'bundled' | 'custom'

export interface FontInfo {
  name: string
  path: string
  source: FontSource
}

// Track which (name|path) we've already registered so re-mounts are no-ops.
const registered = new Map<string, Promise<boolean>>()

const key = (name: string, path: string) => `${name}|${path}`

/**
 * Register a single font with document.fonts. Idempotent per (name, path).
 * Returns true on success, false if the binary couldn't be read/parsed.
 */
export function registerFont(name: string, path: string): Promise<boolean> {
  const k = key(name, path)
  const cached = registered.get(k)
  if (cached) return cached

  const task = (async () => {
    try {
      const buf = await window.subforge.readFont(path)
      if (!buf || buf.byteLength === 0) return false
      const face = new FontFace(name, buf)
      await face.load()
      document.fonts.add(face)
      return true
    } catch {
      return false
    }
  })()

  registered.set(k, task)
  return task
}

/** Register a FontFace directly from in-memory data (for fresh uploads). */
export async function registerFontFromBuffer(name: string, data: ArrayBuffer): Promise<boolean> {
  try {
    const face = new FontFace(name, data)
    await face.load()
    document.fonts.add(face)
    // Remember under every plausible key so later readFont(path) lookups skip reloading.
    registered.set(key(name, ''), Promise.resolve(true))
    return true
  } catch {
    return false
  }
}

/**
 * Merge font sources by family name. A user font wins over a bundled face,
 * which wins over the name-only system entry, so selecting a duplicate always
 * uses the most explicit local file.
 */
export function mergeFontCatalogs(
  systemNames: string[],
  bundled: Array<{ name: string; path: string }>,
  custom: Array<{ name: string; path: string }>
): FontInfo[] {
  const byName = new Map<string, FontInfo>()
  for (const name of systemNames) {
    const trimmed = name.trim()
    if (trimmed)
      byName.set(trimmed.toLocaleLowerCase(), { name: trimmed, path: '', source: 'system' })
  }
  for (const font of bundled) {
    byName.set(font.name.toLocaleLowerCase(), { ...font, source: 'bundled' })
  }
  for (const font of custom) {
    byName.set(font.name.toLocaleLowerCase(), { ...font, source: 'custom' })
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Load installed, bundled, and user fonts. Only bundled/user files need
 * FontFace registration; Chromium already knows how to render system fonts.
 */
export async function loadAllFonts(): Promise<FontInfo[]> {
  const [system, bundled, custom] = await Promise.all([
    api.getSystemFonts().catch((error) => {
      console.warn('[fonts] Could not load installed fonts:', error)
      return []
    }),
    window.subforge.listBundledFonts().catch(() => []),
    window.subforge.listFonts().catch(() => []),
  ])
  const all = mergeFontCatalogs(system, bundled, custom)
  // Fire registrations in parallel; don't block returning the list on font I/O.
  // A canvas draw that happens before a font resolves just renders in the
  // fallback face — the next draw after registration completes will use it.
  for (const font of all) {
    if (font.source !== 'system' && font.path) void registerFont(font.name, font.path)
  }
  return all
}
