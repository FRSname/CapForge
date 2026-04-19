/// <reference types="vite/client" />

// Re-declare the IPC bridge types for the renderer
// (the canonical source is src/preload/index.ts)
import type { SubforgeApi } from '../../../preload/index'

declare global {
  interface Window {
    subforge: SubforgeApi
  }

  // Electron extends the browser File API with a path property
  interface File {
    readonly path: string
  }
}
