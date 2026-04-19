/**
 * Electron main process entry point (TypeScript).
 *
 * During migration this file re-exports the existing CommonJS main.js.
 * Once all modules are ported to TS, replace the require() with direct imports.
 *
 * To migrate: copy logic from electron/main.js into this file incrementally,
 * converting require() to import and callback patterns to async/await.
 */

// TODO: Replace with direct TS port of electron/main.js
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('../../electron/main.js')
