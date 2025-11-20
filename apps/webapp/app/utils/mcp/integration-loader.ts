import { prisma } from "~/db.server";
import { TransportManager } from "./transport-manager";
import { getDefaultEnvironment } from "@core/mcp-proxy";

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
   */
  static async getConnectedIntegrationAccounts(
    userId: string,
    workspaceId: string,
    integrationSlugs?: string[],
  ): Promise<IntegrationAccountWithDefinition[]> {
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

    return integrationAccounts;
  }

  /**
   * Get integration accounts that have MCP configuration
   */
  static async getMcpEnabledIntegrationAccounts(
    userId: string,
    workspaceId: string,
    integrationSlugs?: string[],
  ): Promise<IntegrationAccountWithDefinition[]> {
    const accounts = await this.getConnectedIntegrationAccounts(
      userId,
      workspaceId,
      integrationSlugs,
    );

    // Filter for accounts with MCP configuration
    return accounts.filter((account) => {
      const spec = account.integrationDefinition.spec;
      return spec && spec.mcp && spec.mcp.type;
    });
  }

  /**
   * Load integration transports for a session
   */
  static async loadIntegrationTransports(
    sessionId: string,
    userId: string,
    workspaceId: string,
    integrationSlugs?: string[],
  ): Promise<{
    loaded: number;
    failed: Array<{ slug: string; error: string }>;
  }> {
    const accounts = await this.getMcpEnabledIntegrationAccounts(
      userId,
      workspaceId,
      integrationSlugs,
    );

    let loaded = 0;
    const failed: Array<{ slug: string; error: string }> = [];

    for (const account of accounts) {
      try {
        const spec = account.integrationDefinition.spec;
        const mcpConfig = spec.mcp;

        if (mcpConfig.type === "http") {
          // Get access token from integration configuration
          let accessToken: string | undefined;

          const integrationConfig = account.integrationConfiguration as any;
          if (
            integrationConfig &&
            integrationConfig.mcp &&
            integrationConfig.mcp.tokens
          ) {
            accessToken = integrationConfig.mcp.tokens.access_token;
          }

          // Create HTTP transport for this integration
          await TransportManager.addIntegrationTransport(
            sessionId,
            account.id,
            account.integrationDefinition.slug,
            mcpConfig.url,
            accessToken,
          );

          loaded++;
        } else {
          const slug = account.integrationDefinition.slug;

          // Extract headers from the incoming request and convert to environment variables
          const extractedEnv = { ...getDefaultEnvironment() };

          // Use the saved local file instead of command
          const executablePath = `./integrations/${slug}/main`;

          await TransportManager.addStdioIntegrationTransport(
            sessionId,
            account.id,
            account.integrationDefinition.slug,
            "node",
            [
              executablePath,
              "mcp",
              "--config",
              JSON.stringify(account.integrationConfiguration),
              "--integration-definition",
              JSON.stringify(account.integrationDefinition),
            ],
            extractedEnv,
          );

          loaded++;
        }
      } catch (error) {
        console.log(error);
        failed.push({
          slug: account.integrationDefinition.slug,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return { loaded, failed };
  }

  /**
   * Get tools from all connected integration accounts
   */
  static async getAllIntegrationTools(sessionId: string) {
    const integrationTransports =
      TransportManager.getSessionIntegrationTransports(sessionId);
    const allTools: any[] = [];

    for (const integrationTransport of integrationTransports) {
      try {
        const result = await integrationTransport.client.listTools();

        if (result.tools && Array.isArray(result.tools)) {
          // Prefix tool names with integration slug to avoid conflicts
          const prefixedTools = result.tools.map((tool: any) => ({
            ...tool,
            name: `${integrationTransport.slug}_${tool.name}`,
            description: `[${integrationTransport.slug}] ${tool.description || tool.name}`,
            _integration: {
              slug: integrationTransport.slug,
              accountId: integrationTransport.integrationAccountId,
              originalName: tool.name,
            },
          }));

          allTools.push(...prefixedTools);
        }
      } catch (error) {
        console.error(
          `Failed to get tools from integration ${integrationTransport.slug}:`,
          error,
        );
      }
    }

    return allTools;
  }

  /**
   * Get tools from a specific integration
   */
  static async getIntegrationTools(sessionId: string, integrationSlug: string) {
    const integrationTransports =
      TransportManager.getSessionIntegrationTransports(sessionId);

    if (integrationTransports.length === 0) {
      throw new Error(
        `No integration transports loaded for session ${sessionId}. Make sure integrations are connected and session is initialized properly.`,
      );
    }

    const integrationTransport = integrationTransports.find(
      (t) => t.slug === integrationSlug,
    );

    if (!integrationTransport) {
      const availableSlugs = integrationTransports
        .map((t) => t.slug)
        .join(", ");
      throw new Error(
        `Integration '${integrationSlug}' not found or not connected. Available integrations: ${availableSlugs}`,
      );
    }

    const result = await integrationTransport.client.listTools();

    if (result.tools && Array.isArray(result.tools)) {
      return result.tools.map((tool: any) => ({
        name: tool.name,
        description: tool.description || tool.name,
        inputSchema: tool.inputSchema,
      }));
    }

    return [];
  }

  /**
   * Call a tool on a specific integration
   */
  static async callIntegrationTool(
    sessionId: string,
    toolName: string,
    args: any,
  ): Promise<any> {
    // Parse tool name to extract integration slug
    const parts = toolName.split("_");
    if (parts.length < 2) {
      throw new Error("Invalid tool name format");
    }

    const integrationSlug = parts[0];
    const originalToolName = parts.slice(1).join("_");

    // Find the integration transport
    const integrationTransports =
      TransportManager.getSessionIntegrationTransports(sessionId);
    const integrationTransport = integrationTransports.find(
      (t) => t.slug === integrationSlug,
    );

    if (!integrationTransport) {
      throw new Error(
        `Integration ${integrationSlug} not found or not connected`,
      );
    }

    // Call the tool
    return await integrationTransport.client.callTool({
      name: originalToolName,
      arguments: args,
    });
  }
}
