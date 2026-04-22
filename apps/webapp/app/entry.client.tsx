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
// to the Rust side via `fetch("ipc://localhost/...")`. Multiple Sentry default
// integrations (browserTracing + the always-on Breadcrumbs integration)
// monkey-patch window.fetch. On the cross-origin ipc:// fetch, WKWebView blocks
// it (mixed-content + access-control), and Sentry's error path crashes on a
// minified variable ("Can't find variable: i"), killing the IPC bridge before
// Tauri can fall back to postMessage. Skipping Sentry.init entirely is the
// only reliable way to stop ALL fetch wrapping inside the desktop shell;
// verified by fetching the deployed Sentry chunk and confirming its fetch
// instrumentation is what's in the broken call stack.
// Errors inside the desktop app are captured by the Rust-side logger at
// ~/Library/Logs/me.getcore.app/CORE.log.
const isTauri =
  typeof window !== "undefined" &&
  !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

if (!isTauri) {
  init({
    dsn: (window as unknown as Record<string, string>).sentryDsn,
    tracesSampleRate: 1,
    enableLogs: true,

    integrations: [
      browserTracingIntegration({
        useEffect,
        useLocation,
        useMatches,
      }),
    ],

    sendDefaultPii: true,
  });
}

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <RemixBrowser />
    </StrictMode>,
  );
});
