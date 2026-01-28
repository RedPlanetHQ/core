import { json } from "@remix-run/node";
import { z } from "zod";
import {
  createHybridLoaderApiRoute,
  createHybridActionApiRoute,
} from "~/services/routeBuilders/apiBuilder.server";
import { IntegrationEventType } from "@core/types";
import { runIntegrationTrigger } from "~/services/integration.server";
import { getIntegrationDefinitionWithId } from "~/services/integrationDefinition.server";
import { logger } from "~/services/logger.service";
import { getWorkspaceByUser } from "~/models/workspace.server";
import { getConnectedIntegrationAccounts } from "~/services/integrationAccount.server";

import { scheduler } from "~/services/oauth/scheduler";

// Schema for creating an integration account with API key
const IntegrationAccountBodySchema = z.object({
  integrationDefinitionId: z.string(),
  apiKey: z.string(),
});

/**
 * GET /api/v1/integration_account
 * Returns all connected integration accounts for the user's workspace
 */
const loader = createHybridLoaderApiRoute(
  {
    allowJWT: true,
    corsStrategy: "all",
    findResource: async (_params, authentication) => {
      return getWorkspaceByUser(authentication.userId);
    },
  },
  async ({ authentication, resource: workspace }) => {
    const accounts = await getConnectedIntegrationAccounts(
      authentication.userId,
      workspace.id,
    );

    return json({ accounts });
  },
);

/**
 * POST /api/v1/integration_account
 * Creates an integration account with an API key
 */
const { action } = createHybridActionApiRoute(
  {
    body: IntegrationAccountBodySchema,
    allowJWT: true,
    authorization: {
      action: "integrationaccount:create",
    },
    corsStrategy: "all",
  },
  async ({ body, authentication }) => {
    const { integrationDefinitionId, apiKey } = body;
    const { userId } = authentication;
    const workspace = await getWorkspaceByUser(authentication.userId);

    try {
      // Get the integration definition
      const integrationDefinition = await getIntegrationDefinitionWithId(
        integrationDefinitionId,
      );

      if (!integrationDefinition) {
        return json(
          { error: "Integration definition not found" },
          { status: 404 },
        );
      }

      // Trigger the SETUP event for the integration
      const setupResult = await runIntegrationTrigger(
        integrationDefinition,
        {
          event: IntegrationEventType.SETUP,
          eventBody: {
            apiKey,
          },
        },
        userId,
        workspace?.id,
      );

      if (!setupResult.account || !setupResult.account.id) {
        return json(
          { error: "Failed to setup integration with the provided API key" },
          { status: 400 },
        );
      }

      await scheduler({
        integrationAccountId: setupResult?.account?.id,
      });

      return json({ success: true, setupResult });
    } catch (error) {
      logger.error("Error creating integration account", {
        error,
        userId,
        integrationDefinitionId,
      });
      return json(
        { error: "Failed to create integration account" },
        { status: 500 },
      );
    }
  },
);

export { loader, action };
