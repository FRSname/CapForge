/**
 * Modal overlay shown while a render is in flight. Blocks the rest of the UI
 * — the user must wait for the render to finish or click Cancel.
 *
 * Uses `fixed` positioning so it overlays everything regardless of where it's
 * mounted in the tree.
 */

import type { RenderController } from '../../hooks/useRender'

interface Props {
  render: RenderController
}

export function RenderProgressModal({ render }: Props) {
  if (!render.busy) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Render in progress"
    >
      <div className="w-[420px] max-w-[90vw] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Rendering…</h2>
          <span className="text-xs tabular-nums text-[var(--color-text-3)]">{render.elapsed}</span>
        </div>

        <div className="w-full h-2 rounded-full overflow-hidden bg-[var(--color-surface-3)]">
          <div
            className="h-full rounded-full transition-all duration-300 bg-[var(--color-accent)]"
            style={{ width: `${render.progress}%` }}
          />
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-xs tabular-nums text-[var(--color-text-2)]">{render.progress}%</span>
          <span className="text-[11px] text-[var(--color-text-3)] truncate flex-1 text-right">{render.message}</span>
        </div>

        <div className="flex justify-end pt-1">
          <button
            className="btn-danger text-xs py-1.5 px-4"
            onClick={render.cancelRender}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
