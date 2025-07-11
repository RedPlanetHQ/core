import { tasks } from "@trigger.dev/sdk/v3";

import { getOrCreatePersonalAccessToken } from "./personalAccessToken.server";
import { logger } from "./logger.service";
import { type integrationRun } from "~/trigger/integrations/integration-run";

import type { IntegrationDefinitionV2 } from "@core/database";

/**
 * Prepares the parameters for triggering an integration.
 * If userId is provided, gets or creates a personal access token for the user.
 */
async function prepareIntegrationTrigger(
  integrationDefinition: IntegrationDefinitionV2,
  userId?: string,
) {
  logger.info(`Loading integration ${integrationDefinition.slug}`);

  let pat = "";
  let patId = "";
  if (userId) {
    // Use the integration slug as the token name for uniqueness
    const tokenResult = await getOrCreatePersonalAccessToken({
      name: integrationDefinition.slug ?? "integration",
      userId,
    });
    pat = tokenResult.token ?? "";
    patId = tokenResult.id ?? "";
  }

  return {
    integrationDefinition,
    pat,
    patId,
  };
}

/**
 * Triggers an integration run asynchronously.
 */
export async function runIntegrationTriggerAsync(
  integrationDefinition: IntegrationDefinitionV2,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  event: any,
  userId?: string,
) {
  const params = await prepareIntegrationTrigger(integrationDefinition, userId);
  return await tasks.trigger<typeof integrationRun>("integration-run", {
    ...params,
    event,
  });
}

/**
 * Triggers an integration run and waits for completion.
 */
export async function runIntegrationTrigger(
  integrationDefinition: IntegrationDefinitionV2,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  event: any,
  userId?: string,
) {
  const params = await prepareIntegrationTrigger(integrationDefinition, userId);

  const response = await tasks.triggerAndPoll<typeof integrationRun>(
    "integration-run",
    {
      ...params,
      integrationAccount: event.integrationAccount,
      event: event.event,
      eventBody: event.eventBody,
    },
  );

  if (response.status === "COMPLETED") {
    return response.output;
  }

  throw new Error(`Integration trigger failed with status: ${response.status}`);
}
