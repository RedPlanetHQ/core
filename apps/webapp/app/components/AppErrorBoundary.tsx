import React from "react";
import { NoInternet } from "./common/no-internet";

type Props = { children: React.ReactNode };
type State = { hasError: boolean };

/**
 * Client-side React error boundary. Catches runtime rendering errors that
 * Remix's route ErrorBoundary can miss — notably React error #418, which
 * fires when a WebSocket reconnect (Hocuspocus) triggers a state update
 * while React is still hydrating a streamed Suspense boundary. Without this,
 * the whole tree unmounts and the page goes white.
 *
 * We deliberately render the same NoInternet fallback here: it already
 * knows how to auto-reload (immediately if online, on the next `online`
 * event if offline), which is the right recovery for both the offline case
 * and the hydration-crash case.
 */
export class AppErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const w = window as unknown as { Sentry?: { captureException?: Function } };
    try {
      w?.Sentry?.captureException?.(error, { extra: info });
    } catch {
      /* noop */
    }
    console.error("AppErrorBoundary caught:", error, info);
  }

  render() {
    if (this.state.hasError) return <NoInternet />;
    return this.props.children;
  }
}
