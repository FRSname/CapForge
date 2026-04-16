import type { Screen } from '../../types/app'

interface TitleBarProps {
  screen: Screen
  onNew: () => void
}

export function TitleBar({ screen, onNew }: TitleBarProps) {
  const showNew = screen === 'results'
  const showSave = screen === 'results'

  return (
    <header
      className="app-drag flex items-center justify-between px-3 shrink-0 border-b border-white/[0.06]"
      style={{ height: 'var(--titlebar-h)' }}
    >
      {/* Left: logo + name */}
      <div className="flex items-center gap-2 select-none">
        <svg className="text-[var(--color-accent)]" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v12.5A1.75 1.75 0 0 1 14.25 16H1.75A1.75 1.75 0 0 1 0 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25V1.75a.25.25 0 0 0-.25-.25ZM3 5.5a.75.75 0 0 1 .75-.75h8.5a.75.75 0 0 1 0 1.5h-8.5A.75.75 0 0 1 3 5.5Zm.75 2.75a.75.75 0 0 0 0 1.5h5.5a.75.75 0 0 0 0-1.5Z" />
        </svg>
        <span className="font-semibold text-[13px] tracking-tight">CapForge</span>
      </div>

      {/* Right: action buttons */}
      <div className="app-no-drag flex items-center gap-1">
        {showSave && (
          <button
            className="titlebar-btn"
            title="Save Project (Ctrl+S)"
            onClick={() => {/* TODO: save project */}}
          >
            Save
          </button>
        )}

        <button
          className="titlebar-btn"
          title="Open Project (Ctrl+O)"
          onClick={() => {/* TODO: open project */}}
        >
          Open
        </button>

        {showNew && (
          <button
            className="titlebar-btn"
            title="New Transcription"
            onClick={onNew}
          >
            New
          </button>
        )}
      </div>
    </header>
  )
}
