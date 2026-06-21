#!/usr/bin/env node
/**
 * Copy the build machine's ffmpeg + ffprobe into resources/bin-<platform>/ so
 * electron-builder bundles them — package.json maps resources/bin-win and
 * resources/bin-mac to the app's `bin/`, and the backend resolves them via
 * CAPFORGE_FFMPEG / CAPFORGE_FFPROBE (see python-manager.js + video_render.py).
 *
 * `resources/` is gitignored, so these binaries live per build machine; this
 * script makes populating them reproducible instead of a manual copy.
 *
 * Usage:
 *   node scripts/bundle-ffmpeg.mjs                 # resolve ffmpeg/ffprobe from PATH
 *   node scripts/bundle-ffmpeg.mjs --force         # overwrite existing copies
 *   FFMPEG=C:\tools\ffmpeg.exe FFPROBE=C:\tools\ffprobe.exe node scripts/bundle-ffmpeg.mjs
 *
 * Prefer a STATIC build (gyan.dev or BtbN on Windows) so the bundled exe has no
 * external DLL dependencies on the end user's machine.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, copyFileSync, chmodSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const isWin = process.platform === 'win32'
const binDir = join(root, 'resources', isWin ? 'bin-win' : 'bin-mac')
const exeName = (name) => (isWin ? `${name}.exe` : name)
const force = process.argv.includes('--force')

/** Resolve a tool from an explicit override or the system PATH. */
function resolveTool(name) {
  const override = process.env[name.toUpperCase()]
  if (override) {
    if (!existsSync(override)) throw new Error(`${name}: ${override} does not exist`)
    return override
  }
  try {
    const finder = isWin ? 'where' : 'which'
    const out = execFileSync(finder, [name], { encoding: 'utf-8' }).split(/\r?\n/)[0].trim()
    if (out && existsSync(out)) return out
  } catch {
    /* fall through to the error below */
  }
  throw new Error(
    `${name} not found on PATH. Install it (static build preferred) or pass ` +
      `${name.toUpperCase()}=/path/to/${exeName(name)}.`
  )
}

mkdirSync(binDir, { recursive: true })
for (const name of ['ffmpeg', 'ffprobe']) {
  const dest = join(binDir, exeName(name))
  if (existsSync(dest) && !force) {
    console.log(`✓ ${exeName(name)} already present in ${binDir} (use --force to overwrite)`)
    continue
  }
  const src = resolveTool(name)
  copyFileSync(src, dest)
  if (!isWin) chmodSync(dest, 0o755)
  console.log(`✓ copied ${src} → ${dest}`)
}
console.log(`Done. ffmpeg/ffprobe staged in ${binDir}. Now run \`npm run dist:${isWin ? 'win' : 'mac'}\`.`)
