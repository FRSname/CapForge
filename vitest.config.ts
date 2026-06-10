/**
 * Standalone Vitest config — deliberately separate from electron.vite.config.ts
 * (that one is electron-vite specific and not consumable by vitest).
 *
 * Tests target pure renderer modules (lib/), so the plain node environment is
 * enough — no jsdom, no React rendering.
 */

import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/renderer/src/**/*.test.ts'],
  },
})
