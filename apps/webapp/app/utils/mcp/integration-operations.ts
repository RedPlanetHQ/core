import { logger } from "~/services/logger.service";
import {
  IntegrationLoader,
  type CustomMcpIntegration,
} from "./integration-loader";
import { makeModelCall } from "~/lib/model.server";
import {
  INTEGRATION_ACTION_SELECTION_SYSTEM_PROMPT,
  buildIntegrationActionSelectionPrompt,
} from "./prompts";
import { prisma } from "~/db.server";
import PQueue from "p-queue";
import { getUserById } from "~/models/user.server";
import {
  createCustomMcpClient,
  type CustomMcpStoredCredentials,
} from "@core/mcp-proxy";

// Integration execution queue with concurrency limit
// Limits concurrent child processes to prevent server overload
const integrationQueue = new PQueue({
  concurrency: 50, // Max 50 concurrent integration calls
  timeout: 35000, // 35 second total timeout (slightly more than execFile timeout)
});

// Log queue stats periodically for monitoring
setInterval(() => {
  const stats = {
    size: integrationQueue.size, // Pending tasks
    pending: integrationQueue.pending, // Running tasks
  };
  if (stats.size > 0 || stats.pending > 0) {
    logger.log(
      `Integration queue stats: ${stats.pending} running, ${stats.size} queued`,
    );
  }
}, 10000); // Log every 10 seconds if there's activity

/**
 * Handler for get_integrations
 */
