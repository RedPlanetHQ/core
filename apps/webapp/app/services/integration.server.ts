import { runs, tasks } from "@trigger.dev/sdk/v3";

import { logger } from "./logger.service";
import { type integrationRun } from "~/trigger/integrations/integration-run";

import type {
  IntegrationAccount,
  IntegrationDefinitionV2,
} from "@core/database";

/**
 * Triggers an integration run asynchronously.
 */
export async function runIntegrationTriggerAsync(
  integrationDefinition: IntegrationDefinitionV2,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  event: any,
  userId?: string,
  workspaceId?: string,
) {
  logger.info(
    `Triggering async integration run for ${integrationDefinition.slug}`,
    {
      integrationId: integrationDefinition.id,
      event: event.event,
      userId,
      workspaceId,
    },
  );

  return await tasks.trigger<typeof integrationRun>("integration-run", {
    integrationDefinition,
    event: event.event,
    eventBody: event.eventBody,
    integrationAccount: event.integrationAccount,
    workspaceId,
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
  workspaceId?: string,
  integrationAccount?: IntegrationAccount,
) {
  logger.info(
    `Triggering sync integration run for ${integrationDefinition.slug}`,
    {
      integrationId: integrationDefinition.id,
      event: event.event,
      userId,
      workspaceId,
    },
  );

  const response = await tasks.trigger<typeof integrationRun>(
    "integration-run",
    {
      integrationDefinition,
      integrationAccount,
      workspaceId,
      userId,
      event: event.event,
      eventBody: event.eventBody,
    },
  );

  let run = await runs.retrieve(response.id);
  const maxAttempts = 150; // 5 minutes with 2s intervals
  let attempts = 0;

  while (run.status !== "COMPLETED" && run.status !== "FAILED") {
    attempts++;

    if (attempts >= maxAttempts) {
      logger.error(`Integration run timed out after ${maxAttempts} attempts`, {
        runId: response.id,
        status: run.status,
        integrationSlug: integrationDefinition.slug,
      });
      throw new Error(`Integration run timed out after ${maxAttempts * 2} seconds`);
    }

    await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2s
    run = await runs.retrieve(response.id);
    logger.info(`Task status: ${run.status} (attempt ${attempts}/${maxAttempts})`);
  }

  if (run.status === "FAILED") {
    logger.error(`Integration run failed`, {
      runId: response.id,
      integrationSlug: integrationDefinition.slug,
    });
    throw new Error(`Integration run failed`);
  }

  return run.output;
}
