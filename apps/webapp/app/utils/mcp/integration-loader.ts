import { prisma } from "~/db.server";
import { execFile } from "child_process";
import { promisify } from "util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const execFileAsync = promisify(execFile);

export interface CustomMcpIntegration {
  id: string;
  name: string;
  serverUrl: string;
  oauth?: {
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
    clientId?: string;
  };
}

export interface CustomMcpAccount {
  id: string;
  accountId: string;
  integrationConfiguration: any;
  isActive: boolean;
  isCustomMcp: true;
  integrationDefinition: {
    id: string;
    name: string;
    slug: string;
    spec: any;
  };
  serverUrl: string;
  accessToken?: string;
}

export interface IntegrationAccountWithDefinition {
  id: string;
  integrationDefinitionId: string;
  accountId: string | null;
  integrationConfiguration: any;
  isActive: boolean;
  integrationDefinition: {
    id: string;
    name: string;
    slug: string;
    spec: any;
  };
}

/**
 * Loads and manages integration accounts for MCP sessions
 */
export class IntegrationLoader {
  /**
   * Get all connected and active integration accounts for a user/workspace
   * Filtered by integration slugs if provided
   * Also includes custom MCP integrations from user metadata
   */
  static async getConnectedIntegrationAccounts(
    userId: string,
    workspaceId: string,
    integrationSlugs?: string[],
  ): Promise<(IntegrationAccountWithDefinition | CustomMcpAccount)[]> {
    const whereClause: any = {
      integratedById: userId,
      workspaceId: workspaceId,
      isActive: true,
      deleted: null,
    };

    // Filter by integration slugs if provided
    if (integrationSlugs && integrationSlugs.length > 0) {
      whereClause.integrationDefinition = {
        slug: {
          in: integrationSlugs,
        },
      };
    }

    const integrationAccounts = await prisma.integrationAccount.findMany({
      where: whereClause,
      include: {
        integrationDefinition: {
          select: {
            id: true,
            name: true,
            slug: true,
            spec: true,
            config: true,
          },
        },
      },
    });

    // Also get custom MCP integrations from user metadata
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { metadata: true },
    });

    const metadata = (user?.metadata as any) || {};
    const customMcpIntegrations = (metadata?.mcpIntegrations ||
      []) as CustomMcpIntegration[];

    // Convert custom MCPs to the same format as regular integration accounts
    const customMcpAccounts: CustomMcpAccount[] = customMcpIntegrations
      .filter((mcp) => mcp.oauth?.accessToken) // Only include connected ones
      .map((mcp) => ({
        id: mcp.id,
        accountId: mcp.id,
        integrationConfiguration: {
          accessToken: mcp.oauth?.accessToken,
        },
        isActive: true,
        isCustomMcp: true as const,
        integrationDefinition: {
          id: mcp.id,
          name: mcp.name,
          slug: mcp.name.toLowerCase().replace(/\s+/g, "-"),
          spec: null,
        },
        serverUrl: mcp.serverUrl,
        accessToken: mcp.oauth?.accessToken,
      }));

    return [...integrationAccounts, ...customMcpAccounts];
  }

  /**
   * Get integration account by ID (supports both regular and custom MCP accounts)
   */
  static async getIntegrationAccountById(
    accountId: string,
    userId?: string,
  ): Promise<IntegrationAccountWithDefinition | CustomMcpAccount> {
    // First try regular integration account
    const account = await prisma.integrationAccount.findUnique({
      where: { id: accountId },
      include: {
        integrationDefinition: {
          select: {
            id: true,
            name: true,
            slug: true,
            spec: true,
            config: true,
          },
        },
      },
    });

    if (account && account.isActive) {
      return account;
    }

    // If not found, check custom MCP integrations from user metadata
    if (userId) {
      const customMcp = await this.getCustomMcpById(accountId, userId);
      if (customMcp) {
        return customMcp;
      }
    }

    throw new Error(
      `Integration account '${accountId}' not found or not active.`,
    );
  }

  /**
   * Get a custom MCP integration by ID from user metadata
   */
  static async getCustomMcpById(
    mcpId: string,
    userId: string,
  ): Promise<CustomMcpAccount | null> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { metadata: true },
    });

    const metadata = (user?.metadata as any) || {};
    const customMcpIntegrations = (metadata?.mcpIntegrations ||
      []) as CustomMcpIntegration[];

    const mcp = customMcpIntegrations.find((m) => m.id === mcpId);
    if (!mcp || !mcp.oauth?.accessToken) {
      return null;
    }

    return {
      id: mcp.id,
      accountId: mcp.id,
      integrationConfiguration: {
        accessToken: mcp.oauth.accessToken,
        refreshToken: mcp.oauth.refreshToken,
        expiresIn: mcp.oauth.expiresIn,
        clientId: mcp.oauth.clientId,
      },
      isActive: true,
      isCustomMcp: true as const,
      integrationDefinition: {
        id: mcp.id,
        name: mcp.name,
        slug: mcp.name.toLowerCase().replace(/\s+/g, "-"),
        spec: null,
      },
      serverUrl: mcp.serverUrl,
      accessToken: mcp.oauth.accessToken,
    };
  }

  /**
   * Check if an account is a custom MCP
   */
  static isCustomMcp(
    account: IntegrationAccountWithDefinition | CustomMcpAccount,
  ): account is CustomMcpAccount {
    return "isCustomMcp" in account && account.isCustomMcp === true;
  }

  /**
   * Get tools from a specific integration account
   */
  static async getIntegrationTools(accountId: string) {
    const account = await this.getIntegrationAccountById(accountId);

    const integrationSlug = account.integrationDefinition.slug;
    const executablePath = `./integrations/${integrationSlug}/main`;

    try {
      // Call the get-tools command with timeout
      const { stdout } = await execFileAsync(
        "node",
        [
          executablePath,
          "get-tools",
          "--config",
          JSON.stringify(account.integrationConfiguration),
          "--integration-definition",
          JSON.stringify(account.integrationDefinition),
        ],
        {
          encoding: "utf-8",
          maxBuffer: 10 * 1024 * 1024, // 10MB buffer
          timeout: 30000, // 30 second timeout
        },
      );

      return stdout;
    } catch (error: any) {
      if (error.killed && error.signal === "SIGTERM") {
        throw new Error(
          `Integration get-tools timeout: ${integrationSlug} exceeded 30 seconds`,
        );
      }
      throw error;
    }
  }

  /**
   * Call a tool on a specific integration account
   */
  static async callIntegrationTool(
    accountId: string,
    toolName: string,
    args: any,
    timezone: string,
  ): Promise<any> {
    const account = await this.getIntegrationAccountById(accountId);

    // Parse tool name to extract original tool name (remove slug prefix)
    const parts = toolName.split("_");
    if (parts.length < 2) {
      throw new Error("Invalid tool name format");
    }

    const integrationSlug = account.integrationDefinition.slug;
    const originalToolName = parts.slice(1).join("_");
    const executablePath = `./integrations/${integrationSlug}/main`;

    try {
      // Call the call-tool command with timeout
      const { stdout } = await execFileAsync(
        "node",
        [
          executablePath,
          "call-tool",
          "--config",
          JSON.stringify({
            ...account.integrationConfiguration,
            timezone,
          }),
          "--integration-definition",
          JSON.stringify(account.integrationDefinition),
          "--tool-name",
          originalToolName,
          "--tool-arguments",
          JSON.stringify(args),
        ],
        {
          encoding: "utf-8",
          maxBuffer: 10 * 1024 * 1024, // 10MB buffer
          timeout: 30000, // 30 second timeout
        },
      );

      // Parse the JSON output (expecting Message format)
      return JSON.parse(stdout);
    } catch (error: any) {
      if (error.killed && error.signal === "SIGTERM") {
        return {
          content: [
            {
              type: "text",
              text: `Integration timeout: ${integrationSlug}.${originalToolName} exceeded 30 seconds`,
            },
          ],
          isError: true,
        };
      }

      // Handle JSON parse errors or other errors
      return {
        content: [
          {
            type: "text",
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
}
