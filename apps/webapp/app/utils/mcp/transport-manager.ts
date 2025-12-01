import { type StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { type StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { type Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { type StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export interface IntegrationTransport {
  client: McpClient;
  transport: StreamableHTTPClientTransport | StdioClientTransport;
  integrationAccountId: string;
  slug: string;
  url?: string;
}

export interface SessionTransports {
  mainTransport?: StreamableHTTPServerTransport;
  integrationTransports: Map<string, IntegrationTransport>;
  createdAt: number;
}

/**
 * Manages MCP transports for sessions and integrations
 */
export class TransportManager {
  private static transports = new Map<string, SessionTransports>();

  /**
   * Create or get session transports
   */
  static getOrCreateSession(sessionId: string): SessionTransports {
    let session = this.transports.get(sessionId);

    if (!session) {
      session = {
        integrationTransports: new Map(),
        createdAt: Date.now(),
      };
      this.transports.set(sessionId, session);
    }

    return session;
  }

  /**
   * Set the main server transport for a session
   */
  static setMainTransport(
    sessionId: string,
    transport: StreamableHTTPServerTransport,
  ): void {
    const session = this.getOrCreateSession(sessionId);
    session.mainTransport = transport;

    // Setup cleanup on transport close
    transport.onclose = () => {
      this.cleanupSession(sessionId);
    };
  }

  /**
   * Clean up entire session and all its transports
   */
  static async cleanupSession(sessionId: string): Promise<void> {
    const session = this.transports.get(sessionId);
    if (!session) return;

    // Close all integration transports
    for (const [
      accountId,
      integrationTransport,
    ] of session.integrationTransports) {
      try {
        await integrationTransport.transport.close();
      } catch (error) {
        console.error(
          `Error closing integration transport ${accountId}:`,
          error,
        );
      }
    }

    // Close main transport if exists
    if (session.mainTransport) {
      try {
        session.mainTransport.close();
      } catch (error) {
        console.error(
          `Error closing main transport for session ${sessionId}:`,
          error,
        );
      }
    }

    // Remove from map
    this.transports.delete(sessionId);
  }

  /**
   * Get session info
   */
  static getSessionInfo(sessionId: string): {
    exists: boolean;
    integrationCount: number;
    createdAt?: number;
    mainTransport?: StreamableHTTPServerTransport;
  } {
    const session = this.transports.get(sessionId);

    return {
      exists: !!session,
      integrationCount: session?.integrationTransports.size || 0,
      createdAt: session?.createdAt,
      mainTransport: session?.mainTransport,
    };
  }

  /**
   * Clean up old sessions (older than specified time)
   */
  static async cleanupOldSessions(
    maxAgeMs: number = 24 * 60 * 60 * 1000,
  ): Promise<number> {
    const now = Date.now();
    const sessionsToCleanup: string[] = [];

    for (const [sessionId, session] of this.transports) {
      if (now - session.createdAt > maxAgeMs) {
        sessionsToCleanup.push(sessionId);
      }
    }

    for (const sessionId of sessionsToCleanup) {
      await this.cleanupSession(sessionId);
    }

    return sessionsToCleanup.length;
  }

  /**
   * Get all active sessions
   */
  static getActiveSessions(): string[] {
    return Array.from(this.transports.keys());
  }
}
