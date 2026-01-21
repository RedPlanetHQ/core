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
      hasMcp: !!account.integrationDefinition.spec?.mcp,
    }));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(simplifiedIntegrations),
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
    const { integrationSlug, query, userId, workspaceId } = args;

    if (!integrationSlug) {
      throw new Error("integrationSlug is required");
    }

    if (!query) {
      throw new Error("query is required");
    }

    // Get all available tools for the integration
    const toolsJson = await IntegrationLoader.getIntegrationTools(
      userId,
      workspaceId,
      integrationSlug,
    );

    // Parse the tools JSON to get action details
    const tools = JSON.parse(toolsJson);

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
  let integrationAccountId: string | null = null;
  let toolName = "";
  const {
    integrationSlug,
    action,
    parameters: actionArgs,
    userId,
    workspaceId,
  } = args;

  try {
    if (!integrationSlug) {
      throw new Error("integrationSlug is required");
    }

    if (!action) {
      throw new Error("action is required");
    }

    toolName = `${integrationSlug}_${action}`;

    // Get the integration account to log the call
    const accounts = await IntegrationLoader.getConnectedIntegrationAccounts(
      userId,
      workspaceId,
      [integrationSlug],
    );

    if (accounts.length > 0) {
      integrationAccountId = accounts[0].id;
    }

    console.log(integrationAccountId);

    const result = await IntegrationLoader.callIntegrationTool(
      userId,
      workspaceId,
      toolName,
      actionArgs || {},
    );

    // Log successful call
    if (integrationAccountId) {
      await prisma.integrationCallLog
        .create({
          data: {
            integrationAccountId,
            toolName: action,
            error: null,
          },
        })
        .catch((logError: any) => {
          // Don't fail the request if logging fails
          logger.error(`Failed to log integration call: ${logError}`);
        });
    }

    return result;
  } catch (error) {
    logger.error(`MCP execute integration action error: ${error}`);

    // Log failed call
    if (integrationAccountId) {
      await prisma.integrationCallLog
        .create({
          data: {
            integrationAccountId,
            toolName: action,
            error: error instanceof Error ? error.message : String(error),
          },
        })
        .catch((logError: any) => {
          // Don't fail the request if logging fails
          logger.error(`Failed to log integration call error: ${logError}`);
        });
    }

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
