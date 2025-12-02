import { prisma } from "~/db.server";
import { execFileSync } from "child_process";

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
   * Get tools from a specific integration
   */
  static async getIntegrationTools(
    userId: string,
    workspaceId: string,
    integrationSlug: string,
  ) {
    const accounts = await this.getMcpEnabledIntegrationAccounts(
      userId,
      workspaceId,
      [integrationSlug],
    );

    if (accounts.length === 0) {
      throw new Error(
        `Integration '${integrationSlug}' not found or not connected.`,
      );
    }

    const account = accounts[0];
    const executablePath = `./integrations/${integrationSlug}/main`;

    // Call the get-tools command
    const output = execFileSync(
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
      },
    );

    return output;
  }

  /**
   * Call a tool on a specific integration
   */
  static async callIntegrationTool(
    userId: string,
    workspaceId: string,
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

    // Get the integration account
    const accounts = await this.getMcpEnabledIntegrationAccounts(
      userId,
      workspaceId,
      [integrationSlug],
    );

    if (accounts.length === 0) {
      throw new Error(
        `Integration ${integrationSlug} not found or not connected`,
      );
    }

    const account = accounts[0];
    const executablePath = `./integrations/${integrationSlug}/main`;

    // Call the call-tool command
    const output = execFileSync(
      "node",
      [
        executablePath,
        "call-tool",
        "--config",
        JSON.stringify(account.integrationConfiguration),
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
      },
    );

    try {
      // Parse the JSON output (expecting Message format)
      return JSON.parse(output);
    } catch (error) {
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