export async function handleGetIntegrations(args: any) {
  try {
    const { userId, workspaceId } = args;

    if (!workspaceId) {
      throw new Error("workspaceId is required");
    }

    const integrations =
      await IntegrationLoader.getConnectedIntegrationAccounts(
        userId,
        workspaceId,
      );

    const simplifiedIntegrations = integrations.map((account) => ({
      slug: account.integrationDefinition.slug,
      name: account.integrationDefinition.name,
      id: account.id,
      accountId: account.accountId,
    }));

    console.log(integrations, simplifiedIntegrations);

    // Format as readable text
    const formattedText =
      simplifiedIntegrations.length === 0
        ? "No integrations connected."
        : `Connected Integrations (${simplifiedIntegrations.length}):\n\n` +
          simplifiedIntegrations
            .map(
              (integration, index) =>
                `${index + 1}. ${integration.name}\n` +
                `   accountId: ${integration.id}\n` +
                `   User identifier: ${integration.accountId}\n` +
                `   Slug: ${integration.slug}`,
            )
            .join("\n\n");

    return {
      content: [
        {
          type: "text",
          text: formattedText,
        },
      ],
      isError: false,
    };
  } catch (error) {
    logger.error(`MCP get integrations error: ${error}`);

    return {
      content: [
        {
          type: "text",
          text: `Error getting integrations: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Helper to create token refresh callback for custom MCPs
 */
function createTokenRefreshCallback(userId: string, mcpId: string) {
  return async (newCredentials: CustomMcpStoredCredentials) => {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { metadata: true },
    });

    const metadata = (user?.metadata as any) || {};
    const mcpIntegrations = (metadata?.mcpIntegrations ||
      []) as CustomMcpIntegration[];

    const updatedIntegrations = mcpIntegrations.map((mcp) => {
      if (mcp.id === mcpId) {
        return {
          ...mcp,
          oauth: {
            ...mcp.oauth,
            accessToken: newCredentials.accessToken,
            refreshToken: newCredentials.refreshToken,
            expiresIn: newCredentials.expiresIn,
            clientId: newCredentials.clientId,
          },
        };
      }
      return mcp;
    });

    await prisma.user.update({
      where: { id: userId },
      data: {
        metadata: {
          ...metadata,
          mcpIntegrations: updatedIntegrations,
        },
      },
    });

    logger.info(`Refreshed tokens for custom MCP ${mcpId}`);
  };
}

/**
 * Get integration actions for an account.
 * - If query is provided, uses LLM to filter relevant actions.
 * - If no query, returns all available tools.
 * Queued with concurrency control to prevent server overload.
 * Supports both regular integrations and custom MCPs.
 */
export async function getIntegrationActions(
  accountId: string,
  query?: string,
  userId?: string,
): Promise<any[]> {
  // Queue the get-tools call to limit concurrent child processes
  return integrationQueue.add(async () => {
    const account = await IntegrationLoader.getIntegrationAccountById(
      accountId,
      userId,
    );

    let tools: any[];

    // Check if this is a custom MCP
    if (IntegrationLoader.isCustomMcp(account)) {
      // Connect to custom MCP server and list tools
      const client = await createCustomMcpClient({
        serverUrl: account.serverUrl,
        credentials: {
          accessToken: account.accessToken!,
          refreshToken: account.integrationConfiguration.refreshToken,
          expiresIn: account.integrationConfiguration.expiresIn,
          clientId: account.integrationConfiguration.clientId,
        },
        onTokensRefreshed: userId
          ? createTokenRefreshCallback(userId, account.id)
          : undefined,
      });

      try {
        const result = await client.listTools();
        tools = result.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        }));
      } finally {
        await client.close();
      }
    } else {
      const toolsJson = await IntegrationLoader.getIntegrationTools(accountId);
      tools = JSON.parse(toolsJson);
    }

    if (!query) {
      return tools;
    }

    const integrationSlug = account.integrationDefinition.slug;

    const userPrompt = buildIntegrationActionSelectionPrompt(
      query,
      integrationSlug,
      tools,
    );

    let selectedActionNames: string[] = [];

    await makeModelCall(
      false,
      [
        { role: "system", content: INTEGRATION_ACTION_SELECTION_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      (text) => {
        try {
          const cleanedText = text.trim();
          const jsonMatch = cleanedText.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            selectedActionNames = JSON.parse(jsonMatch[0]);
          } else {
            selectedActionNames = JSON.parse(cleanedText);
          }
        } catch (parseError) {
          logger.error(
            `Error parsing LLM response for action selection: ${parseError}`,
          );
          selectedActionNames = tools.map((tool: any) => tool.name);
        }
      },
      {
        temperature: 0.3,
        maxTokens: 500,
      },
      "low",
    );

    if (selectedActionNames.length > 0) {
      return tools.filter((tool: { name: string }) =>
        selectedActionNames.includes(tool.name),
      );
    }

    return [];
  });
}

/**
 * Execute an action on an integration account.
 * Logs the call result to the database.
 * Queued with concurrency control to prevent server overload.
 * Supports both regular integrations and custom MCPs.
 */
export async function executeIntegrationAction(
  accountId: string,
  action: string,
  parameters: Record<string, any> = {},
  userId: string,
  source?: string,
): Promise<any> {
  const user = await getUserById(userId);
  const metadata = user?.metadata as Record<string, unknown> | null;
  const timezone = (metadata?.timezone as string) ?? "UTC";

  // Queue the integration call to limit concurrent child processes
  return integrationQueue.add(async () => {
    const account = await IntegrationLoader.getIntegrationAccountById(
      accountId,
      userId,
    );

    let result: any;

    // Check if this is a custom MCP
    if (IntegrationLoader.isCustomMcp(account)) {
      try {
        const client = await createCustomMcpClient({
          serverUrl: account.serverUrl,
          credentials: {
            accessToken: account.accessToken!,
            refreshToken: account.integrationConfiguration.refreshToken,
            expiresIn: account.integrationConfiguration.expiresIn,
            clientId: account.integrationConfiguration.clientId,
          },
          onTokensRefreshed: createTokenRefreshCallback(userId, account.id),
        });

        try {
          const callResult = await client.callTool({
            name: action,
            arguments: parameters,
          });

          result = {
            content: callResult.content,
            isError: callResult.isError || false,
          };
        } finally {
          await client.close();
        }
      } catch (error) {
        logger.error(`Custom MCP call error for ${account.id}: ${error}`);
        throw error;
      }
    } else {
      const integrationSlug = account.integrationDefinition.slug;
      const toolName = `${integrationSlug}_${action}`;

      try {
        result = await IntegrationLoader.callIntegrationTool(
          accountId,
          toolName,
          parameters,
          timezone,
        );
      } catch (error) {
        await prisma.integrationCallLog
          .create({
            data: {
              integrationAccountId: accountId,
              toolName: action,
              source: source || null,
              error: error instanceof Error ? error.message : String(error),
            },
          })
          .catch((logError: any) => {
            logger.error(`Failed to log integration call error: ${logError}`);
          });
        throw error;
      }

      await prisma.integrationCallLog
        .create({
          data: {
            integrationAccountId: accountId,
            toolName: action,
            source: source || null,
            error: null,
          },
        })
        .catch((logError: any) => {
          logger.error(`Failed to log integration call: ${logError}`);
        });
    }

    return result;
  });
}

/**
 * MCP handler for get_integration_actions
 * Wraps getIntegrationActions with MCP { content, isError } response format
 */
export async function handleGetIntegrationActions(args: any) {
  const { accountId, query, userId } = args;

  try {
    if (!accountId) {
      throw new Error("accountId is required");
    }

    if (!query) {
      throw new Error("query is required");
    }

    const actions = await getIntegrationActions(accountId, query, userId);

    if (actions.length > 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(actions),
          },
        ],
        isError: false,
      };
    }

    return {
      content: [],
      isError: false,
    };
  } catch (error) {
    logger.error(`MCP get integration actions error: ${error}`);

    return {
      content: [
        {
          type: "text",
          text: `Error getting integration actions: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * MCP handler for execute_integration_action
 * Wraps executeIntegrationAction with MCP { content, isError } response format
 */
export async function handleExecuteIntegrationAction(args: any) {
  const { accountId, action, parameters: actionArgs, source, userId } = args;

  try {
    if (!accountId) {
      throw new Error("accountId is required");
    }

    if (!action) {
      throw new Error("action is required");
    }

    return await executeIntegrationAction(
      accountId,
      action,
      actionArgs || {},
      userId,
      source,
    );
  } catch (error) {
    logger.error(`MCP execute integration action error: ${error}`);

    return {
      content: [
        {
          type: "text",
          text: `Error executing integration action: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
