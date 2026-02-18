/**
 * By default, Remix will handle generating the HTTP Response for you.
 * You are free to delete this file if you'd like to, but if you ever want it revealed again, you can run `npx remix reveal` ✨
 * For more information, see https://remix.run/file-conventions/entry.server
 */

import { PassThrough } from "node:stream";

import {
  type AppLoadContext,
  type EntryContext,
  createReadableStreamFromReadable,
} from "@remix-run/node";
import { RemixServer } from "@remix-run/react";
import { isbot } from "isbot";
import { renderToPipeableStream } from "react-dom/server";
import { initializeStartupServices } from "./utils/startup";
import { handleMCPRequest, handleSessionRequest } from "~/services/mcp.server";
import { authenticateHybridRequest } from "~/services/routeBuilders/apiBuilder.server";
import { trackError } from "~/services/telemetry.server";
import {
  verifyGatewayToken,
  upsertGateway,
  updateGatewayTools,
  updateGatewayLastSeen,
  disconnectGateway,
} from "~/services/gateway.server";

const ABORT_DELAY = 5_000;

async function init() {
  // Initialize startup services once per server process
  await initializeStartupServices();
}

init();

/**
 * Global error handler for all server-side errors
 * This catches errors from loaders, actions, and rendering
 * Automatically tracks all errors to telemetry
 */
export function handleError(
  error: unknown,
  { request }: { request: Request },
): void {
  // Don't track 404s or aborted requests as errors
  if (
    error instanceof Response &&
    (error.status === 404 || error.status === 304)
  ) {
    return;
  }

  // Track error to telemetry
  if (error instanceof Error) {
    const url = new URL(request.url);
    trackError(error, {
      url: request.url,
      path: url.pathname,
      method: request.method,
      userAgent: request.headers.get("user-agent") || "unknown",
      referer: request.headers.get("referer") || undefined,
    }).catch((trackingError) => {
      // If telemetry tracking fails, just log it - don't break the app
      console.error("Failed to track error:", trackingError);
    });
  }

  // Always log to console for development/debugging
  console.error(error);
}

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext,
  // This is ignored so we can keep it in the template for visibility.  Feel
  // free to delete this parameter in your app if you're not using it!
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  loadContext: AppLoadContext,
) {
  return isbot(request.headers.get("user-agent") || "")
    ? handleBotRequest(
        request,
        responseStatusCode,
        responseHeaders,
        remixContext,
      )
    : handleBrowserRequest(
        request,
        responseStatusCode,
        responseHeaders,
        remixContext,
      );
}

function handleBotRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext,
) {
  return new Promise((resolve, reject) => {
    let shellRendered = false;
    const { pipe, abort } = renderToPipeableStream(
      <RemixServer
        context={remixContext}
        url={request.url}
        abortDelay={ABORT_DELAY}
      />,
      {
        onAllReady() {
          shellRendered = true;
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set("Content-Type", "text/html");

          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          );

          pipe(body);
        },
        onShellError(error: unknown) {
          reject(error);
        },
        onError(error: unknown) {
          responseStatusCode = 500;
          // Log streaming rendering errors from inside the shell.  Don't log
          // errors encountered during initial shell rendering since they'll
          // reject and get logged in handleDocumentRequest.
          if (shellRendered) {
            console.error(error);
          }
        },
      },
    );

    setTimeout(abort, ABORT_DELAY);
  });
}

function handleBrowserRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext,
) {
  return new Promise((resolve, reject) => {
    let shellRendered = false;
    const { pipe, abort } = renderToPipeableStream(
      <RemixServer
        context={remixContext}
        url={request.url}
        abortDelay={ABORT_DELAY}
      />,
      {
        onShellReady() {
          shellRendered = true;
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set("Content-Type", "text/html");

          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          );

          pipe(body);
        },
        onShellError(error: unknown) {
          reject(error);
        },
        onError(error: unknown) {
          responseStatusCode = 500;
          // Log streaming rendering errors from inside the shell.  Don't log
          // errors encountered during initial shell rendering since they'll
          // reject and get logged in handleDocumentRequest.
          if (shellRendered) {
            console.error(error);
          }
        },
      },
    );

    setTimeout(abort, ABORT_DELAY);
  });
}

export {
  handleMCPRequest,
  handleSessionRequest,
  authenticateHybridRequest,
  // Gateway functions
  verifyGatewayToken,
  upsertGateway,
  updateGatewayTools,
  updateGatewayLastSeen,
  disconnectGateway,
};
