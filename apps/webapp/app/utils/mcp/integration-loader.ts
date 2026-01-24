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
   * Get integration account by ID
   */
  static async getIntegrationAccountById(
    accountId: string,
  ): Promise<IntegrationAccountWithDefinition> {
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

    if (!account || !account.isActive) {
      throw new Error(`Integration account '${accountId}' not found or not active.`);
    }

    return account;
  }

  /**
   * Get tools from a specific integration account
   */
  static async getIntegrationTools(accountId: string) {
    const account = await this.getIntegrationAccountById(accountId);

    const integrationSlug = account.integrationDefinition.slug;
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
   * Call a tool on a specific integration account
   */
  static async callIntegrationTool(
    accountId: string,
    toolName: string,
    args: any,
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
