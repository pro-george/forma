import { Component, type ReactNode } from 'react';

/** Last line of defence: a render error shows a card with the message and a reload, never a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  override componentDidCatch(error: Error, info: { componentStack?: string }) { console.error('Forma crashed', error, info.componentStack); }
  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash">
        <div className="crash-card">
          <h2>Something went wrong</h2>
          <p>Your work is saved in this browser. Reload to continue; if it happens again, send George the message below.</p>
          <pre>{this.state.error.message}</pre>
          <div className="actions">
            <button className="primary" onClick={() => location.reload()}>Reload</button>
            <button onClick={() => { try { localStorage.removeItem('forma.studio.doc.v1'); } catch { /* ignore */ } location.reload(); }}>Reload with an empty scene</button>
          </div>
        </div>
      </div>
    );
  }
}
