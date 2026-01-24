import { logger } from "~/services/logger.service";
import { IntegrationLoader } from "./integration-loader";
import { makeModelCall } from "~/lib/model.server";
import {
  INTEGRATION_ACTION_SELECTION_SYSTEM_PROMPT,
  buildIntegrationActionSelectionPrompt,
} from "./prompts";
import { prisma } from "~/db.server";

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
      accountId: account.id,
    }));

    // Format as readable text
    const formattedText =
      simplifiedIntegrations.length === 0
        ? "No integrations connected."
        : `Connected Integrations (${simplifiedIntegrations.length}):\n\n` +
          simplifiedIntegrations
            .map(
              (integration, index) =>
                `${index + 1}. ${integration.name}\n` +
                `   Account ID: ${integration.accountId}\n` +
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
 * Handler for get_integration_actions
 * Uses LLM to filter relevant actions based on user query
 */
export async function handleGetIntegrationActions(args: any) {
  try {
    const { accountId, query } = args;

    if (!accountId) {
      throw new Error("accountId is required");
    }

    if (!query) {
      throw new Error("query is required");
    }

    // Get all available tools for the integration account
    const toolsJson = await IntegrationLoader.getIntegrationTools(accountId);

    // Parse the tools JSON to get action details
    const tools = JSON.parse(toolsJson);

    // Get account to get integration slug for the prompt
    const account =
      await IntegrationLoader.getIntegrationAccountById(accountId);
    const integrationSlug = account.integrationDefinition.slug;

    // Build the LLM prompt
    const userPrompt = buildIntegrationActionSelectionPrompt(
      query,
      integrationSlug,
      tools,
    );

    let selectedActionNames: string[] = [];

    // Use LLM to filter relevant actions based on the query
    await makeModelCall(
      false,
      [
        { role: "system", content: INTEGRATION_ACTION_SELECTION_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      (text) => {
        try {
          // Parse the LLM response to extract action names
          const cleanedText = text.trim();
          // Try to find JSON array in the response
          const jsonMatch = cleanedText.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            selectedActionNames = JSON.parse(jsonMatch[0]);
          } else {
            // Fallback: try parsing the entire text
            selectedActionNames = JSON.parse(cleanedText);
          }
        } catch (parseError) {
          logger.error(
            `Error parsing LLM response for action selection: ${parseError}`,
          );
          // Fallback: return all action names if parsing fails
          selectedActionNames = tools.map((tool: any) => tool.name);
        }
      },
      {
        temperature: 0.3,
        maxTokens: 500,
      },
      "low", // Use low complexity model for this simple task
    );

    if (selectedActionNames.length > 0) {
      const actionDetails = tools.filter((tool: { name: string }) =>
        selectedActionNames.includes(tool.name),
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(actionDetails),
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
 * Handler for execute_integration_action
 */
export async function handleExecuteIntegrationAction(args: any) {
  const { accountId, action, parameters: actionArgs } = args;

  try {
    if (!accountId) {
      throw new Error("accountId is required");
    }

    if (!action) {
      throw new Error("action is required");
    }

    // Get account to construct tool name
    const account =
      await IntegrationLoader.getIntegrationAccountById(accountId);
    const integrationSlug = account.integrationDefinition.slug;
    const toolName = `${integrationSlug}_${action}`;

    const result = await IntegrationLoader.callIntegrationTool(
      accountId,
      toolName,
      actionArgs || {},
    );

    // Log successful call
    await prisma.integrationCallLog
      .create({
        data: {
          integrationAccountId: accountId,
          toolName: action,
          error: null,
        },
      })
      .catch((logError: any) => {
        // Don't fail the request if logging fails
        logger.error(`Failed to log integration call: ${logError}`);
      });

    return result;
  } catch (error) {
    logger.error(`MCP execute integration action error: ${error}`);

    // Log failed call
    await prisma.integrationCallLog
      .create({
        data: {
          integrationAccountId: accountId,
          toolName: action,
          error: error instanceof Error ? error.message : String(error),
        },
      })
      .catch((logError: any) => {
        // Don't fail the request if logging fails
        logger.error(`Failed to log integration call error: ${logError}`);
      });

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
