import { Component, type ReactNode } from 'react';

export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error(error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page"><div className="card card-pad stack" style={{ maxWidth: 560 }}>
        <h2>Something went wrong on this page</h2>
        <p className="hint">Your saved characters are safe in this browser, and unsaved editor changes are kept as a draft. Details: {this.state.error.message}</p>
        <div className="row"><button className="btn primary" onClick={() => this.setState({ error: null })}>Try again</button><a className="btn" href="/">Dashboard</a></div>
      </div></div>
    );
  }
}
