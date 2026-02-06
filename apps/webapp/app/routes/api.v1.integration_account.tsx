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

import { scheduler } from "~/services/oauth/scheduler";
import { getConnectedIntegrationAccounts } from "~/services/integrationAccount.server";

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
    findResource: async () => 1,
  },
  async ({ authentication }) => {

    if (!authentication.workspaceId) {
      throw new Error("User workspace not found");
    }

    const accounts = await getConnectedIntegrationAccounts(
      authentication.userId,
      authentication?.workspaceId as string,
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
        authentication.workspaceId,
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
