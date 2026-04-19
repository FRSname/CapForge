import { Component, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/globals.css'
import { App } from './App'

class ErrorBoundary extends Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[CapForge] Render crash:', error, info.componentStack)
  }
  render() {
    if (this.state.error) {
      const err = this.state.error as Error
      return (
        <div style={{ padding: 32, fontFamily: 'monospace', color: '#f87171', background: '#0b0b0e', height: '100vh' }}>
          <h2 style={{ marginBottom: 12 }}>Render Error</h2>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{err.message}</pre>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11, color: '#9ca3af', marginTop: 12 }}>{err.stack}</pre>
        </div>
      )
    }
    return this.props.children
  }
}

// Catch unhandled promise rejections and JS errors
window.addEventListener('unhandledrejection', e => {
  console.error('[CapForge] Unhandled rejection:', e.reason)
})
window.onerror = (msg, src, line, col, err) => {
  console.error('[CapForge] JS error:', msg, src, line, col, err)
}

const root = document.getElementById('root')!
createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
)
