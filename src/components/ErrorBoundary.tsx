/**
 * Error Boundary
 * --------------
 * Catches render-time errors and displays a diagnostic screen
 * instead of a blank white page.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  incidentId: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, incidentId: null };

  static getDerivedStateFromError(error: Error): State {
    const incidentId = 'ERR-' + Math.random().toString(36).substring(2, 9).toUpperCase();
    return { hasError: true, error, incidentId };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[ErrorBoundary ${this.state.incidentId}]`, error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      const isDev = import.meta.env.DEV;

      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-6">
          <div className="max-w-lg w-full rounded-2xl border border-destructive/30 bg-card p-8 shadow-lg">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 rounded-xl bg-destructive/10 text-destructive">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h1 className="text-xl font-bold text-foreground">Something went wrong</h1>
            </div>

            <p className="text-sm text-muted-foreground mb-4">
              An unexpected error occurred while rendering this page. Our team has been notified.
            </p>

            {this.state.incidentId && (
              <div className="text-xs bg-muted/60 text-muted-foreground rounded-lg px-3 py-2 mb-4 font-mono">
                Incident ID: <span className="text-foreground font-semibold">{this.state.incidentId}</span>
              </div>
            )}

            {isDev && (
              <details className="mb-4">
                <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground font-medium mb-2">
                  Developer Stack Trace
                </summary>
                <pre className="text-xs bg-muted rounded-lg p-4 overflow-auto max-h-64 whitespace-pre-wrap font-mono">
                  {this.state.error?.message}
                  {'\n\n'}
                  {this.state.error?.stack}
                </pre>
              </details>
            )}

            <div className="flex items-center gap-3 mt-6">
              <button
                onClick={() => window.location.reload()}
                className="inline-flex items-center justify-center rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                Reload page
              </button>
              <button
                onClick={() => {
                  window.location.href = '/';
                }}
                className="inline-flex items-center justify-center rounded-lg border border-input bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
              >
                Go to Home
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
