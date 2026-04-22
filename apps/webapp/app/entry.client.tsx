import { init, browserTracingIntegration } from "@sentry/remix";
/**
 * By default, Remix will handle hydrating your app on the client for you.
 * You are free to delete this file if you'd like to, but if you ever want it revealed again, you can run `npx remix reveal` ✨
 * For more information, see https://remix.run/file-conventions/entry.client
 */

import { RemixBrowser, useLocation, useMatches } from "@remix-run/react";
import { startTransition, StrictMode, useEffect } from "react";
import { hydrateRoot } from "react-dom/client";

// Tauri webview loads the remote webapp from https://app.getcore.me and talks
// to the Rust side via `fetch("ipc://localhost/...")`. Sentry's browser tracing
// integration monkey-patches window.fetch; on that cross-origin ipc:// fetch,
// WKWebView's access-control check fires and Sentry's wrapper crashes on a
// minified variable ("Can't find variable: i"), which kills the IPC bridge
// before Tauri can fall back to postMessage. Disable fetch tracing in Tauri
// — error reporting still works.
const isTauri =
  typeof window !== "undefined" &&
  !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

init({
  dsn: (window as unknown as Record<string, string>).sentryDsn,
  tracesSampleRate: isTauri ? 0 : 1,
  enableLogs: true,

  integrations: isTauri
    ? []
    : [
        browserTracingIntegration({
          useEffect,
          useLocation,
          useMatches,
        }),
      ],

  sendDefaultPii: true,
});

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <RemixBrowser />
    </StrictMode>,
  );
});
