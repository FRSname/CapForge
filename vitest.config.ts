/**
 * Standalone Vitest config — deliberately separate from electron.vite.config.ts
 * (that one is electron-vite specific and not consumable by vitest).
 *
 * Tests run in the plain node environment (no jsdom dependency):
 * - lib/ tests exercise pure modules directly
 * - components/ui/ tests render primitives to static HTML via
 *   react-dom/server and assert on the markup (classes, roles, aria)
 */

import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src'),
    },
  },
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    environment: 'node',
    include: ['src/renderer/src/**/*.test.{ts,tsx}'],
  },
})
