import type { Screen } from '../../types/app'

interface TitleBarProps {
  screen: Screen
  onNew:            () => void
  onSave:           () => void
  onOpen:           () => void
  onSettingsToggle: () => void
  onExport?:        () => void
}

export function TitleBar({ screen, onNew, onSave, onOpen, onSettingsToggle, onExport }: TitleBarProps) {
  const showResults = screen === 'results'

  return (
    <header
      className="app-drag flex items-center justify-between px-3 shrink-0 border-b border-[var(--color-border)]"
      style={{
        height: 'var(--titlebar-h)',
        background: 'linear-gradient(180deg, rgba(255,255,255,0.03) 0%, transparent 100%)',
      }}
    >
      {/* Left: logo */}
      <div className="flex items-center gap-2 select-none">
        <svg
          width="15" height="15" viewBox="0 0 16 16" fill="currentColor"
          className="text-[var(--color-accent)]"
        >
          <path d="M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v12.5A1.75 1.75 0 0 1 14.25 16H1.75A1.75 1.75 0 0 1 0 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25V1.75a.25.25 0 0 0-.25-.25ZM3 5.5a.75.75 0 0 1 .75-.75h8.5a.75.75 0 0 1 0 1.5h-8.5A.75.75 0 0 1 3 5.5Zm.75 2.75a.75.75 0 0 0 0 1.5h5.5a.75.75 0 0 0 0-1.5Z" />
        </svg>
        <span className="font-semibold tracking-tight text-[13px] text-[var(--color-text)]">
          CapForge
        </span>
      </div>

      {/* Right: actions */}
      <div className="app-no-drag flex items-center gap-1">
        {showResults && onExport && (
          <button
            className="titlebar-btn flex items-center gap-1.5"
            onClick={onExport}
            title="Export subtitles / render"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2.75 14A1.75 1.75 0 0 1 1 12.25v-2.5a.75.75 0 0 1 1.5 0v2.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25v-2.5a.75.75 0 0 1 1.5 0v2.5A1.75 1.75 0 0 1 13.25 14Zm1.72-4.53a.75.75 0 0 1 0-1.06l3-3a.75.75 0 0 1 1.06 0l3 3a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8.75 7.56v5.69a.75.75 0 0 1-1.5 0V7.56L5.53 9.47a.75.75 0 0 1-1.06 0Z"/>
            </svg>
            Export
          </button>
        )}

        {showResults && (
          <>
            <button
              className="titlebar-btn"
              title="Save Project (Ctrl+S)"
              onClick={onSave}
            >
              Save
            </button>
            <button className="titlebar-btn" onClick={onNew} title="New Transcription">New</button>
          </>
        )}

        <button
          className="titlebar-btn"
          title="Open Project (Ctrl+O)"
          onClick={onOpen}
        >
          Open
        </button>

        {/* Settings gear */}
        <button
          className="icon-btn app-no-drag ml-0.5"
          title="Settings"
          onClick={onSettingsToggle}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 0a8.2 8.2 0 0 1 .701.031C9.444.095 9.99.645 10.16 1.29l.288 1.107c.018.066.079.158.212.224.231.114.454.243.668.386.123.082.233.07.299.04l1.08-.43c.602-.24 1.29-.048 1.694.508a8 8 0 0 1 1.058 1.832c.208.577.04 1.224-.378 1.63l-.792.676a.336.336 0 0 0-.096.283c.026.27.04.544.04.822s-.014.552-.04.822a.336.336 0 0 0 .096.283l.792.676c.418.406.586 1.053.378 1.63a8 8 0 0 1-1.058 1.832c-.404.556-1.092.748-1.694.508l-1.08-.43c-.066-.03-.176-.042-.299.04a5 5 0 0 1-.668.386c-.133.066-.194.158-.212.224l-.288 1.107c-.17.645-.716 1.195-1.459 1.26a8.1 8.1 0 0 1-1.402 0c-.743-.065-1.289-.615-1.459-1.26l-.288-1.107a.34.34 0 0 0-.212-.224 5 5 0 0 1-.668-.386c-.123-.082-.233-.07-.299-.04l-1.08.43c-.602.24-1.29.048-1.694-.508a8 8 0 0 1-1.058-1.832c-.208-.577-.04-1.224.378-1.63l.792-.676a.336.336 0 0 0 .096-.283 5 5 0 0 1 0-1.644.336.336 0 0 0-.096-.283l-.792-.676c-.418-.406-.586-1.053-.378-1.63a8 8 0 0 1 1.058-1.832c.404-.556 1.092-.748 1.694-.508l1.08.43c.066.03.176.042.299-.04.214-.143.437-.272.668-.386.133-.066.194-.158.212-.224l.288-1.107C6.01.645 6.556.095 7.299.03 7.53.01 7.764 0 8 0Zm-.571 1.525c-.036.003-.108.036-.137.146l-.289 1.105c-.147.561-.55.967-.997 1.189-.174.086-.342.183-.504.29-.417.276-.93.379-1.457.155l-1.08-.43c-.109-.044-.196.017-.231.065a6.5 6.5 0 0 0-.86 1.491c-.065.18.005.29.058.338l.793.677c.428.365.653.898.626 1.448-.009.18-.009.363 0 .542.027.55-.198 1.083-.626 1.448l-.793.677c-.053.047-.123.158-.058.338.18.497.418.969.86 1.491.035.048.122.11.231.065l1.08-.43c.527-.224 1.04-.121 1.457.155.162.107.33.204.504.29.447.222.85.628.997 1.189l.289 1.105c.029.11.1.143.137.146a6.6 6.6 0 0 0 1.142 0c.036-.003.108-.036.137-.146l.289-1.105c.147-.561.55-.967.997-1.189.174-.086.342-.183.504-.29.417-.276.93-.379 1.457-.155l1.08.43c.109.044.196-.017.231-.065.442-.522.68-.994.86-1.491.065-.18-.005-.29-.058-.338l-.793-.677c-.428-.365-.653-.898-.626-1.448.009-.18.009-.363 0-.542-.027-.55.198-1.083.626-1.448l.793-.677c.053-.047.123-.158.058-.338a6.5 6.5 0 0 0-.86-1.491c-.035-.048-.122-.11-.231-.065l-1.08.43c-.527.224-1.04.121-1.457-.155a4 4 0 0 0-.504-.29c-.447-.222-.85-.628-.997-1.189l-.289-1.105c-.029-.11-.1-.143-.137-.146a6.6 6.6 0 0 0-1.142 0ZM11 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM9.5 8a1.5 1.5 0 1 0-3.001.001A1.5 1.5 0 0 0 9.5 8Z"/>
          </svg>
        </button>
      </div>
    </header>
  )
}
