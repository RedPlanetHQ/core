import { OAuthClientProvider, UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { OAuthError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import crypto from "crypto";
import net from "net";

// Global debug flag
export let DEBUG = false;

const pid = process.pid;

// Connection constants
export const REASON_AUTH_NEEDED = "authentication-needed";
export const REASON_TRANSPORT_FALLBACK = "falling-back-to-alternate-transport";

// Transport strategy types
export type TransportStrategy = "sse-only" | "http-only" | "sse-first" | "http-first";

export const MCP_REMOTE_VERSION = "1.0.0";

// Helper function for timestamp formatting
function getTimestamp(): string {
  const now = new Date();
  return now.toISOString();
}

// Debug logging function
export function debugLog(message: string, ...args: any[]) {
  if (!DEBUG) return;
  const formattedMessage = `[${getTimestamp()}][${pid}] ${message}`;
  console.error(formattedMessage, ...args);
}

export function log(str: string, ...rest: unknown[]) {
  console.error(`[${pid}] ${str}`, ...rest);
  if (DEBUG) {
    debugLog(str, ...rest);
  }
}

/**
 * Type for the auth initialization function
 */
export type AuthInitializer = () => Promise<{
  waitForAuthCode: () => Promise<string>;
  skipBrowserAuth: boolean;
}>;

/**
 * Creates and connects to a remote server with OAuth authentication
 */
export async function connectToRemoteServer(
  client: Client | null,
  serverUrl: string,
  authProvider: OAuthClientProvider,
  headers: Record<string, string>,
  authInitializer: AuthInitializer,
  transportStrategy: TransportStrategy = "http-first",
  recursionReasons: Set<string> = new Set()
): Promise<Transport> {
  log(`[${pid}] Connecting to remote server: ${serverUrl}`);
  const url = new URL(serverUrl);

  // Create transport with eventSourceInit to pass Authorization header if present
  const eventSourceInit = {
    fetch: (url: string | URL, init?: RequestInit) => {
      return Promise.resolve(authProvider?.tokens?.()).then((tokens) =>
        fetch(url, {
          ...init,
          headers: {
            ...(init?.headers as Record<string, string> | undefined),
            ...headers,
            ...(tokens?.access_token ? { Authorization: `Bearer ${tokens.access_token}` } : {}),
            Accept: "text/event-stream",
          } as Record<string, string>,
        })
      );
    },
  };

  log(`Using transport strategy: ${transportStrategy}`);
  const shouldAttemptFallback =
    transportStrategy === "http-first" || transportStrategy === "sse-first";

  // Create transport instance based on the strategy
  const sseTransport = transportStrategy === "sse-only" || transportStrategy === "sse-first";
  const transport = sseTransport
    ? new SSEClientTransport(url, {
        authProvider,
        requestInit: { headers },
        eventSourceInit,
      })
    : new StreamableHTTPClientTransport(url, {
        authProvider,
        requestInit: { headers },
      });

  try {
    if (DEBUG) debugLog("Attempting to connect to remote server", { sseTransport });

    if (client) {
      if (DEBUG) debugLog("Connecting client to transport");
      await client.connect(transport as Transport);
    } else {
      if (DEBUG) debugLog("Starting transport directly");
      await transport.start();
      if (!sseTransport) {
        if (DEBUG) debugLog("Creating test transport for HTTP-only connection test");
        const testTransport = new StreamableHTTPClientTransport(url, {
          authProvider,
          requestInit: { headers },
        }) as Transport;
        const testClient = new Client(
          { name: "mcp-remote-fallback-test", version: "0.0.0" },
          { capabilities: {} }
        );
        await testClient.connect(testTransport);
      }
    }
    log(`Connected to remote server using ${transport.constructor.name}`);

    return transport as Transport;
  } catch (error: any) {
    // Check if it's a protocol error and we should attempt fallback
    if (
      error instanceof Error &&
      shouldAttemptFallback &&
      (error.message.includes("405") ||
        error.message.includes("Method Not Allowed") ||
        error.message.includes("404") ||
        error.message.includes("Not Found"))
    ) {
      log(`Received error: ${error.message}`);

      // If we've already tried falling back once, throw an error
      if (recursionReasons.has(REASON_TRANSPORT_FALLBACK)) {
        const errorMessage = `Already attempted transport fallback. Giving up.`;
        log(errorMessage);
        throw new Error(errorMessage);
      }

      log(`Recursively reconnecting for reason: ${REASON_TRANSPORT_FALLBACK}`);

      // Add to recursion reasons set
      recursionReasons.add(REASON_TRANSPORT_FALLBACK);

      // Recursively call connectToRemoteServer with the updated recursion tracking
      return connectToRemoteServer(
        client,
        serverUrl,
        authProvider,
        headers,
        authInitializer,
        sseTransport ? "http-only" : "sse-only",
        recursionReasons
      );
    } else if (
      error instanceof UnauthorizedError ||
      (error instanceof Error && error.message.includes("Unauthorized"))
    ) {
      log("Authentication required. Initializing auth...");
      if (DEBUG) {
        debugLog("Authentication error detected", {
          errorCode: error instanceof OAuthError ? error.errorCode : undefined,
          errorMessage: error.message,
          stack: error.stack,
        });
      }

      // Initialize authentication on-demand
      if (DEBUG) debugLog("Calling authInitializer to start auth flow");
      const { waitForAuthCode, skipBrowserAuth } = await authInitializer();

      if (skipBrowserAuth) {
        log("Authentication required but skipping browser auth - using shared auth");
      } else {
        log("Authentication required. Waiting for authorization...");
      }

      // Wait for the authorization code from the callback
      if (DEBUG) debugLog("Waiting for auth code from callback server");
      const code = await waitForAuthCode();
      if (DEBUG) debugLog("Received auth code from callback server");

      try {
        log("Completing authorization...");
        await transport.finishAuth(code);
        if (DEBUG) debugLog("Authorization completed successfully");

        if (recursionReasons.has(REASON_AUTH_NEEDED)) {
          const errorMessage = `Already attempted reconnection for reason: ${REASON_AUTH_NEEDED}. Giving up.`;
          log(errorMessage);
          if (DEBUG)
            debugLog("Already attempted auth reconnection, giving up", {
              recursionReasons: Array.from(recursionReasons),
            });
          throw new Error(errorMessage);
        }

        // Track this reason for recursion
        recursionReasons.add(REASON_AUTH_NEEDED);
        log(`Recursively reconnecting for reason: ${REASON_AUTH_NEEDED}`);
        if (DEBUG)
          debugLog("Recursively reconnecting after auth", {
            recursionReasons: Array.from(recursionReasons),
          });

        // Recursively call connectToRemoteServer with the updated recursion tracking
        return connectToRemoteServer(
          client,
          serverUrl,
          authProvider,
          headers,
          authInitializer,
          transportStrategy,
          recursionReasons
        );
      } catch (authError: any) {
        log("Authorization error:", authError);
        if (DEBUG)
          debugLog("Authorization error during finishAuth", {
            errorMessage: authError.message,
            stack: authError.stack,
          });
        throw authError;
      }
    } else {
      log("Connection error:", error);
      if (DEBUG)
        debugLog("Connection error", {
          errorMessage: error.message,
          stack: error.stack,
          transportType: transport.constructor.name,
        });
      throw error;
    }
  }
}

/**
 * Finds an available port on the local machine
 */
export async function findAvailablePort(preferredPort?: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        // If preferred port is in use, get a random port
        server.listen(0);
      } else {
        reject(err);
      }
    });

    server.on("listening", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => {
        resolve(port);
      });
    });

    // Try preferred port first, or get a random port
    server.listen(preferredPort || 0);
  });
}

/**
 * Generates a hash for the server URL to use in filenames
 */
export function getServerUrlHash(serverUrl: string): string {
  return crypto.createHash("md5").update(serverUrl).digest("hex");
}

/**
 * Sets up signal handlers for graceful shutdown
 */
export function setupSignalHandlers(cleanup: () => Promise<void>) {
  process.on("SIGINT", async () => {
    log("\nShutting down...");
    await cleanup();
    process.exit(0);
  });

  // Keep the process alive
  process.stdin.resume();
  process.stdin.on("end", async () => {
    log("\nShutting down...");
    await cleanup();
    process.exit(0);
  });
}
