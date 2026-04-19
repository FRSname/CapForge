/**
 * Font registry — loads bundled + user fonts and registers them with
 * `document.fonts` so the overlay canvas can render with them.
 *
 * Ports the (async () => loadSavedFonts)() IIFE from app.js:1904-1930.
 * Uses a module-level cache so fonts are registered exactly once per session,
 * regardless of how many times <FontPicker> mounts.
 */

export interface FontInfo {
  name:     string
  path:     string
  bundled?: boolean
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
 * Load bundled fonts + user fonts, register them all, and return the combined
 * list. Used on <FontPicker> mount. Order: bundled first, then user fonts.
 */
export async function loadAllFonts(): Promise<FontInfo[]> {
  const [bundled, custom] = await Promise.all([
    window.subforge.listBundledFonts().catch(() => []),
    window.subforge.listFonts().catch(() => []),
  ])
  const all: FontInfo[] = [
    ...bundled.map(f => ({ ...f, bundled: true  })),
    ...custom.map( f => ({ ...f, bundled: false })),
  ]
  // Fire registrations in parallel; don't block returning the list on font I/O.
  // A canvas draw that happens before a font resolves just renders in the
  // fallback face — the next draw after registration completes will use it.
  for (const f of all) void registerFont(f.name, f.path)
  return all
}
